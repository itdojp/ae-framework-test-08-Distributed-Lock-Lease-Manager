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

test("LS-ACQ-003: fencing token は current_fencing_token + 1 で採番", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });

  const first = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "acq-token-1"
  });
  manager.release({
    leaseId: first.leaseId,
    ownerId: "workerA",
    requestId: "rel-token-1"
  });

  const second = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerB",
    ttlSeconds: 30,
    requestId: "acq-token-2"
  });

  assert.equal(second.fencingToken, first.fencingToken + 1);
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

test("LS-RNW-002/LS-RNW-003: renewは now+ttl で更新し request_id 再送は冪等", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });
  const lease = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "acq-rnw-idem"
  });

  clock.advanceSeconds(5);
  const renewAt = clock.now();
  const first = manager.renew({
    leaseId: lease.leaseId,
    ownerId: "workerA",
    ttlSeconds: 20,
    requestId: "rnw-idem-1"
  });

  assert.equal(first.lastRenewedAt, renewAt.toISOString());
  assert.equal(first.expiresAt, new Date(renewAt.getTime() + 20 * 1000).toISOString());

  clock.advanceSeconds(5);
  const second = manager.renew({
    leaseId: lease.leaseId,
    ownerId: "workerA",
    ttlSeconds: 60,
    requestId: "rnw-idem-1"
  });

  assert.equal(second.leaseId, first.leaseId);
  assert.equal(second.version, first.version);
  assert.equal(second.lastRenewedAt, first.lastRenewedAt);
  assert.equal(second.expiresAt, first.expiresAt);
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

test("LS-REL-002/LS-REL-003: release後はlock解放され request_id再送は同一結果", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });
  const lease = manager.acquire({
    tenantId: TENANT,
    lockKey: LOCK,
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "acq-rel-idem"
  });

  const first = manager.release({
    leaseId: lease.leaseId,
    ownerId: "workerA",
    requestId: "rel-idem-1"
  });
  const second = manager.release({
    leaseId: lease.leaseId,
    ownerId: "workerA",
    requestId: "rel-idem-1"
  });

  assert.equal(first.status, "RELEASED");
  assert.equal(second.leaseId, first.leaseId);
  assert.equal(second.status, first.status);
  assert.equal(second.version, first.version);
  assert.equal(manager.getLock({ tenantId: TENANT, lockKey: LOCK }), null);
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
