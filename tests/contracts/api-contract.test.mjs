import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../../src/server.mjs";
import { JsonSchemaLite } from "../helpers/json-schema-lite.mjs";

const validator = new JsonSchemaLite(process.cwd());

/**
 * @param {number} port
 * @param {string} path
 * @param {RequestInit} init
 */
async function api(port, path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const data = await response.json();
  return { response, data };
}

/**
 * @param {string} schemaPath
 * @param {unknown} payload
 */
function assertSchema(schemaPath, payload) {
  const schema = validator.load(schemaPath);
  const errors = validator.validate(schema, payload, schemaPath);
  assert.deepEqual(errors, [], `schema violations for ${schemaPath}: ${errors.join(" | ")}`);
}

test("Contract: acquire/release/get/force-release の応答はSchema準拠", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  t.after(() => server.close());

  const acq = await api(port, "/leases/acquire", {
    method: "POST",
    headers: { "content-type": "application/json", "x-owner-id": "workerA" },
    body: JSON.stringify({
      tenant_id: "tenantA",
      request_id: "req-contract-1",
      lock_key: "order:contract",
      owner_id: "workerA",
      ttl_seconds: 30
    })
  });
  assert.equal(acq.response.status, 201);
  assertSchema("schema/lease-response.schema.json", acq.data);

  const get = await api(port, "/locks/order%3Acontract?tenant_id=tenantA");
  assert.equal(get.response.status, 200);
  assertSchema("schema/lock-state-response.schema.json", get.data);
  assert.equal(get.data.has_active_lease, true);

  const forceRelease = await api(port, "/locks/order%3Acontract/force-release", {
    method: "POST",
    headers: { "content-type": "application/json", "x-role": "ADMIN" },
    body: JSON.stringify({
      tenant_id: "tenantA",
      actor: "adminA"
    })
  });
  assert.equal(forceRelease.response.status, 200);
  assertSchema("schema/lock-state-response.schema.json", forceRelease.data);
  assert.equal(forceRelease.data.has_active_lease, false);
});

test("Contract: エラー応答はErrorResponse準拠", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  t.after(() => server.close());

  const invalid = await api(port, "/leases/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "",
      request_id: "req-contract-invalid",
      lock_key: "order:invalid",
      owner_id: "workerA",
      ttl_seconds: 30
    })
  });
  assert.equal(invalid.response.status, 400);
  assertSchema("schema/error-response.schema.json", invalid.data);

  const ownerMismatch = await api(port, "/leases/acquire", {
    method: "POST",
    headers: { "content-type": "application/json", "x-owner-id": "workerA" },
    body: JSON.stringify({
      tenant_id: "tenantA",
      request_id: "req-contract-mismatch",
      lock_key: "order:mismatch",
      owner_id: "workerB",
      ttl_seconds: 30
    })
  });
  assert.equal(ownerMismatch.response.status, 401);
  assertSchema("schema/error-response.schema.json", ownerMismatch.data);

  const forbidden = await api(port, "/locks/order%3Amissing-admin/force-release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenantA",
      actor: "memberA"
    })
  });
  assert.equal(forbidden.response.status, 403);
  assertSchema("schema/error-response.schema.json", forbidden.data);
});
