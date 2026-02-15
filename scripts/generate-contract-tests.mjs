#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const openapiPath = getArg("--openapi", "contracts/openapi.yaml");
const outDir = getArg("--out-dir", "tests/contracts/generated");
const summaryDir = getArg("--summary-dir", "artifacts/generated-contract-tests");
const force = process.argv.includes("--force");

if (!fs.existsSync(openapiPath)) {
  console.error(`openapi file not found: ${openapiPath}`);
  process.exit(1);
}

const content = fs.readFileSync(openapiPath, "utf-8");
const lines = content.split(/\r?\n/);

/** @type {Array<{ method: string, path: string, operationId: string }>} */
const operations = [];
let currentPath = null;
let currentMethod = null;

for (const line of lines) {
  const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
  if (pathMatch) {
    currentPath = pathMatch[1];
    currentMethod = null;
    continue;
  }

  const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
  if (methodMatch) {
    currentMethod = methodMatch[1].toUpperCase();
    continue;
  }

  const opMatch = line.match(/^      operationId:\s*(.+)\s*$/);
  if (opMatch && currentPath && currentMethod) {
    operations.push({
      method: currentMethod,
      path: currentPath,
      operationId: opMatch[1].trim()
    });
  }
}

if (operations.length === 0) {
  console.error("no operationId found in OpenAPI file");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const generated = [];

for (const op of operations) {
  const fileName = `${op.operationId}.generated.test.mjs`;
  const targetPath = path.join(outDir, fileName);
  if (!force && fs.existsSync(targetPath)) {
    continue;
  }
  const template = `import test from "node:test";
import assert from "node:assert/strict";

test.skip("contract template: ${op.operationId}", async () => {
  const method = "${op.method}";
  const routePath = "${op.path}";
  assert.ok(method.length > 0);
  assert.ok(routePath.startsWith("/"));
});
`;
  fs.writeFileSync(targetPath, template, "utf-8");
  generated.push({
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    file: targetPath
  });
}

fs.mkdirSync(summaryDir, { recursive: true });
const summary = {
  openapiPath,
  outDir,
  generatedCount: generated.length,
  operationCount: operations.length,
  operations,
  generated,
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(summaryDir, "latest.json"), JSON.stringify(summary, null, 2), "utf-8");

console.log(`parsed operations: ${operations.length}`);
console.log(`generated files: ${generated.length}`);
console.log(`summary: ${path.join(summaryDir, "latest.json")}`);
