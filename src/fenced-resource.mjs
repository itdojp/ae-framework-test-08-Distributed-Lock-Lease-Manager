import { LeaseManager, LeaseManagerError } from "./lease-manager.mjs";

/**
 * Downstream resource sample guarded by fencing tokens.
 * Updates are accepted only when incoming token is strictly newer.
 */
export class FencedResourceStore {
  constructor() {
    /** @type {Map<string, { resourceKey: string, value: unknown, lastFencingToken: number, actor: string, updatedAt: string }>} */
    this.records = new Map();
  }

  /**
   * @param {{ resourceKey: string, value: unknown, fencingToken: number, actor: string }} params
   */
  update(params) {
    const resourceKey = this.#requireString(params.resourceKey, "resourceKey");
    const actor = this.#requireString(params.actor, "actor");
    const fencingToken = this.#requirePositiveInteger(params.fencingToken, "fencingToken");
    const current = this.records.get(resourceKey);
    const currentToken = current?.lastFencingToken ?? 0;

    if (!LeaseManager.acceptsFencingToken(currentToken, fencingToken)) {
      throw new LeaseManagerError("stale fencing token", "STALE_FENCING_TOKEN", 409);
    }

    const next = {
      resourceKey,
      value: params.value ?? null,
      lastFencingToken: fencingToken,
      actor,
      updatedAt: new Date().toISOString()
    };
    this.records.set(resourceKey, next);
    return structuredClone(next);
  }

  /**
   * @param {string} resourceKey
   */
  get(resourceKey) {
    const key = this.#requireString(resourceKey, "resourceKey");
    const record = this.records.get(key);
    return record ? structuredClone(record) : null;
  }

  /**
   * @param {unknown} value
   * @param {string} field
   * @returns {string}
   */
  #requireString(value, field) {
    if (typeof value !== "string" || value.length === 0) {
      throw new LeaseManagerError(`${field} is required`, "INVALID_REQUEST", 400);
    }
    return value;
  }

  /**
   * @param {unknown} value
   * @param {string} field
   * @returns {number}
   */
  #requirePositiveInteger(value, field) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
      throw new LeaseManagerError(`${field} must be positive integer`, "INVALID_REQUEST", 400);
    }
    return num;
  }
}
