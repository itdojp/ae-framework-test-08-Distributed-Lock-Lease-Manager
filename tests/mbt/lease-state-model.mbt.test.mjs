import test from "node:test";
import assert from "node:assert/strict";

import { LeaseManager, LeaseManagerError } from "../../src/index.mjs";
import { ManualClock } from "../helpers/manual-clock.mjs";

/**
 * Minimal MBT traces for FREE/HELD/EXPIRED transitions.
 */
const traces = [
  {
    name: "同時acquireで成功は最大1",
    steps: [
      { op: "acquire", owner: "A", expect: "success" },
      { op: "acquire", owner: "B", expect: "lock_held" }
    ]
  },
  {
    name: "owner不一致renew失敗",
    steps: [
      { op: "acquire", owner: "A", expect: "success" },
      { op: "renew", owner: "B", expect: "owner_mismatch" }
    ]
  },
  {
    name: "expiry後renew失敗",
    steps: [
      { op: "acquire", owner: "A", expect: "success" },
      { op: "advance", seconds: 11 },
      { op: "renew", owner: "A", expect: "expired" }
    ]
  },
  {
    name: "release後に再acquire可能",
    steps: [
      { op: "acquire", owner: "A", expect: "success" },
      { op: "release", owner: "A", expect: "success" },
      { op: "acquire", owner: "B", expect: "success" }
    ]
  }
];

for (const trace of traces) {
  test(`MBT: ${trace.name}`, () => {
    const clock = new ManualClock("2026-02-15T00:00:00Z");
    const manager = new LeaseManager({ now: clock.now });
    let leaseId = null;

    for (const [idx, step] of trace.steps.entries()) {
      const requestId = `trace-${trace.name}-${idx}`;
      if (step.op === "advance") {
        clock.advanceSeconds(step.seconds);
        manager.expireLeases();
        continue;
      }

      try {
        if (step.op === "acquire") {
          const lease = manager.acquire({
            tenantId: "tenantA",
            lockKey: "order:mbt",
            ownerId: `worker${step.owner}`,
            ttlSeconds: 10,
            requestId
          });
          leaseId = lease.leaseId;
          assert.equal(step.expect, "success");
        } else if (step.op === "renew") {
          assert.ok(leaseId, "leaseId missing");
          manager.renew({
            leaseId,
            ownerId: `worker${step.owner}`,
            ttlSeconds: 10,
            requestId
          });
          assert.equal(step.expect, "success");
        } else if (step.op === "release") {
          assert.ok(leaseId, "leaseId missing");
          manager.release({
            leaseId,
            ownerId: `worker${step.owner}`,
            requestId
          });
          assert.equal(step.expect, "success");
        } else {
          assert.fail(`unknown op: ${step.op}`);
        }
      } catch (err) {
        assert.ok(err instanceof LeaseManagerError);
        if (step.expect === "lock_held") {
          assert.equal(err.code, "LOCK_HELD");
        } else if (step.expect === "owner_mismatch") {
          assert.equal(err.code, "OWNER_MISMATCH");
        } else if (step.expect === "expired") {
          assert.ok(err.code === "LEASE_NOT_ACTIVE" || err.code === "LEASE_EXPIRED");
        } else {
          throw err;
        }
      }
    }
  });
}
