#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const RUNS_ROOT = path.resolve("artifacts/runs");
const INDEX_JSON = path.join(RUNS_ROOT, "index.json");
const INDEX_MD = path.join(RUNS_ROOT, "index.md");

function toInt(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asIsoOrNull(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt.toISOString();
}

function inferIsoFromDirName(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  if (!m) {
    return null;
  }
  const [, y, mm, d, h, mi, s] = m;
  return `${y}-${mm}-${d}T${h}:${mi}:${s}Z`;
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.name === "SyntaxError")) {
      return null;
    }
    throw err;
  }
}

function byRecentDesc(a, b) {
  const ta = Date.parse(a.executed_at_utc ?? "") || 0;
  const tb = Date.parse(b.executed_at_utc ?? "") || 0;
  if (tb !== ta) {
    return tb - ta;
  }
  return a.run_dir.localeCompare(b.run_dir);
}

function statusBucket(status) {
  if (status === "success" || status === "failed" || status === "aborted") {
    return status;
  }
  return "unknown";
}

function mdEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

async function collectRunEntries() {
  const dirents = await fs.readdir(RUNS_ROOT, { withFileTypes: true });
  const runDirs = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const runs = [];
  for (const runDir of runDirs) {
    const absDir = path.join(RUNS_ROOT, runDir);
    const metadataPath = path.join(absDir, "metadata.json");
    const metadata = await readJsonIfExists(metadataPath);
    const ghaMetaPath = path.join(absDir, "gha-artifact-download.json");
    const ghaMeta = await readJsonIfExists(ghaMetaPath);
    if (!metadata && !ghaMeta) {
      continue;
    }

    const runId =
      metadata?.run_id ??
      (ghaMeta?.run_id
        ? `gha-${ghaMeta.run_id}-${ghaMeta.run_attempt ?? 1}`
        : runDir);
    const optionalFailures = Array.isArray(metadata?.optional_failures)
      ? metadata.optional_failures
      : [];
    const optionalResults = Array.isArray(metadata?.optional_results)
      ? metadata.optional_results
      : [];
    const optionalFailCount =
      metadata?.optional_fail_count !== undefined
        ? toInt(metadata.optional_fail_count, 0)
        : optionalFailures.length;
    const optionalStepCount =
      metadata?.optional_step_count !== undefined
        ? toInt(metadata.optional_step_count, 0)
        : optionalResults.length;

    const executedAt =
      asIsoOrNull(metadata?.executed_at_utc) ??
      inferIsoFromDirName(runDir) ??
      asIsoOrNull(ghaMeta?.downloaded_at_utc) ??
      null;
    const runUrl =
      metadata?.run_url ??
      ghaMeta?.run_url ??
      (ghaMeta?.repository && ghaMeta?.run_id
        ? `https://github.com/${ghaMeta.repository}/actions/runs/${ghaMeta.run_id}`
        : null);
    const runApiUrl =
      metadata?.run_api_url ??
      ghaMeta?.run_api_url ??
      (ghaMeta?.repository && ghaMeta?.run_id
        ? `https://api.github.com/repos/${ghaMeta.repository}/actions/runs/${ghaMeta.run_id}`
        : null);

    runs.push({
      run_dir: runDir,
      run_id: runId,
      source:
        ghaMeta || String(runId).startsWith("gha-") ? "gha" : "local",
      workflow_name: ghaMeta?.workflow_name ?? null,
      executed_at_utc: executedAt,
      status: metadata?.status ?? "imported",
      exit_code: metadata?.exit_code ?? null,
      failed_step: metadata?.failed_step ?? "",
      optional_step_count: optionalStepCount,
      optional_fail_count: optionalFailCount,
      optional_failures: optionalFailures,
      optional_results: optionalResults,
      pbt_compat_mode: metadata?.pbt_compat_mode ?? null,
      pbt_compat_triggered: toInt(metadata?.pbt_compat_triggered, 0),
      pbt_compat_recovered: toInt(metadata?.pbt_compat_recovered, 0),
      run_url: runUrl,
      run_api_url: runApiUrl,
      artifact: ghaMeta
        ? {
            artifact_name: ghaMeta.artifact_name ?? null,
            artifact_id: ghaMeta.artifact_id ?? null,
            artifact_size_bytes: ghaMeta.artifact_size_bytes ?? null,
            artifact_digest: ghaMeta.artifact_digest ?? null,
          }
        : null,
      path: path.relative(process.cwd(), absDir),
    });
  }

  runs.sort(byRecentDesc);
  return runs;
}

