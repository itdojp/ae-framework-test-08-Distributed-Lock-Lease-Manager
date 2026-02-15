import http from "node:http";
import { URL } from "node:url";

import { LeaseManager, LeaseManagerError } from "./index.mjs";

const manager = new LeaseManager();

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
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handler(req, res) {
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
        tenantId: String(body.tenant_id ?? ""),
        lockKey: String(body.lock_key ?? ""),
        ownerId: String(body.owner_id ?? ""),
        ttlSeconds: Number(body.ttl_seconds),
        requestId: String(body.request_id ?? "")
      });
      return writeJson(res, 201, toLeaseResponse(lease));
    }

    const renewMatch = pathname.match(/^\/leases\/([^/]+)\/renew$/);
    if (method === "POST" && renewMatch) {
      const body = await readJson(req);
      const lease = manager.renew({
        leaseId: decodeURIComponent(renewMatch[1]),
        ownerId: String(body.owner_id ?? ""),
        ttlSeconds: Number(body.ttl_seconds),
        requestId: String(body.request_id ?? "")
      });
      return writeJson(res, 200, toLeaseResponse(lease));
    }

    const releaseMatch = pathname.match(/^\/leases\/([^/]+)\/release$/);
    if (method === "POST" && releaseMatch) {
      const body = await readJson(req);
      const lease = manager.release({
        leaseId: decodeURIComponent(releaseMatch[1]),
        ownerId: String(body.owner_id ?? ""),
        requestId: String(body.request_id ?? "")
      });
      return writeJson(res, 200, toLeaseResponse(lease));
    }

    const lockMatch = pathname.match(/^\/locks\/([^/]+)$/);
    if (method === "GET" && lockMatch) {
      const lockKey = decodeURIComponent(lockMatch[1]);
      const tenantId = url.searchParams.get("tenant_id") ?? "";
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
      const lockKey = decodeURIComponent(forceMatch[1]);
      const body = await readJson(req);
      const tenantId = String(body.tenant_id ?? "");
      const actor = String(body.actor ?? "admin");
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
 * @returns {http.Server}
 */
export function createServer() {
  return http.createServer((req, res) => {
    void handler(req, res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`lease-manager server listening on :${port}\n`);
  });
}
