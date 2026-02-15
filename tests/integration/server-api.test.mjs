import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../../src/server.mjs";

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

test("API integration: acquire -> get -> release", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  t.after(() => server.close());

  const acq = await api(port, "/leases/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenantA",
      request_id: "req-1",
      lock_key: "order:api",
      owner_id: "workerA",
      ttl_seconds: 30
    })
  });
  assert.equal(acq.response.status, 201);
  assert.equal(acq.data.status, "ACTIVE");

  const getBefore = await api(port, "/locks/order%3Aapi?tenant_id=tenantA");
  assert.equal(getBefore.response.status, 200);
  assert.equal(getBefore.data.has_active_lease, true);
  assert.equal(getBefore.data.active_lease.lease_id, acq.data.lease_id);

  const rel = await api(port, `/leases/${encodeURIComponent(acq.data.lease_id)}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: "req-rel-1",
      owner_id: "workerA"
    })
  });
  assert.equal(rel.response.status, 200);
  assert.equal(rel.data.status, "RELEASED");

  const getAfter = await api(port, "/locks/order%3Aapi?tenant_id=tenantA");
  assert.equal(getAfter.response.status, 200);
  assert.equal(getAfter.data.has_active_lease, false);
});

test("API integration: lock held時は409", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  t.after(() => server.close());

  const payloadA = {
    tenant_id: "tenantA",
    request_id: "req-lock-1",
    lock_key: "order:conflict",
    owner_id: "workerA",
    ttl_seconds: 30
  };
  const payloadB = {
    tenant_id: "tenantA",
    request_id: "req-lock-2",
    lock_key: "order:conflict",
    owner_id: "workerB",
    ttl_seconds: 30
  };

  const first = await api(port, "/leases/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payloadA)
  });
  assert.equal(first.response.status, 201);

  const second = await api(port, "/leases/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payloadB)
  });
  assert.equal(second.response.status, 409);
  assert.equal(second.data.code, "LOCK_HELD");
});
