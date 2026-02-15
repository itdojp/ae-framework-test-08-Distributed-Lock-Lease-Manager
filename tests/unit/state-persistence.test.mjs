import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LeaseManager, loadManagerSnapshot, saveManagerSnapshot } from "../../src/index.mjs";
import { ManualClock } from "../helpers/manual-clock.mjs";

test("snapshot restore後もfencing tokenは継続して増加する", async () => {
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new LeaseManager({ now: clock.now });

  const first = manager.acquire({
    tenantId: "tenantA",
    lockKey: "order:persist",
    ownerId: "workerA",
    ttlSeconds: 10,
    requestId: "persist-acq-1"
  });
  manager.release({
    leaseId: first.leaseId,
    ownerId: "workerA",
    requestId: "persist-rel-1"
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lease-manager-"));
  const snapshotPath = path.join(tmpDir, "snapshot.json");
  await saveManagerSnapshot(snapshotPath, manager, { note: "unit-test" });

  const { manager: restored, payload } = await loadManagerSnapshot(snapshotPath, { now: clock.now });
  assert.equal(payload.version, 1);
  assert.equal(typeof payload.saved_at, "string");

  const second = restored.acquire({
    tenantId: "tenantA",
    lockKey: "order:persist",
    ownerId: "workerB",
    ttlSeconds: 10,
    requestId: "persist-acq-2"
  });
  assert.ok(second.fencingToken > first.fencingToken);
});
