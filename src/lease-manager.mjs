/**
 * @typedef {"ACTIVE"|"RELEASED"|"EXPIRED"} LeaseStatus
 */

/**
 * @typedef {Object} LeaseRecord
 * @property {string} leaseId
 * @property {string} tenantId
 * @property {string} lockKey
 * @property {string} ownerId
 * @property {LeaseStatus} status
 * @property {string} acquiredAt
 * @property {string} expiresAt
 * @property {string|null} lastRenewedAt
 * @property {number} fencingToken
 * @property {string|null} idempotencyKey
 * @property {number} version
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export class LeaseManagerError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} status
   */
  constructor(message, code, status) {
    super(message);
    this.name = "LeaseManagerError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Distributed lock/lease manager in-memory reference implementation.
 * This implementation is intentionally explicit for testability.
 */
export class LeaseManager {
  /**
   * @param {{ now?: () => Date, minTtlSeconds?: number, maxTtlSeconds?: number }} [options]
   */
  constructor(options = {}) {
    this.now = options.now ?? (() => new Date());
    this.minTtlSeconds = options.minTtlSeconds ?? 10;
    this.maxTtlSeconds = options.maxTtlSeconds ?? 300;

    /** @type {Map<string, LeaseRecord>} */
    this.leasesById = new Map();
    /** @type {Map<string, { activeLeaseId: string|null, currentFencingToken: number, updatedAt: string }>} */
    this.lockRecords = new Map();
    /** @type {Map<string, string>} */
    this.acquireIdempotency = new Map();
    /** @type {Map<string, LeaseRecord>} */
    this.renewIdempotency = new Map();
    /** @type {Map<string, LeaseRecord>} */
    this.releaseIdempotency = new Map();
    /** @type {Array<{ action: string, tenantId: string, lockKey: string, leaseId: string|null, at: string, actor: string }>} */
    this.auditLogs = [];
  }

  /**
   * @param {{ tenantId: string, lockKey: string, ownerId: string, ttlSeconds: number, requestId?: string }} params
   * @returns {LeaseRecord}
   */
  acquire(params) {
    const { tenantId, lockKey, ownerId, ttlSeconds, requestId } = params;
    this.#validateTtl(ttlSeconds);
    const now = this.now();
    this.#expireLockIfNeeded(tenantId, lockKey, now);

    if (requestId) {
      const idempotencyKey = this.#idempotencyKey(tenantId, requestId);
      const existingLeaseId = this.acquireIdempotency.get(idempotencyKey);
      if (existingLeaseId) {
        const existingLease = this.leasesById.get(existingLeaseId);
        if (existingLease && existingLease.status === "ACTIVE" && new Date(existingLease.expiresAt) > now) {
          return this.#cloneLease(existingLease);
        }
      }
    }

    const recordKey = this.#recordKey(tenantId, lockKey);
    const lockRecord = this.lockRecords.get(recordKey) ?? {
      activeLeaseId: null,
      currentFencingToken: 0,
      updatedAt: now.toISOString()
    };

    if (lockRecord.activeLeaseId) {
      const activeLease = this.leasesById.get(lockRecord.activeLeaseId);
      if (activeLease && activeLease.status === "ACTIVE" && new Date(activeLease.expiresAt) > now) {
        throw new LeaseManagerError("lock is currently held", "LOCK_HELD", 409);
      }
    }

    const fencingToken = lockRecord.currentFencingToken + 1;
    const leaseId = `lease-${tenantId}-${lockKey}-${fencingToken}`;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    /** @type {LeaseRecord} */
    const lease = {
      leaseId,
      tenantId,
      lockKey,
      ownerId,
      status: "ACTIVE",
      acquiredAt: now.toISOString(),
      expiresAt,
      lastRenewedAt: null,
      fencingToken,
      idempotencyKey: requestId ?? null,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.leasesById.set(leaseId, lease);
    this.lockRecords.set(recordKey, {
      activeLeaseId: leaseId,
      currentFencingToken: fencingToken,
      updatedAt: now.toISOString()
    });

    if (requestId) {
      this.acquireIdempotency.set(this.#idempotencyKey(tenantId, requestId), leaseId);
    }
    this.#pushAudit("LEASE_ACQUIRE", tenantId, lockKey, leaseId, ownerId, now);
    return this.#cloneLease(lease);
  }

  /**
   * @param {{ leaseId: string, ownerId: string, ttlSeconds: number, requestId?: string }} params
   * @returns {LeaseRecord}
   */
  renew(params) {
    const { leaseId, ownerId, ttlSeconds, requestId } = params;
    this.#validateTtl(ttlSeconds);
    const lease = this.#mustGetLease(leaseId);
    const now = this.now();
    this.#expireLeaseIfNeeded(lease, now);

    if (requestId) {
      const idempotencyKey = this.#idempotencyKey(lease.tenantId, requestId);
      const existing = this.renewIdempotency.get(idempotencyKey);
      if (existing) {
        return this.#cloneLease(existing);
      }
    }

    this.#assertActiveAndOwned(lease, ownerId, now);

    lease.lastRenewedAt = now.toISOString();
    lease.expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    lease.updatedAt = now.toISOString();
    lease.version += 1;

    if (requestId) {
      this.renewIdempotency.set(this.#idempotencyKey(lease.tenantId, requestId), this.#cloneLease(lease));
    }
    this.#pushAudit("LEASE_RENEW", lease.tenantId, lease.lockKey, lease.leaseId, ownerId, now);
    return this.#cloneLease(lease);
  }

  /**
   * @param {{ leaseId: string, ownerId: string, requestId?: string }} params
   * @returns {LeaseRecord}
   */
  release(params) {
    const { leaseId, ownerId, requestId } = params;
    const lease = this.#mustGetLease(leaseId);
    const now = this.now();
    this.#expireLeaseIfNeeded(lease, now);

    if (requestId) {
      const idempotencyKey = this.#idempotencyKey(lease.tenantId, requestId);
      const existing = this.releaseIdempotency.get(idempotencyKey);
      if (existing) {
        return this.#cloneLease(existing);
      }
    }

    this.#assertActiveAndOwned(lease, ownerId, now);
    lease.status = "RELEASED";
    lease.updatedAt = now.toISOString();
    lease.version += 1;
    this.#clearActiveLease(lease.tenantId, lease.lockKey, lease.leaseId, now);

    if (requestId) {
      this.releaseIdempotency.set(this.#idempotencyKey(lease.tenantId, requestId), this.#cloneLease(lease));
    }
    this.#pushAudit("LEASE_RELEASE", lease.tenantId, lease.lockKey, lease.leaseId, ownerId, now);
    return this.#cloneLease(lease);
  }

  /**
   * @param {{ tenantId: string, lockKey: string }} params
   * @returns {LeaseRecord|null}
   */
  getLock(params) {
    const { tenantId, lockKey } = params;
    const now = this.now();
    this.#expireLockIfNeeded(tenantId, lockKey, now);
    const record = this.lockRecords.get(this.#recordKey(tenantId, lockKey));
    if (!record || !record.activeLeaseId) {
      return null;
    }
    const lease = this.leasesById.get(record.activeLeaseId);
    if (!lease || lease.status !== "ACTIVE") {
      return null;
    }
    return this.#cloneLease(lease);
  }

  /**
   * @param {{ tenantId: string, lockKey: string, actor: string }} params
   * @returns {LeaseRecord|null}
   */
  forceRelease(params) {
    const { tenantId, lockKey, actor } = params;
    const now = this.now();
    this.#expireLockIfNeeded(tenantId, lockKey, now);
    const record = this.lockRecords.get(this.#recordKey(tenantId, lockKey));
    if (!record || !record.activeLeaseId) {
      return null;
    }
    const lease = this.leasesById.get(record.activeLeaseId);
    if (!lease || lease.status !== "ACTIVE") {
      return null;
    }
    lease.status = "RELEASED";
    lease.updatedAt = now.toISOString();
    lease.version += 1;
    this.#clearActiveLease(tenantId, lockKey, lease.leaseId, now);
    this.#pushAudit("FORCE_RELEASE", tenantId, lockKey, lease.leaseId, actor, now);
    return this.#cloneLease(lease);
  }

  /**
   * Expire all expired active leases. Idempotent by design.
   * @returns {number} number of expired leases
   */
  expireLeases() {
    const now = this.now();
    let changed = 0;
    for (const lease of this.leasesById.values()) {
      if (lease.status === "ACTIVE" && new Date(lease.expiresAt) <= now) {
        lease.status = "EXPIRED";
        lease.updatedAt = now.toISOString();
        lease.version += 1;
        this.#clearActiveLease(lease.tenantId, lease.lockKey, lease.leaseId, now);
        this.#pushAudit("LEASE_EXPIRE", lease.tenantId, lease.lockKey, lease.leaseId, "system", now);
        changed += 1;
      }
    }
    return changed;
  }

  /**
   * @returns {{
   * leases: LeaseRecord[],
   * lockRecords: Array<{ tenantId: string, lockKey: string, activeLeaseId: string|null, currentFencingToken: number }>,
   * auditLogs: Array<{ action: string, tenantId: string, lockKey: string, leaseId: string|null, at: string, actor: string }>
   * }}
   */
  debugState() {
    const leases = Array.from(this.leasesById.values(), (lease) => this.#cloneLease(lease));
    const lockRecords = Array.from(this.lockRecords.entries(), ([key, value]) => {
      const [tenantId, lockKey] = key.split("::");
      return {
        tenantId,
        lockKey,
        activeLeaseId: value.activeLeaseId,
        currentFencingToken: value.currentFencingToken
      };
    });
    return {
      leases,
      lockRecords,
      auditLogs: [...this.auditLogs]
    };
  }

  /**
   * @param {number} storedToken
   * @param {number} incomingToken
   * @returns {boolean}
   */
  static acceptsFencingToken(storedToken, incomingToken) {
    return incomingToken > storedToken;
  }

  /**
   * @param {number} ttlSeconds
   */
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

  /**
   * @param {string} leaseId
   * @returns {LeaseRecord}
   */
  #mustGetLease(leaseId) {
    const lease = this.leasesById.get(leaseId);
    if (!lease) {
      throw new LeaseManagerError("lease not found", "LEASE_NOT_FOUND", 404);
    }
    return lease;
  }

  /**
   * @param {LeaseRecord} lease
   * @param {string} ownerId
   * @param {Date} now
   */
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

  /**
   * @param {LeaseRecord} lease
   * @param {Date} now
   */
  #expireLeaseIfNeeded(lease, now) {
    if (lease.status === "ACTIVE" && new Date(lease.expiresAt) <= now) {
      lease.status = "EXPIRED";
      lease.updatedAt = now.toISOString();
      lease.version += 1;
      this.#clearActiveLease(lease.tenantId, lease.lockKey, lease.leaseId, now);
      this.#pushAudit("LEASE_EXPIRE", lease.tenantId, lease.lockKey, lease.leaseId, "system", now);
    }
  }

  /**
   * @param {string} tenantId
   * @param {string} lockKey
   * @param {Date} now
   */
  #expireLockIfNeeded(tenantId, lockKey, now) {
    const record = this.lockRecords.get(this.#recordKey(tenantId, lockKey));
    if (!record || !record.activeLeaseId) {
      return;
    }
    const lease = this.leasesById.get(record.activeLeaseId);
    if (!lease) {
      record.activeLeaseId = null;
      record.updatedAt = now.toISOString();
      return;
    }
    this.#expireLeaseIfNeeded(lease, now);
  }

  /**
   * @param {string} tenantId
   * @param {string} lockKey
   * @param {string} leaseId
   * @param {Date} now
   */
  #clearActiveLease(tenantId, lockKey, leaseId, now) {
    const key = this.#recordKey(tenantId, lockKey);
    const record = this.lockRecords.get(key);
    if (!record) {
      return;
    }
    if (record.activeLeaseId === leaseId) {
      record.activeLeaseId = null;
      record.updatedAt = now.toISOString();
    }
  }

  /**
   * @param {string} action
   * @param {string} tenantId
   * @param {string} lockKey
   * @param {string|null} leaseId
   * @param {string} actor
   * @param {Date} now
   */
  #pushAudit(action, tenantId, lockKey, leaseId, actor, now) {
    this.auditLogs.push({
      action,
      tenantId,
      lockKey,
      leaseId,
      at: now.toISOString(),
      actor
    });
  }

  /**
   * @param {LeaseRecord} lease
   * @returns {LeaseRecord}
   */
  #cloneLease(lease) {
    return structuredClone(lease);
  }

  /**
   * @param {string} tenantId
   * @param {string} lockKey
   * @returns {string}
   */
  #recordKey(tenantId, lockKey) {
    return `${tenantId}::${lockKey}`;
  }

  /**
   * @param {string} tenantId
   * @param {string} requestId
   * @returns {string}
   */
  #idempotencyKey(tenantId, requestId) {
    return `${tenantId}::${requestId}`;
  }
}
