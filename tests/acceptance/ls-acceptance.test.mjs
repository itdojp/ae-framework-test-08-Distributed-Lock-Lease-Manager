import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../../src/server.mjs";
import { LeaseManager } from "../../src/index.mjs";
import { ManualClock } from "../helpers/manual-clock.mjs";

/**
 * @param {number} port
 * @param {string} path
 * @param {RequestInit} init
 */
async function api(port, path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const data = await response.json();
  return { response, data };
}

/**
 * @param {import("../../src/index.mjs").LeaseManager} [manager]
 */
async function startServer(manager) {
  const server = createServer(manager ? { manager } : undefined);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port };
}

test("LS-ACC-01: 同時Acquireで二重取得しない", async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const attempts = Array.from({ length: 10 }, (_, index) =>
    api(port, "/leases/acquire", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-owner-id": `worker-${index}`
      },
      body: JSON.stringify({
        tenant_id: "tenantA",
        request_id: `acc01-${index}`,
        lock_key: "order:acc01",
        owner_id: `worker-${index}`,
        ttl_seconds: 30
      })
    })
  );

  const results = await Promise.all(attempts);
  const success = results.filter(({ response }) => response.status === 201).length;
  const held = results.filter(({ response, data }) => response.status === 409 && data.code === "LOCK_HELD").length;

  assert.equal(success, 1);
  assert.equal(held, 9);
});

test("LS-ACC-02: Renew/Releaseはowner一致・期限内のみ成功", async (t) => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({
    now: clock.now,
    minTtlSeconds: 1,
    maxTtlSeconds: 300
  });
  const { server, port } = await startServer(manager);
  t.after(() => server.close());

  const acquired = await api(port, "/leases/acquire", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify({
      tenant_id: "tenantA",
      request_id: "acc02-acq",
      lock_key: "order:acc02",
      owner_id: "workerA",
      ttl_seconds: 2
    })
  });
  assert.equal(acquired.response.status, 201);

  const ownerMismatch = await api(port, `/leases/${encodeURIComponent(acquired.data.lease_id)}/renew`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerB"
    },
    body: JSON.stringify({
      request_id: "acc02-rnw-mismatch",
      owner_id: "workerB",
      ttl_seconds: 2
    })
  });
  assert.equal(ownerMismatch.response.status, 409);
  assert.equal(ownerMismatch.data.code, "OWNER_MISMATCH");

  clock.advanceSeconds(3);
  const expiredRelease = await api(port, `/leases/${encodeURIComponent(acquired.data.lease_id)}/release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify({
      request_id: "acc02-rel-expired",
      owner_id: "workerA"
    })
  });
  assert.equal(expiredRelease.response.status, 409);
  assert.ok(["LEASE_NOT_ACTIVE", "LEASE_EXPIRED"].includes(expiredRelease.data.code));
});

test("LS-ACC-03: fencing_token は lock_key ごとに単調増加", async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const first = await api(port, "/leases/acquire", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify({
      tenant_id: "tenantA",
      request_id: "acc03-acq-1",
      lock_key: "order:acc03",
      owner_id: "workerA",
      ttl_seconds: 30
    })
  });
  assert.equal(first.response.status, 201);

  const released = await api(port, `/leases/${encodeURIComponent(first.data.lease_id)}/release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify({
      request_id: "acc03-rel-1",
      owner_id: "workerA"
    })
  });
  assert.equal(released.response.status, 200);

  const second = await api(port, "/leases/acquire", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerB"
    },
    body: JSON.stringify({
      tenant_id: "tenantA",
      request_id: "acc03-acq-2",
      lock_key: "order:acc03",
      owner_id: "workerB",
      ttl_seconds: 30
    })
  });
  assert.equal(second.response.status, 201);
  assert.ok(second.data.fencing_token > first.data.fencing_token);
});

test("LS-ACC-04: request_id再送で二重取得・二重解放なし", async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const acquireRequest = {
    tenant_id: "tenantA",
    request_id: "acc04-acq",
    lock_key: "order:acc04",
    owner_id: "workerA",
    ttl_seconds: 30
  };

  const first = await api(port, "/leases/acquire", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify(acquireRequest)
  });
  assert.equal(first.response.status, 201);

  const second = await api(port, "/leases/acquire", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify(acquireRequest)
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.data.lease_id, first.data.lease_id);
  assert.equal(second.data.fencing_token, first.data.fencing_token);

  const releaseRequest = {
    request_id: "acc04-rel",
    owner_id: "workerA"
  };

  const releaseFirst = await api(port, `/leases/${encodeURIComponent(first.data.lease_id)}/release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify(releaseRequest)
  });
  assert.equal(releaseFirst.response.status, 200);
  assert.equal(releaseFirst.data.status, "RELEASED");

  const releaseSecond = await api(port, `/leases/${encodeURIComponent(first.data.lease_id)}/release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-owner-id": "workerA"
    },
    body: JSON.stringify(releaseRequest)
  });
  assert.equal(releaseSecond.response.status, 200);
  assert.equal(releaseSecond.data.lease_id, releaseFirst.data.lease_id);
  assert.equal(releaseSecond.data.status, "RELEASED");
});
