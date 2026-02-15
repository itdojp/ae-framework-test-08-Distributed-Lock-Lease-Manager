#!/usr/bin/env bash
set -euo pipefail

AE_FRAMEWORK_ROOT="${AE_FRAMEWORK_ROOT:-/tmp/ae-framework}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="${PWD}/artifacts/runs/${RUN_ID}"
LOG_DIR="${RUN_DIR}/logs"

mkdir -p "${LOG_DIR}"

if [ ! -d "${AE_FRAMEWORK_ROOT}" ]; then
  echo "AE_FRAMEWORK_ROOT が存在しません: ${AE_FRAMEWORK_ROOT}" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm が見つかりません。Node.js 20.11+ と pnpm 10.x を準備してください。" >&2
  exit 1
fi

run_required() {
  local step_name="$1"
  shift
  echo "[required] ${step_name}"
  (
    cd "${AE_FRAMEWORK_ROOT}"
    "$@"
  ) 2>&1 | tee "${LOG_DIR}/${step_name}.log"
}

run_optional() {
  local step_name="$1"
  shift

  set +e
  (
    cd "${AE_FRAMEWORK_ROOT}"
    "$@"
  ) 2>&1 | tee "${LOG_DIR}/${step_name}.log"
  local rc=${PIPESTATUS[0]}
  set -e

  if [ "${rc}" -ne 0 ]; then
    echo "[optional] ${step_name} failed (exit=${rc})" | tee -a "${RUN_DIR}/summary.md"
  fi
}

: > "${RUN_DIR}/summary.md"
echo "# ae-framework evaluation summary" >> "${RUN_DIR}/summary.md"
echo "" >> "${RUN_DIR}/summary.md"
echo "- run_id: ${RUN_ID}" >> "${RUN_DIR}/summary.md"
echo "- ae_framework_root: ${AE_FRAMEWORK_ROOT}" >> "${RUN_DIR}/summary.md"

run_required "build" pnpm run build
codex_env=(CODEX_RUN_FORMAL=1 CODEX_SKIP_QUALITY=0 CODEX_TOLERANT=0)
run_required "codex_quickstart" env "${codex_env[@]}" pnpm run codex:quickstart
run_required "verify_lite" pnpm run verify:lite

run_optional "mbt" pnpm run mbt
run_optional "pbt" pnpm run pbt
run_optional "mutation_quick" env STRYKER_TIME_LIMIT=0 pnpm run pipelines:mutation:quick
run_optional "verify_csp" pnpm run verify:csp -- --file spec/csp/cspx-smoke.cspm --mode typecheck
run_optional "verify_tla" pnpm run verify:tla -- --engine=tlc --file spec/tla/DomainSpec.tla

mkdir -p "${RUN_DIR}/ae-framework-artifacts" "${RUN_DIR}/ae-framework-reports"
if [ -d "${AE_FRAMEWORK_ROOT}/artifacts" ]; then
  cp -a "${AE_FRAMEWORK_ROOT}/artifacts/." "${RUN_DIR}/ae-framework-artifacts/"
fi
if [ -d "${AE_FRAMEWORK_ROOT}/reports" ]; then
  cp -a "${AE_FRAMEWORK_ROOT}/reports/." "${RUN_DIR}/ae-framework-reports/"
fi

AE_COMMIT="$(git -C "${AE_FRAMEWORK_ROOT}" rev-parse HEAD 2>/dev/null || echo unknown)"
AE_BRANCH="$(git -C "${AE_FRAMEWORK_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
TARGET_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
TARGET_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo uncommitted)"
CODEX_VERSION="$(codex --version 2>/dev/null || echo unknown)"

cat <<META > "${RUN_DIR}/metadata.json"
{
  "run_id": "${RUN_ID}",
  "executed_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repository": "itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager",
  "spec_issue": 1,
  "runtime_issue": 2,
  "tool_versions": {
    "codex": "${CODEX_VERSION}",
    "pnpm": "$(pnpm --version 2>/dev/null || echo unknown)",
    "node": "$(node --version 2>/dev/null || echo unknown)"
  },
  "ae_framework": {
    "root": "${AE_FRAMEWORK_ROOT}",
    "branch": "${AE_BRANCH}",
    "commit": "${AE_COMMIT}"
  },
  "target_repo": {
    "branch": "${TARGET_BRANCH}",
    "commit_before_run": "${TARGET_COMMIT}"
  }
}
META

echo "" >> "${RUN_DIR}/summary.md"
echo "## status" >> "${RUN_DIR}/summary.md"
echo "- required steps completed" >> "${RUN_DIR}/summary.md"
echo "- optional step logs: ${RUN_DIR}/logs" >> "${RUN_DIR}/summary.md"
echo "- copied artifacts: ${RUN_DIR}/ae-framework-artifacts" >> "${RUN_DIR}/summary.md"
echo "- copied reports: ${RUN_DIR}/ae-framework-reports" >> "${RUN_DIR}/summary.md"

echo "run complete: ${RUN_DIR}"
