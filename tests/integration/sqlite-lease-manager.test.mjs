import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SqliteLeaseManager } from "../../src/index.mjs";
import { ManualClock } from "../helpers/manual-clock.mjs";

const sqliteSkipReason = SqliteLeaseManager.isSupported()
  ? false
  : `node:sqlite unavailable: ${SqliteLeaseManager.unsupportedReason() ?? "unknown reason"}`;

async function makeDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sqlite-lease-manager-"));
  return path.join(dir, "lease-manager.db");
}

test("SQLite: 同時acquireで成功は1件のみ", { skip: sqliteSkipReason }, async () => {
  const dbPath = await makeDbPath();
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  const manager = new SqliteLeaseManager({ dbPath, now: clock.now });

  const attempts = Array.from({ length: 10 }, (_, index) =>
    Promise.resolve().then(() => {
      try {
        const lease = manager.acquire({
          tenantId: "tenantA",
          lockKey: "order:sqlite-race",
          ownerId: `worker-${index}`,
          ttlSeconds: 30,
          requestId: `sqlite-race-${index}`
        });
        return { ok: true, lease };
      } catch (error) {
        return { ok: false, error };
      }
    })
  );

  const results = await Promise.all(attempts);
  const success = results.filter((r) => r.ok).length;
  const lockHeld = results.filter((r) => !r.ok && r.error?.code === "LOCK_HELD").length;

  assert.equal(success, 1);
  assert.equal(lockHeld, 9);
  manager.close();
});

test("SQLite: 再起動後もfencing tokenは増加する", { skip: sqliteSkipReason }, async () => {
  const dbPath = await makeDbPath();
  const clock = new ManualClock("2026-02-15T00:00:00Z");
  let manager = new SqliteLeaseManager({ dbPath, now: clock.now });

  const first = manager.acquire({
    tenantId: "tenantA",
    lockKey: "order:sqlite-persist",
    ownerId: "workerA",
    ttlSeconds: 30,
    requestId: "sqlite-persist-1"
  });
  manager.release({
    leaseId: first.leaseId,
    ownerId: "workerA",
    requestId: "sqlite-persist-rel"
  });
  manager.close();

  manager = new SqliteLeaseManager({ dbPath, now: clock.now });
  const second = manager.acquire({
    tenantId: "tenantA",
    lockKey: "order:sqlite-persist",
    ownerId: "workerB",
    ttlSeconds: 30,
    requestId: "sqlite-persist-2"
  });

  assert.ok(second.fencingToken > first.fencingToken);
  manager.close();
});