function buildSummary(runs) {
  const summary = {
    total_runs: runs.length,
    by_status: { success: 0, failed: 0, aborted: 0, unknown: 0 },
    by_source: { gha: 0, local: 0 },
    optional_failure_runs: 0,
    pbt_compat_triggered_runs: 0,
    pbt_compat_recovered_runs: 0,
    latest_by_workflow: {},
  };

  for (const run of runs) {
    summary.by_status[statusBucket(run.status)] += 1;
    if (run.source === "gha") {
      summary.by_source.gha += 1;
    } else {
      summary.by_source.local += 1;
    }
    if (run.optional_fail_count > 0) {
      summary.optional_failure_runs += 1;
    }
    if (run.pbt_compat_triggered > 0) {
      summary.pbt_compat_triggered_runs += 1;
    }
    if (run.pbt_compat_recovered > 0) {
      summary.pbt_compat_recovered_runs += 1;
    }
    if (run.workflow_name && !summary.latest_by_workflow[run.workflow_name]) {
      summary.latest_by_workflow[run.workflow_name] = {
        run_id: run.run_id,
        status: run.status,
        executed_at_utc: run.executed_at_utc,
        path: run.path,
        run_url: run.run_url ?? null,
      };
    }
  }

  return summary;
}

function buildMarkdown(summary, runs, generatedAtUtc) {
  const lines = [];
  lines.push("# Run Index");
  lines.push("");
  lines.push(`- generated_at_utc: ${generatedAtUtc}`);
  lines.push(`- total_runs: ${summary.total_runs}`);
  lines.push(`- by_status: success=${summary.by_status.success}, failed=${summary.by_status.failed}, aborted=${summary.by_status.aborted}, unknown=${summary.by_status.unknown}`);
  lines.push(`- by_source: gha=${summary.by_source.gha}, local=${summary.by_source.local}`);
  lines.push(`- optional_failure_runs: ${summary.optional_failure_runs}`);
  lines.push(`- pbt_compat_triggered_runs: ${summary.pbt_compat_triggered_runs}`);
  lines.push(`- pbt_compat_recovered_runs: ${summary.pbt_compat_recovered_runs}`);
  lines.push("");
  lines.push("## Latest By Workflow");
  lines.push("");
  lines.push("| workflow | run_id | status | executed_at_utc | path | run_url |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const [workflow, v] of Object.entries(summary.latest_by_workflow)) {
    lines.push(
      `| ${mdEscape(workflow)} | ${mdEscape(valueOrDash(v.run_id))} | ${mdEscape(valueOrDash(v.status))} | ${mdEscape(valueOrDash(v.executed_at_utc))} | ${mdEscape(valueOrDash(v.path))} | ${mdEscape(valueOrDash(v.run_url))} |`
    );
  }
  if (Object.keys(summary.latest_by_workflow).length === 0) {
    lines.push("| - | - | - | - | - | - |");
  }
  lines.push("");
  lines.push("## Runs");
  lines.push("");
  lines.push("| run_id | source | workflow | status | exit_code | optional_fail_count | pbt_compat | executed_at_utc | path | run_url |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const run of runs) {
    const pbtCompat = `${run.pbt_compat_triggered}/${run.pbt_compat_recovered}`;
    lines.push(
      `| ${mdEscape(valueOrDash(run.run_id))} | ${mdEscape(valueOrDash(run.source))} | ${mdEscape(valueOrDash(run.workflow_name))} | ${mdEscape(valueOrDash(run.status))} | ${mdEscape(valueOrDash(run.exit_code))} | ${mdEscape(valueOrDash(run.optional_fail_count))} | ${mdEscape(pbtCompat)} | ${mdEscape(valueOrDash(run.executed_at_utc))} | ${mdEscape(valueOrDash(run.path))} | ${mdEscape(valueOrDash(run.run_url))} |`
    );
  }
  if (runs.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | - | - |");
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  await fs.mkdir(RUNS_ROOT, { recursive: true });
  const runs = await collectRunEntries();
  const summary = buildSummary(runs);
  const root = path.relative(process.cwd(), RUNS_ROOT);
  const payload = { root, summary, runs };
  const previous = await readJsonIfExists(INDEX_JSON);
  let generatedAtUtc = new Date().toISOString();

  if (previous && typeof previous === "object") {
    const previousPayload = {
      root: previous.root ?? root,
      summary: previous.summary ?? null,
      runs: Array.isArray(previous.runs) ? previous.runs : [],
    };
    const isSamePayload =
      JSON.stringify(previousPayload) === JSON.stringify(payload);
    if (isSamePayload && typeof previous.generated_at_utc === "string" && previous.generated_at_utc.length > 0) {
      generatedAtUtc = previous.generated_at_utc;
    }
  }

  const doc = {
    generated_at_utc: generatedAtUtc,
    ...payload,
  };

  await fs.writeFile(INDEX_JSON, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await fs.writeFile(INDEX_MD, `${buildMarkdown(summary, runs, generatedAtUtc)}\n`, "utf8");

  process.stdout.write(
    `generated: ${path.relative(process.cwd(), INDEX_JSON)}\n` +
      `generated: ${path.relative(process.cwd(), INDEX_MD)}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[generate-run-index] failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
