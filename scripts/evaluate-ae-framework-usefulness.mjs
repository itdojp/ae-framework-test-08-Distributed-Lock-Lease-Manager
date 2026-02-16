#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const RUN_INDEX_PATH = path.resolve("artifacts/runs/index.json");
const TRACEABILITY_PATH = path.resolve("artifacts/traceability/latest.json");
const OUTPUT_DIR = path.resolve("artifacts/evaluation");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "ae-framework-usefulness-latest.json");
const OUTPUT_MD = path.join(OUTPUT_DIR, "ae-framework-usefulness-latest.md");

const WORKFLOW_CHECKS = [
  {
    id: "ci_basic_push",
    description: "CI Basic が push(main) で自動実行される",
    file: ".github/workflows/ci-basic.yml",
    patterns: [/^\s*push:\s*$/m, /^\s*branches:\s*\[main\]/m]
  },
  {
    id: "ae_eval_fast_push",
    description: "AE Eval Fast が push(main) で自動実行される",
    file: ".github/workflows/ae-eval-fast.yml",
    patterns: [/^\s*push:\s*$/m, /^\s*branches:\s*\[main\]/m]
  },
  {
    id: "ae_eval_full_schedule",
    description: "AE Eval Full が schedule で定期実行される",
    file: ".github/workflows/ae-eval-full.yml",
    patterns: [/^\s*schedule:\s*$/m, /^\s*-\s*cron:\s*"/m]
  },
  {
    id: "artifacts_maintenance_schedule",
    description: "Artifacts Maintenance が schedule で定期同期される",
    file: ".github/workflows/artifacts-maintenance.yml",
    patterns: [/^\s*schedule:\s*$/m, /^\s*-\s*cron:\s*"/m]
  },
  {
    id: "sync_on_workflow_run",
    description: "完了イベント連動で artifacts 同期される",
    file: ".github/workflows/artifacts-sync-on-workflow-complete.yml",
    patterns: [/^\s*workflow_run:\s*$/m]
  }
];

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function percent(passed, total) {
  if (!total) {
    return 0;
  }
  return Math.round((passed / total) * 100);
}

function findLatestRun(runs, workflowName) {
  return runs.find((run) => run.workflow_name === workflowName) ?? null;
}

function summarizeRun(run) {
  if (!run) {
    return null;
  }
  return {
    run_id: run.run_id ?? null,
    status: run.status ?? null,
    executed_at_utc: run.executed_at_utc ?? null,
    optional_fail_count: asNumber(run.optional_fail_count, 0),
    pbt_compat_triggered: asNumber(run.pbt_compat_triggered, 0),
    run_url: run.run_url ?? null,
    path: run.path ?? null
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# ae-framework 有用性検証レポート");
  lines.push("");
  lines.push(`- generated_at_utc: ${report.generated_at_utc}`);
  lines.push(`- overall_score: ${report.overall_score}`);
  lines.push(`- conclusion: ${report.conclusion}`);
  lines.push("");
  lines.push("## 指標");
  lines.push("");
  lines.push("| metric | score | passed/total |");
  lines.push("| --- | --- | --- |");
  for (const metric of report.metrics) {
    lines.push(`| ${metric.id} | ${metric.score} | ${metric.passed}/${metric.total} |`);
  }
  lines.push("");
  lines.push("## 主要エビデンス");
  lines.push("");
  lines.push(`- traceability_coverage_percent: ${report.evidence.traceability_coverage_percent}`);
  lines.push(`- latest_ci_basic: ${report.evidence.latest_runs.ci_basic?.run_id ?? "-"} (${report.evidence.latest_runs.ci_basic?.status ?? "-"})`);
  lines.push(`- latest_ae_eval_fast: ${report.evidence.latest_runs.ae_eval_fast?.run_id ?? "-"} (${report.evidence.latest_runs.ae_eval_fast?.status ?? "-"})`);
  lines.push(`- latest_ae_eval_full: ${report.evidence.latest_runs.ae_eval_full?.run_id ?? "-"} (${report.evidence.latest_runs.ae_eval_full?.status ?? "-"})`);
  lines.push(`- ae_eval_full_optional_failure_runs: ${report.evidence.ae_eval_full_optional_failure_runs}`);
  lines.push(`- latest_full_optional_fail_count: ${report.evidence.latest_full_optional_fail_count}`);
  lines.push(`- latest_full_pbt_compat_triggered: ${report.evidence.latest_full_pbt_compat_triggered}`);
  lines.push("");
  lines.push("## 判定内訳");
  lines.push("");
  for (const metric of report.metrics) {
    lines.push(`### ${metric.id}`);
    lines.push("");
    for (const check of metric.checks) {
      lines.push(`- [${check.pass ? "x" : " "}] ${check.description}`);
      if (check.evidence) {
        lines.push(`  - evidence: ${check.evidence}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function fileMatchesAllPatterns(filePath, patterns) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return patterns.every((pattern) => pattern.test(text));
  } catch {
    return false;
  }
}

async function main() {
  const runIndex = await readJson(RUN_INDEX_PATH);
  const traceability = await readJson(TRACEABILITY_PATH);

  const runs = Array.isArray(runIndex?.runs) ? runIndex.runs : [];
  const traceabilityCoverage = asNumber(traceability?.summary?.coveragePercent, 0);
  const latestCiBasic = findLatestRun(runs, "CI Basic");
  const latestAeEvalFast = findLatestRun(runs, "AE Eval Fast");
  const latestAeEvalFull = findLatestRun(runs, "AE Eval Full");
  const aeEvalFullRuns = runs.filter((run) => run.workflow_name === "AE Eval Full");
  const aeEvalFullOptionalFailureRuns = aeEvalFullRuns.filter(
    (run) => asNumber(run.optional_fail_count, 0) > 0
  ).length;
  const latestFullOptionalFailCount = asNumber(latestAeEvalFull?.optional_fail_count, -1);
  const latestFullPbtCompatTriggered = asNumber(latestAeEvalFull?.pbt_compat_triggered, -1);

  const reproducibilityChecks = [
    {
      id: "latest_ci_basic_success",
      description: "最新 CI Basic が success",
      pass: latestCiBasic?.status === "success",
      evidence: latestCiBasic?.run_id ?? null
    },
    {
      id: "latest_ae_eval_fast_success",
      description: "最新 AE Eval Fast が success",
      pass: latestAeEvalFast?.status === "success",
      evidence: latestAeEvalFast?.run_id ?? null
    },
    {
      id: "latest_ae_eval_full_success",
      description: "最新 AE Eval Full が success",
      pass: latestAeEvalFull?.status === "success",
      evidence: latestAeEvalFull?.run_id ?? null
    }
  ];

  const automationChecks = [];
  for (const workflowCheck of WORKFLOW_CHECKS) {
    const pass = await fileMatchesAllPatterns(workflowCheck.file, workflowCheck.patterns);
    automationChecks.push({
      id: workflowCheck.id,
      description: workflowCheck.description,
      pass,
      evidence: workflowCheck.file
    });
  }

  const qualityDetectionChecks = [
    {
      id: "historical_optional_failure_observed",
      description: "AE Eval Full で optional 失敗の履歴を観測できる",
      pass: aeEvalFullOptionalFailureRuns > 0,
      evidence: String(aeEvalFullOptionalFailureRuns)
    },
    {
      id: "latest_full_optional_failures_zero",
      description: "最新 AE Eval Full の optional_fail_count が 0",
      pass: latestFullOptionalFailCount === 0,
      evidence: String(latestFullOptionalFailCount)
    },
    {
      id: "latest_full_pbt_compat_not_triggered",
      description: "最新 AE Eval Full で pbt 互換フォールバックが不要",
      pass: latestFullPbtCompatTriggered === 0,
      evidence: String(latestFullPbtCompatTriggered)
    }
  ];

  const traceabilityChecks = [
    {
      id: "traceability_coverage_100",
      description: "トレーサビリティ被覆率が 100%",
      pass: traceabilityCoverage === 100,
      evidence: String(traceabilityCoverage)
    }
  ];

  const metrics = [
    {
      id: "reproducibility",
      checks: reproducibilityChecks
    },
    {
      id: "traceability",
      checks: traceabilityChecks
    },
    {
      id: "automation",
      checks: automationChecks
    },
    {
      id: "quality_detection",
      checks: qualityDetectionChecks
    }
  ].map((metric) => {
    const passed = metric.checks.filter((check) => check.pass).length;
    const total = metric.checks.length;
    return {
      ...metric,
      passed,
      total,
      score: percent(passed, total)
    };
  });

  const overallScore = Math.round(
    metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length
  );
  const conclusion = overallScore >= 80 ? "usable" : "needs_improvement";

  const report = {
    generated_at_utc: new Date().toISOString(),
    inputs: {
      run_index: path.relative(process.cwd(), RUN_INDEX_PATH),
      traceability: path.relative(process.cwd(), TRACEABILITY_PATH)
    },
    overall_score: overallScore,
    conclusion,
    metrics,
    evidence: {
      traceability_coverage_percent: traceabilityCoverage,
      latest_runs: {
        ci_basic: summarizeRun(latestCiBasic),
        ae_eval_fast: summarizeRun(latestAeEvalFast),
        ae_eval_full: summarizeRun(latestAeEvalFull)
      },
      ae_eval_full_runs: aeEvalFullRuns.length,
      ae_eval_full_optional_failure_runs: aeEvalFullOptionalFailureRuns,
      latest_full_optional_fail_count: latestFullOptionalFailCount,
      latest_full_pbt_compat_triggered: latestFullPbtCompatTriggered
    }
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUTPUT_MD, buildMarkdown(report), "utf8");

  process.stdout.write(
    `generated: ${path.relative(process.cwd(), OUTPUT_JSON)}\n` +
      `generated: ${path.relative(process.cwd(), OUTPUT_MD)}\n` +
      `overall_score: ${overallScore}\n` +
      `conclusion: ${conclusion}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`[evaluate-ae-framework-usefulness] failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
