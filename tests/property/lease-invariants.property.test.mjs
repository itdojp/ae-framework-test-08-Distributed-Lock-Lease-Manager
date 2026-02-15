import test from "node:test";
import assert from "node:assert/strict";

import { LeaseManager, LeaseManagerError } from "../../src/index.mjs";
import { ManualClock } from "../helpers/manual-clock.mjs";

const keys = ["order:1", "order:2", "order:3"];
const owners = ["workerA", "workerB"];

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * @param {LeaseManager} manager
 */
function assertInvariants(manager) {
  const state = manager.debugState();

  const activeByKey = new Map();
  for (const lease of state.leases) {
    if (lease.status === "ACTIVE") {
      const k = `${lease.tenantId}::${lease.lockKey}`;
      const prev = activeByKey.get(k) ?? 0;
      activeByKey.set(k, prev + 1);
    }
  }
  for (const count of activeByKey.values()) {
    assert.ok(count <= 1, "LS-INV-001 violation: active lease count > 1");
  }

  const tokenSeen = new Set();
  for (const lease of state.leases) {
    const key = `${lease.tenantId}::${lease.lockKey}::${lease.fencingToken}`;
    assert.ok(!tokenSeen.has(key), "LS-INV-002 violation: duplicate fencing token");
    tokenSeen.add(key);
  }

  for (const lock of state.lockRecords) {
    if (lock.activeLeaseId) {
      const activeLease = state.leases.find((l) => l.leaseId === lock.activeLeaseId);
      assert.ok(activeLease, "activeLeaseId must point existing lease");
      assert.equal(activeLease.status, "ACTIVE");
      assert.ok(lock.currentFencingToken >= activeLease.fencingToken);
    }
  }
}

test("Property: ランダム操作後もLS-INV-001/002を維持", () => {
  for (let seed = 1; seed <= 10; seed += 1) {
    const random = seeded(seed);
    const clock = new ManualClock("2026-02-15T00:00:00Z");
    const manager = new LeaseManager({ now: clock.now });
    const activeLeaseIds = [];

    for (let step = 0; step < 200; step += 1) {
      const op = Math.floor(random() * 5);
      const key = keys[Math.floor(random() * keys.length)];
      const owner = owners[Math.floor(random() * owners.length)];
      const req = `seed-${seed}-step-${step}`;

      try {
        if (op === 0) {
          const lease = manager.acquire({
            tenantId: "tenantA",
            lockKey: key,
            ownerId: owner,
            ttlSeconds: 30,
            requestId: `acq-${req}`
          });
          activeLeaseIds.push(lease.leaseId);
        } else if (op === 1 && activeLeaseIds.length > 0) {
          const leaseId = activeLeaseIds[Math.floor(random() * activeLeaseIds.length)];
          manager.renew({
            leaseId,
            ownerId: owner,
            ttlSeconds: 30,
            requestId: `rnw-${req}`
          });
        } else if (op === 2 && activeLeaseIds.length > 0) {
          const leaseId = activeLeaseIds[Math.floor(random() * activeLeaseIds.length)];
          manager.release({
            leaseId,
            ownerId: owner,
            requestId: `rel-${req}`
          });
        } else if (op === 3) {
          clock.advanceSeconds(5);
          manager.expireLeases();
        } else {
          manager.getLock({ tenantId: "tenantA", lockKey: key });
        }
      } catch (err) {
        if (!(err instanceof LeaseManagerError)) {
          throw err;
        }
        assert.ok([400, 404, 409].includes(err.status));
      }
      assertInvariants(manager);
    }
  }
});

test("Property: expiry後renew/releaseは成功しない", () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });
  const lease = manager.acquire({
    tenantId: "tenantA",
    lockKey: "order:9",
    ownerId: "workerA",
    ttlSeconds: 10,
    requestId: "acq-prop-expire"
  });
  clock.advanceSeconds(11);

  assert.throws(() => manager.renew({ leaseId: lease.leaseId, ownerId: "workerA", ttlSeconds: 10 }));
  assert.throws(() => manager.release({ leaseId: lease.leaseId, ownerId: "workerA" }));
});
