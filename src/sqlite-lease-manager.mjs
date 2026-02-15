import { LeaseManagerError } from "./lease-manager.mjs";

let DatabaseSyncImpl = null;
let sqliteImportError = null;

try {
  ({ DatabaseSync: DatabaseSyncImpl } = await import("node:sqlite"));
} catch (error) {
  sqliteImportError = error;
}

/**
 * SQLite-backed lease manager.
 * Requires Node.js built-in `node:sqlite` (experimental in Node 22).
 */
export class SqliteLeaseManager {
  static isSupported() {
    return DatabaseSyncImpl !== null;
  }

  static unsupportedReason() {
    return sqliteImportError ? String(sqliteImportError.message ?? sqliteImportError) : null;
  }

  /**
   * @param {{ dbPath?: string, now?: () => Date, minTtlSeconds?: number, maxTtlSeconds?: number }} [options]
   */
  constructor(options = {}) {
    if (!DatabaseSyncImpl) {
      throw new LeaseManagerError(
        "node:sqlite is not available; SQLite backend requires Node.js 22+",
        "SQLITE_UNSUPPORTED",
        501
      );
    }
    this.dbPath = options.dbPath ?? ":memory:";
    this.db = new DatabaseSyncImpl(this.dbPath);
    this.now = options.now ?? (() => new Date());
    this.minTtlSeconds = options.minTtlSeconds ?? 10;
    this.maxTtlSeconds = options.maxTtlSeconds ?? 300;
    this.#initSchema();
  }

  close() {
    this.db.close();
  }

  /**
   * @param {{ tenantId: string, lockKey: string, ownerId: string, ttlSeconds: number, requestId?: string }} params
   */
  acquire(params) {
    const { tenantId, lockKey, ownerId, ttlSeconds, requestId } = params;
    this.#validateTtl(ttlSeconds);
    const now = this.now();
    const nowIso = now.toISOString();

    return this.#withTx(() => {
      this.#expireLockIfNeeded(tenantId, lockKey, now);

      if (requestId) {
        const idem = this.db
          .prepare("SELECT lease_id FROM acquire_idempotency WHERE tenant_id = ? AND request_id = ?")
          .get(tenantId, requestId);
        if (idem && idem.lease_id) {
          const lease = this.#getLeaseById(idem.lease_id);
          if (lease && lease.status === "ACTIVE" && new Date(lease.expiresAt) > now) {
            return lease;
          }
        }
      }

      const lock = this.#getOrCreateLockRecord(tenantId, lockKey, nowIso);
      if (lock.activeLeaseId) {
        const activeLease = this.#mustGetLease(lock.activeLeaseId);
        if (activeLease.status === "ACTIVE" && new Date(activeLease.expiresAt) > now) {
          throw new LeaseManagerError("lock is currently held", "LOCK_HELD", 409);
        }
      }

      const fencingToken = lock.currentFencingToken + 1;
      const leaseId = `lease-${tenantId}-${lockKey}-${fencingToken}`;
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

      this.db
        .prepare(
          `INSERT INTO leases (
            lease_id, tenant_id, lock_key, owner_id, status, acquired_at, expires_at,
            last_renewed_at, fencing_token, idempotency_key, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, ?, ?, 1, ?, ?)`
        )
        .run(leaseId, tenantId, lockKey, ownerId, nowIso, expiresAt, fencingToken, requestId ?? null, nowIso, nowIso);

      this.db
        .prepare(
          "UPDATE lock_records SET active_lease_id = ?, current_fencing_token = ?, updated_at = ? WHERE tenant_id = ? AND lock_key = ?"
        )
        .run(leaseId, fencingToken, nowIso, tenantId, lockKey);

      if (requestId) {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO acquire_idempotency (tenant_id, request_id, lease_id) VALUES (?, ?, ?)"
          )
          .run(tenantId, requestId, leaseId);
      }

