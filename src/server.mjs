import http from "node:http";
import { URL } from "node:url";

import { LeaseManager, LeaseManagerError } from "./index.mjs";

/**
 * @param {import("./lease-manager.mjs").LeaseRecord} lease
 */
function toLeaseResponse(lease) {
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
    server_time: new Date().toISOString()
  };
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

/**
 * @param {http.IncomingHttpHeaders} headers
 * @param {string} name
 * @returns {string|null}
 */
function headerValue(headers, name) {
  const raw = headers[name];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string" && raw[0].length > 0) {
    return raw[0];
  }
  return null;
}

/**
 * @param {http.IncomingHttpHeaders} headers
 * @returns {string|null}
 */
function headerOwner(headers) {
  return headerValue(headers, "x-owner-id");
}

/**
 * @param {http.IncomingHttpHeaders} headers
 */
function requireAdmin(headers) {
  const role = headerValue(headers, "x-role");
  if (role !== "ADMIN") {
    throw new LeaseManagerError("admin role required", "FORBIDDEN", 403);
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireString(value, field) {
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
function requireInteger(value, field) {
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new LeaseManagerError(`${field} must be integer`, "INVALID_REQUEST", 400);
  }
  return num;
}

/**
 * @param {http.IncomingMessage} req
 * @param {Record<string, unknown>} body
 * @returns {string}
 */
function resolveOwnerId(req, body) {
  const tokenOwner = headerOwner(req.headers);
  const requestedOwner = requireString(body.owner_id, "owner_id");
  if (tokenOwner && requestedOwner !== tokenOwner) {
    throw new LeaseManagerError("owner_id does not match authenticated identity", "OWNER_TOKEN_MISMATCH", 401);
  }
  return tokenOwner ?? requestedOwner;
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {LeaseManager} manager
 */
async function handler(req, res, manager) {
  try {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/health") {
      return writeJson(res, 200, { status: "ok", server_time: new Date().toISOString() });
    }

    if (method === "POST" && pathname === "/leases/acquire") {
      const body = await readJson(req);
      const lease = manager.acquire({
        tenantId: requireString(body.tenant_id, "tenant_id"),
        lockKey: requireString(body.lock_key, "lock_key"),
        ownerId: resolveOwnerId(req, body),
        ttlSeconds: requireInteger(body.ttl_seconds, "ttl_seconds"),
        requestId: requireString(body.request_id, "request_id")
      });
      return writeJson(res, 201, toLeaseResponse(lease));
    }

    const renewMatch = pathname.match(/^\/leases\/([^/]+)\/renew$/);
    if (method === "POST" && renewMatch) {
      const body = await readJson(req);
      const lease = manager.renew({
        leaseId: decodeURIComponent(renewMatch[1]),
        ownerId: resolveOwnerId(req, body),
        ttlSeconds: requireInteger(body.ttl_seconds, "ttl_seconds"),
        requestId: requireString(body.request_id, "request_id")
      });
      return writeJson(res, 200, toLeaseResponse(lease));
    }

    const releaseMatch = pathname.match(/^\/leases\/([^/]+)\/release$/);
    if (method === "POST" && releaseMatch) {
      const body = await readJson(req);
      const lease = manager.release({
        leaseId: decodeURIComponent(releaseMatch[1]),
        ownerId: resolveOwnerId(req, body),
        requestId: requireString(body.request_id, "request_id")
      });
      return writeJson(res, 200, toLeaseResponse(lease));
    }

    const lockMatch = pathname.match(/^\/locks\/([^/]+)$/);
    if (method === "GET" && lockMatch) {
      const lockKey = decodeURIComponent(lockMatch[1]);
      const tenantId = requireString(url.searchParams.get("tenant_id"), "tenant_id");
      const lease = manager.getLock({ tenantId, lockKey });
      return writeJson(res, 200, {
        tenant_id: tenantId,
        lock_key: lockKey,
        has_active_lease: Boolean(lease),
        active_lease: lease ? toLeaseResponse(lease) : null,
        server_time: new Date().toISOString()
      });
    }

    const forceMatch = pathname.match(/^\/locks\/([^/]+)\/force-release$/);
    if (method === "POST" && forceMatch) {
      requireAdmin(req.headers);
      const lockKey = decodeURIComponent(forceMatch[1]);
      const body = await readJson(req);
      const tenantId = requireString(body.tenant_id, "tenant_id");
      const actor = requireString(body.actor, "actor");
      const lease = manager.forceRelease({ tenantId, lockKey, actor });
      return writeJson(res, 200, {
        tenant_id: tenantId,
        lock_key: lockKey,
        has_active_lease: false,
        active_lease: lease ? toLeaseResponse(lease) : null,
        server_time: new Date().toISOString()
      });
    }

    return writeJson(res, 404, {
      code: "NOT_FOUND",
      message: "route not found",
      status: 404,
      server_time: new Date().toISOString()
    });
  } catch (err) {
    if (err instanceof LeaseManagerError) {
      return writeJson(res, err.status, {
        code: err.code,
        message: err.message,
        status: err.status,
        server_time: new Date().toISOString()
      });
    }
    if (err instanceof SyntaxError) {
      return writeJson(res, 400, {
        code: "INVALID_JSON",
        message: "invalid request body",
        status: 400,
        server_time: new Date().toISOString()
      });
    }
    return writeJson(res, 500, {
      code: "INTERNAL_ERROR",
      message: "unexpected server error",
      status: 500,
      server_time: new Date().toISOString()
    });
  }
}

/**
 * @param {{ manager?: LeaseManager }} [options]
 * @returns {http.Server}
 */
export function createServer(options = {}) {
  const manager = options.manager ?? new LeaseManager();
  return http.createServer((req, res) => {
    void handler(req, res, manager);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`lease-manager server listening on :${port}\n`);
  });
}
