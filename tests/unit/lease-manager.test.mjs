import test from "node:test";
import assert from "node:assert/strict";

import { LeaseManager, LeaseManagerError } from "../../src/index.mjs";
import { ManualClock } from "../helpers/manual-clock.mjs";

const TENANT = "t1";
const LOCK = "order:123";

test("LS-ACQ-001: lock held中の重複acquireは409", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });

  manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "acq-1"
  });

  assert.throws(
    () =>
      manager.acquire({
        tenantId: TENANT,
        lockKey: LOCK,
        ownerId: "workerB",
        ttlSeconds: 30,
        requestId: "acq-2"
      }),
    /** @param {unknown} err */ (err) =>
      err instanceof LeaseManagerError && err.status === 409 && err.code === "LOCK_HELD"
  );
});

test("LS-ACQ-004: acquire request_id再送は同一leaseを返す", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });
  const req = {
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "acq-dup-1"
  };

  const first = manager.acquire(req);
  clock.advanceSeconds(5);
  const second = manager.acquire(req);

  assert.equal(first.leaseId, second.leaseId);
  assert.equal(first.fencingToken, second.fencingToken);
});

test("LS-RNW-001/LS-REL-001: owner不一致はrenew/release失敗", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });
  const lease = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "acq-owner"
  });

  assert.throws(
    () => manager.renew({ leaseId: lease.leaseId, ownerId: "workerB", ttlSeconds: 30, requestId: "rnw-1" }),
    /** @param {unknown} err */ (err) =>
      err instanceof LeaseManagerError && err.status === 409 && err.code === "OWNER_MISMATCH"
  );
  assert.throws(
    () => manager.release({ leaseId: lease.leaseId, ownerId: "workerB", requestId: "rel-1" }),
    /** @param {unknown} err */ (err) =>
      err instanceof LeaseManagerError && err.status === 409 && err.code === "OWNER_MISMATCH"
  );
});

test("LS-INV-004: 期限切れ後のrenew/releaseは409", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });
  const lease = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 10,
    requestId: "acq-expire"
  });

  clock.advanceSeconds(11);

  assert.throws(
    () => manager.renew({ leaseId: lease.leaseId, ownerId: "workerA", ttlSeconds: 10, requestId: "rnw-expired" }),
    /** @param {unknown} err */ (err) =>
      err instanceof LeaseManagerError &&
      err.status === 409 &&
      (err.code === "LEASE_NOT_ACTIVE" || err.code === "LEASE_EXPIRED")
  );
  assert.throws(
    () => manager.release({ leaseId: lease.leaseId, ownerId: "workerA", requestId: "rel-expired" }),
    /** @param {unknown} err */ (err) =>
      err instanceof LeaseManagerError &&
      err.status === 409 &&
      (err.code === "LEASE_NOT_ACTIVE" || err.code === "LEASE_EXPIRED")
  );
});

test("LS-INV-002/LS-ACC-03: expiry後再取得でfencing token増加", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });

  const first = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 10,
    requestId: "acq-ft-1"
  });
  clock.advanceSeconds(15);
  manager.expireLeases();

  const second = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerB",
    ttlSeconds: 10,
    requestId: "acq-ft-2"
  });

  assert.ok(second.fencingToken > first.fencingToken);
});

test("LS-EXP-001: expireLeasesは冪等", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });

  manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 10,
    requestId: "acq-exp-idem"
  });

  clock.advanceSeconds(20);
  const first = manager.expireLeases();
  const second = manager.expireLeases();

  assert.equal(first, 1);
  assert.equal(second, 0);
});

test("LS-FENCE-001: fencing token比較関数", () => {
  assert.equal(LeaseManager.acceptsFencingToken(10, 11), true);
  assert.equal(LeaseManager.acceptsFencingToken(10, 10), false);
  assert.equal(LeaseManager.acceptsFencingToken(10, 9), false);
});