      this.#pushAudit("LEASE_ACQUIRE", tenantId, lockKey, leaseId, ownerId, nowIso);
      return this.#mustGetLease(leaseId);
    });
  }

  /**
   * @param {{ leaseId: string, ownerId: string, ttlSeconds: number, requestId?: string }} params
   */
  renew(params) {
    const { leaseId, ownerId, ttlSeconds, requestId } = params;
    this.#validateTtl(ttlSeconds);
    const now = this.now();
    const nowIso = now.toISOString();

    return this.#withTx(() => {
      let lease = this.#mustGetLease(leaseId);
      this.#expireLeaseIfNeeded(lease, now);
      lease = this.#mustGetLease(leaseId);

      if (requestId) {
        const idem = this.db
          .prepare("SELECT snapshot_json FROM renew_idempotency WHERE tenant_id = ? AND request_id = ?")
          .get(lease.tenantId, requestId);
        if (idem && idem.snapshot_json) {
          return this.#mapLeaseRow(JSON.parse(idem.snapshot_json));
        }
      }

      this.#assertActiveAndOwned(lease, ownerId, now);
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

      this.db
        .prepare(
          "UPDATE leases SET last_renewed_at = ?, expires_at = ?, updated_at = ?, version = version + 1 WHERE lease_id = ?"
        )
        .run(nowIso, expiresAt, nowIso, leaseId);

      const renewed = this.#mustGetLease(leaseId);
      if (requestId) {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO renew_idempotency (tenant_id, request_id, snapshot_json) VALUES (?, ?, ?)"
          )
          .run(lease.tenantId, requestId, JSON.stringify(this.#leaseToRowJson(renewed)));
      }
      this.#pushAudit("LEASE_RENEW", renewed.tenantId, renewed.lockKey, renewed.leaseId, ownerId, nowIso);
      return renewed;
    });
  }

  /**
   * @param {{ leaseId: string, ownerId: string, requestId?: string }} params
   */
  release(params) {
    const { leaseId, ownerId, requestId } = params;
    const now = this.now();
    const nowIso = now.toISOString();

    return this.#withTx(() => {
      let lease = this.#mustGetLease(leaseId);
      this.#expireLeaseIfNeeded(lease, now);
      lease = this.#mustGetLease(leaseId);

      if (requestId) {
        const idem = this.db
          .prepare("SELECT snapshot_json FROM release_idempotency WHERE tenant_id = ? AND request_id = ?")
          .get(lease.tenantId, requestId);
        if (idem && idem.snapshot_json) {
          return this.#mapLeaseRow(JSON.parse(idem.snapshot_json));
        }
      }

      this.#assertActiveAndOwned(lease, ownerId, now);

      this.db
        .prepare("UPDATE leases SET status = 'RELEASED', updated_at = ?, version = version + 1 WHERE lease_id = ?")
        .run(nowIso, leaseId);
      this.#clearActiveLease(lease.tenantId, lease.lockKey, leaseId, nowIso);

      const released = this.#mustGetLease(leaseId);
      if (requestId) {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO release_idempotency (tenant_id, request_id, snapshot_json) VALUES (?, ?, ?)"
          )
          .run(lease.tenantId, requestId, JSON.stringify(this.#leaseToRowJson(released)));
      }
      this.#pushAudit("LEASE_RELEASE", lease.tenantId, lease.lockKey, leaseId, ownerId, nowIso);
      return released;
    });
  }

  /**
   * @param {{ tenantId: string, lockKey: string }} params
   */
  getLock(params) {
    const { tenantId, lockKey } = params;
    const now = this.now();
    return this.#withTx(() => {
      this.#expireLockIfNeeded(tenantId, lockKey, now);
      const lock = this.#getLockRecord(tenantId, lockKey);
      if (!lock || !lock.activeLeaseId) {
        return null;
      }
      const lease = this.#getLeaseById(lock.activeLeaseId);
      if (!lease || lease.status !== "ACTIVE") {
        return null;
      }
      return lease;
    });
  }

  /**
   * @param {{ tenantId: string, lockKey: string, actor: string }} params
   */
  forceRelease(params) {
    const { tenantId, lockKey, actor } = params;
    const now = this.now();
    const nowIso = now.toISOString();
    return this.#withTx(() => {
      this.#expireLockIfNeeded(tenantId, lockKey, now);
      const lock = this.#getLockRecord(tenantId, lockKey);
      if (!lock || !lock.activeLeaseId) {
        return null;
      }
      const lease = this.#mustGetLease(lock.activeLeaseId);
      if (lease.status !== "ACTIVE") {
        return null;
      }
      this.db
        .prepare("UPDATE leases SET status = 'RELEASED', updated_at = ?, version = version + 1 WHERE lease_id = ?")
        .run(nowIso, lease.leaseId);
      this.#clearActiveLease(tenantId, lockKey, lease.leaseId, nowIso);
      const released = this.#mustGetLease(lease.leaseId);
      this.#pushAudit("FORCE_RELEASE", tenantId, lockKey, lease.leaseId, actor, nowIso);
      return released;
    });
  }

  expireLeases() {
    const now = this.now();
    const nowIso = now.toISOString();
    return this.#withTx(() => {
      const rows = this.db
        .prepare("SELECT lease_id, tenant_id, lock_key FROM leases WHERE status = 'ACTIVE' AND expires_at <= ?")
        .all(nowIso);
      for (const row of rows) {
        this.db
          .prepare("UPDATE leases SET status = 'EXPIRED', updated_at = ?, version = version + 1 WHERE lease_id = ?")
          .run(nowIso, row.lease_id);
        this.#clearActiveLease(row.tenant_id, row.lock_key, row.lease_id, nowIso);
        this.#pushAudit("LEASE_EXPIRE", row.tenant_id, row.lock_key, row.lease_id, "system", nowIso);
      }
      return rows.length;
    });
  }

  debugState() {
    const leases = this.db.prepare("SELECT * FROM leases").all().map((row) => this.#mapLeaseRow(row));
    const lockRecords = this.db
      .prepare("SELECT tenant_id, lock_key, active_lease_id, current_fencing_token FROM lock_records")
      .all()
      .map((row) => ({
        tenantId: row.tenant_id,
        lockKey: row.lock_key,
        activeLeaseId: row.active_lease_id,
        currentFencingToken: row.current_fencing_token
      }));
    const auditLogs = this.db
      .prepare("SELECT action, tenant_id, lock_key, lease_id, at, actor FROM audit_logs ORDER BY id")
      .all()
      .map((row) => ({
        action: row.action,
        tenantId: row.tenant_id,
        lockKey: row.lock_key,
        leaseId: row.lease_id,
        at: row.at,
        actor: row.actor
      }));
    return { leases, lockRecords, auditLogs };
  }

  static acceptsFencingToken(storedToken, incomingToken) {
    return incomingToken > storedToken;
  }

  #initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lock_records (
        tenant_id TEXT NOT NULL,
        lock_key TEXT NOT NULL,
        active_lease_id TEXT NULL,
        current_fencing_token INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, lock_key)
      );
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lock_key TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_renewed_at TEXT NULL,
        fencing_token INTEGER NOT NULL,
        idempotency_key TEXT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS acquire_idempotency (
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        PRIMARY KEY (tenant_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS renew_idempotency (
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS release_idempotency (
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        lock_key TEXT NOT NULL,
        lease_id TEXT NULL,
        at TEXT NOT NULL,
        actor TEXT NOT NULL
      );
    `);
  }

  #withTx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  #validateTtl(ttlSeconds) {
    if (!Number.isInteger(ttlSeconds)) {
      throw new LeaseManagerError("ttl_seconds must be integer", "INVALID_TTL", 400);
    }
    if (ttlSeconds < this.minTtlSeconds || ttlSeconds > this.maxTtlSeconds) {
      throw new LeaseManagerError(
        `ttl_seconds must be in range ${this.minTtlSeconds}-${this.maxTtlSeconds}`,
        "INVALID_TTL",
        400
      );
    }
  }

  #getOrCreateLockRecord(tenantId, lockKey, nowIso) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO lock_records (tenant_id, lock_key, active_lease_id, current_fencing_token, updated_at) VALUES (?, ?, NULL, 0, ?)"
      )
      .run(tenantId, lockKey, nowIso);
    return this.#getLockRecord(tenantId, lockKey);
  }

  #getLockRecord(tenantId, lockKey) {
    const row = this.db
      .prepare(
        "SELECT tenant_id, lock_key, active_lease_id, current_fencing_token, updated_at FROM lock_records WHERE tenant_id = ? AND lock_key = ?"
      )
      .get(tenantId, lockKey);
    if (!row) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      lockKey: row.lock_key,
      activeLeaseId: row.active_lease_id,
      currentFencingToken: row.current_fencing_token,
      updatedAt: row.updated_at
    };
  }

  #mustGetLease(leaseId) {
    const lease = this.#getLeaseById(leaseId);
    if (!lease) {
      throw new LeaseManagerError("lease not found", "LEASE_NOT_FOUND", 404);
    }
    return lease;
  }

  #getLeaseById(leaseId) {
    const row = this.db.prepare("SELECT * FROM leases WHERE lease_id = ?").get(leaseId);
    if (!row) {
      return null;
    }
    return this.#mapLeaseRow(row);
  }

  #mapLeaseRow(row) {
    return {
      leaseId: row.lease_id ?? row.leaseId,
      tenantId: row.tenant_id ?? row.tenantId,
      lockKey: row.lock_key ?? row.lockKey,
      ownerId: row.owner_id ?? row.ownerId,
      status: row.status,
      acquiredAt: row.acquired_at ?? row.acquiredAt,
      expiresAt: row.expires_at ?? row.expiresAt,
      lastRenewedAt: row.last_renewed_at ?? row.lastRenewedAt ?? null,
      fencingToken: row.fencing_token ?? row.fencingToken,
      idempotencyKey: row.idempotency_key ?? row.idempotencyKey ?? null,
      version: row.version,
      createdAt: row.created_at ?? row.createdAt,
      updatedAt: row.updated_at ?? row.updatedAt
    };
  }

  #leaseToRowJson(lease) {
    return {
      lease_id: lease.leaseId,
      tenant_id: lease.tenantId,
      lock_key: lease.lockKey,
      owner_id: lease.ownerId,
      status: lease.status,
      acquired_at: lease.acquiredAt,
      expires_at: lease.expiresAt,
      last_renewed_at: lease.lastRenewedAt,
      fencing_token: lease.fencingToken,
      idempotency_key: lease.idempotencyKey,
      version: lease.version,
      created_at: lease.createdAt,
      updated_at: lease.updatedAt
    };
  }

  #assertActiveAndOwned(lease, ownerId, now) {
    if (lease.status !== "ACTIVE") {
      throw new LeaseManagerError("lease is not active", "LEASE_NOT_ACTIVE", 409);
    }
    if (new Date(lease.expiresAt) <= now) {
      throw new LeaseManagerError("lease is expired", "LEASE_EXPIRED", 409);
    }
    if (lease.ownerId !== ownerId) {
      throw new LeaseManagerError("owner mismatch", "OWNER_MISMATCH", 409);
    }
  }

  #expireLockIfNeeded(tenantId, lockKey, now) {
    const lock = this.#getLockRecord(tenantId, lockKey);
    if (!lock || !lock.activeLeaseId) {
      return;
    }
    const lease = this.#getLeaseById(lock.activeLeaseId);
    if (!lease) {
      this.db
        .prepare("UPDATE lock_records SET active_lease_id = NULL, updated_at = ? WHERE tenant_id = ? AND lock_key = ?")
        .run(now.toISOString(), tenantId, lockKey);
      return;
    }
    this.#expireLeaseIfNeeded(lease, now);
  }

  #expireLeaseIfNeeded(lease, now) {
    if (lease.status !== "ACTIVE" || new Date(lease.expiresAt) > now) {
      return;
    }
    const nowIso = now.toISOString();
    this.db
      .prepare("UPDATE leases SET status = 'EXPIRED', updated_at = ?, version = version + 1 WHERE lease_id = ?")
      .run(nowIso, lease.leaseId);
    this.#clearActiveLease(lease.tenantId, lease.lockKey, lease.leaseId, nowIso);
    this.#pushAudit("LEASE_EXPIRE", lease.tenantId, lease.lockKey, lease.leaseId, "system", nowIso);
  }

  #clearActiveLease(tenantId, lockKey, leaseId, nowIso) {
    this.db
      .prepare(
        "UPDATE lock_records SET active_lease_id = CASE WHEN active_lease_id = ? THEN NULL ELSE active_lease_id END, updated_at = ? WHERE tenant_id = ? AND lock_key = ?"
      )
      .run(leaseId, nowIso, tenantId, lockKey);
  }

  #pushAudit(action, tenantId, lockKey, leaseId, actor, nowIso) {
    this.db
      .prepare("INSERT INTO audit_logs (action, tenant_id, lock_key, lease_id, at, actor) VALUES (?, ?, ?, ?, ?, ?)")
      .run(action, tenantId, lockKey, leaseId, nowIso, actor);
  }
}
