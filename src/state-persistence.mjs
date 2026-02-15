import fs from "node:fs/promises";
import path from "node:path";

import { LeaseManager } from "./lease-manager.mjs";

/**
 * @param {string} filePath
 * @param {LeaseManager} manager
 * @param {{ note?: string }} [options]
 * @returns {Promise<{ version: number, saved_at: string, note: string, state: ReturnType<LeaseManager["exportState"]> }>}
 */
export async function saveManagerSnapshot(filePath, manager, options = {}) {
  const payload = {
    version: 1,
    saved_at: new Date().toISOString(),
    note: options.note ?? "",
    state: manager.exportState()
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
  return payload;
}

/**
 * @param {string} filePath
 * @param {{ now?: () => Date, minTtlSeconds?: number, maxTtlSeconds?: number }} [options]
 * @returns {Promise<{ manager: LeaseManager, payload: { version: number, saved_at: string, note: string, state: any } }>}
 */
export async function loadManagerSnapshot(filePath, options = {}) {
  const raw = await fs.readFile(filePath, "utf-8");
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== "object" || !payload.state) {
    throw new Error("invalid snapshot payload");
  }
  const manager = LeaseManager.fromState(payload.state, options);
  return { manager, payload };
}
