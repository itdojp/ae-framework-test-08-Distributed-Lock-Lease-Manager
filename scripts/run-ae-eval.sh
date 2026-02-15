#!/usr/bin/env bash
set -euo pipefail

AE_FRAMEWORK_ROOT="${AE_FRAMEWORK_ROOT:-/tmp/ae-framework}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="${PWD}/artifacts/runs/${RUN_ID}"
LOG_DIR="${RUN_DIR}/logs"
RUN_START_MARKER="${RUN_DIR}/.run-start.marker"
AE_RUN_OPTIONAL="${AE_RUN_OPTIONAL:-1}"
AE_PBT_COMPAT_MODE="${AE_PBT_COMPAT_MODE:-1}"
CURRENT_STEP=""
REQUIRED_COMPLETED=0
SCRIPT_RC=0
OPTIONAL_FAILURES=()
OPTIONAL_RESULTS=()
LAST_OPTIONAL_RC=0
PBT_COMPAT_TRIGGERED=0
PBT_COMPAT_RECOVERED=0

mkdir -p "${LOG_DIR}"
: > "${RUN_START_MARKER}"

run_required() {
  local step_name="$1"
  shift
  CURRENT_STEP="${step_name}"
  echo "[required] ${step_name}"
  set +e
  (
    cd "${AE_FRAMEWORK_ROOT}"
    "$@"
  ) 2>&1 | tee "${LOG_DIR}/${step_name}.log"
  local rc=${PIPESTATUS[0]}
  set -e
  if [ "${rc}" -ne 0 ]; then
    SCRIPT_RC="${rc}"
    echo "[required] ${step_name} failed (exit=${rc})" | tee -a "${RUN_DIR}/summary.md"
    return "${rc}"
  fi
  CURRENT_STEP=""
}

run_optional() {
  local step_name="$1"
  shift

  echo "[optional] ${step_name}"
  set +e
  (
    cd "${AE_FRAMEWORK_ROOT}"
    "$@"
  ) 2>&1 | tee "${LOG_DIR}/${step_name}.log"
  local rc=${PIPESTATUS[0]}
  set -e

  LAST_OPTIONAL_RC="${rc}"
  OPTIONAL_RESULTS+=("${step_name}:${rc}")

  if [ "${rc}" -ne 0 ]; then
    OPTIONAL_FAILURES+=("${step_name}:${rc}")
    echo "[optional] ${step_name} failed (exit=${rc})" | tee -a "${RUN_DIR}/summary.md"
  fi
}

run_optional_pbt_compat() {
  if [ "${AE_PBT_COMPAT_MODE}" != "1" ]; then
    return
  fi

  if [ ! -f "${LOG_DIR}/pbt.log" ]; then
    return
  fi

  if ! grep -q "tests/property/vitest.config.ts" "${LOG_DIR}/pbt.log"; then
    return
  fi

  PBT_COMPAT_TRIGGERED=1
  echo "[optional] pbt compatibility fallback triggered: pnpm run test:property" | tee -a "${RUN_DIR}/summary.md"
  run_optional "pbt_compat_test_property" pnpm run test:property
  if [ "${LAST_OPTIONAL_RC}" -eq 0 ]; then
    PBT_COMPAT_RECOVERED=1
  fi
}

copy_changed_tree() {
  local src="$1"
  local dst="$2"
  local label="$3"
  local list_file="${RUN_DIR}/.${label}-changed-files.txt"

  if [ ! -d "${src}" ]; then
    echo 0
    return
  fi

  (
    cd "${src}"
    find . -type f -newer "${RUN_START_MARKER}" -print
  ) > "${list_file}"

  if [ ! -s "${list_file}" ]; then
    echo 0
    return
  fi

  mkdir -p "${dst}"
  (
    cd "${src}"
    tar -cf - -T "${list_file}"
  ) | (
    cd "${dst}"
    tar -xf -
  )

  wc -l < "${list_file}" | tr -d " "
}

finalize_run() {
  local rc="$1"
  local final_rc="${rc}"
  if [ "${SCRIPT_RC}" -ne 0 ]; then
    final_rc="${SCRIPT_RC}"
  fi

  set +e

  mkdir -p "${RUN_DIR}/ae-framework-artifacts" "${RUN_DIR}/ae-framework-reports"
  artifacts_copied="$(copy_changed_tree "${AE_FRAMEWORK_ROOT}/artifacts" "${RUN_DIR}/ae-framework-artifacts" "artifacts")"
  reports_copied="$(copy_changed_tree "${AE_FRAMEWORK_ROOT}/reports" "${RUN_DIR}/ae-framework-reports" "reports")"

  local ae_commit
  local ae_branch
  local target_branch
  local target_commit
  local codex_version
  local run_status
  local failed_step
  local optional_fail_count
  local optional_failures_json
  local optional_step_count
  local optional_results_json

  ae_commit="$(git -C "${AE_FRAMEWORK_ROOT}" rev-parse HEAD 2>/dev/null || echo unknown)"
  ae_branch="$(git -C "${AE_FRAMEWORK_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  target_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  target_commit="$(git rev-parse HEAD 2>/dev/null || echo uncommitted)"
  codex_version="$(codex --version 2>/dev/null || echo unknown)"
  run_status="success"
  failed_step=""
  optional_fail_count="${#OPTIONAL_FAILURES[@]}"
  optional_step_count="${#OPTIONAL_RESULTS[@]}"
  optional_failures_json="[]"
  optional_results_json="[]"

  if [ "${optional_fail_count}" -gt 0 ]; then
    optional_failures_json="["
    local first=1
    local entry
    for entry in "${OPTIONAL_FAILURES[@]}"; do
      local opt_step="${entry%%:*}"
      local opt_exit="${entry##*:}"
      if [ "${first}" -eq 0 ]; then
        optional_failures_json+=", "
      fi
      optional_failures_json+="{\"step\":\"${opt_step}\",\"exit_code\":${opt_exit}}"
      first=0
    done
    optional_failures_json+="]"
  fi

  if [ "${optional_step_count}" -gt 0 ]; then
    optional_results_json="["
    local first_result=1
    local result_entry
    for result_entry in "${OPTIONAL_RESULTS[@]}"; do
      local result_step="${result_entry%%:*}"
      local result_exit="${result_entry##*:}"
      local result_status="success"
      if [ "${result_exit}" -ne 0 ]; then
        result_status="failed"
      fi
      if [ "${first_result}" -eq 0 ]; then
        optional_results_json+=", "
      fi
      optional_results_json+="{\"step\":\"${result_step}\",\"status\":\"${result_status}\",\"exit_code\":${result_exit}}"
      first_result=0
    done
    optional_results_json+="]"
  fi

  if [ "${final_rc}" -ne 0 ]; then
    run_status="failed"
    failed_step="${CURRENT_STEP:-unknown}"
    echo "[run] failed at required step: ${failed_step} (exit=${final_rc})" | tee -a "${RUN_DIR}/summary.md"
  fi

  cat <<META > "${RUN_DIR}/metadata.json"
{
  "run_id": "${RUN_ID}",
  "executed_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "${run_status}",
  "exit_code": ${final_rc},
  "failed_step": "${failed_step}",
  "optional_step_count": ${optional_step_count},
  "optional_fail_count": ${optional_fail_count},
  "optional_failures": ${optional_failures_json},
  "optional_results": ${optional_results_json},
  "pbt_compat_mode": "${AE_PBT_COMPAT_MODE}",
  "pbt_compat_triggered": ${PBT_COMPAT_TRIGGERED},
  "pbt_compat_recovered": ${PBT_COMPAT_RECOVERED},
  "repository": "itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager",
  "spec_issue": 1,
  "runtime_issue": 2,
  "tool_versions": {
    "codex": "${codex_version}",
    "pnpm": "$(pnpm --version 2>/dev/null || echo unknown)",
    "node": "$(node --version 2>/dev/null || echo unknown)"
  },
  "ae_framework": {
    "root": "${AE_FRAMEWORK_ROOT}",
    "branch": "${ae_branch}",
    "commit": "${ae_commit}"
  },
  "target_repo": {
    "branch": "${target_branch}",
    "commit_before_run": "${target_commit}"
  }
}
META

  echo "" >> "${RUN_DIR}/summary.md"
  echo "## status" >> "${RUN_DIR}/summary.md"
  if [ "${REQUIRED_COMPLETED}" -eq 1 ]; then
    echo "- required steps completed" >> "${RUN_DIR}/summary.md"
  else
    echo "- required steps failed at: ${CURRENT_STEP:-unknown}" >> "${RUN_DIR}/summary.md"
  fi
  echo "- optional steps enabled: ${AE_RUN_OPTIONAL}" >> "${RUN_DIR}/summary.md"
  echo "- optional executed steps: ${optional_step_count}" >> "${RUN_DIR}/summary.md"
  echo "- optional failed steps: ${optional_fail_count}" >> "${RUN_DIR}/summary.md"
  echo "- pbt compat mode: ${AE_PBT_COMPAT_MODE}" >> "${RUN_DIR}/summary.md"
  echo "- pbt compat triggered: ${PBT_COMPAT_TRIGGERED}" >> "${RUN_DIR}/summary.md"
  echo "- pbt compat recovered: ${PBT_COMPAT_RECOVERED}" >> "${RUN_DIR}/summary.md"
  if [ "${optional_fail_count}" -gt 0 ]; then
    local item
    for item in "${OPTIONAL_FAILURES[@]}"; do
      local opt_name="${item%%:*}"
      local opt_code="${item##*:}"
      echo "  - ${opt_name} (exit=${opt_code})" >> "${RUN_DIR}/summary.md"
    done
  fi
  echo "- optional step logs: ${RUN_DIR}/logs" >> "${RUN_DIR}/summary.md"
  echo "- copied artifacts: ${RUN_DIR}/ae-framework-artifacts" >> "${RUN_DIR}/summary.md"
  echo "- copied reports: ${RUN_DIR}/ae-framework-reports" >> "${RUN_DIR}/summary.md"
  echo "- copied artifacts files: ${artifacts_copied}" >> "${RUN_DIR}/summary.md"
  echo "- copied reports files: ${reports_copied}" >> "${RUN_DIR}/summary.md"

  rm -f "${RUN_START_MARKER}"

  if [ "${final_rc}" -eq 0 ]; then
    echo "run complete: ${RUN_DIR}"
  else
    echo "run failed: ${RUN_DIR} (exit=${final_rc})" >&2
  fi
  exit "${final_rc}"
}

trap 'finalize_run "$?"' EXIT

: > "${RUN_DIR}/summary.md"
echo "# ae-framework evaluation summary" >> "${RUN_DIR}/summary.md"
echo "" >> "${RUN_DIR}/summary.md"
echo "- run_id: ${RUN_ID}" >> "${RUN_DIR}/summary.md"
echo "- ae_framework_root: ${AE_FRAMEWORK_ROOT}" >> "${RUN_DIR}/summary.md"

if [ ! -d "${AE_FRAMEWORK_ROOT}" ]; then
  echo "AE_FRAMEWORK_ROOT が存在しません: ${AE_FRAMEWORK_ROOT}" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm が見つかりません。Node.js 20.11+ と pnpm 10.x を準備してください。" >&2
  exit 1
fi

run_required "build" pnpm run build
codex_env=(CODEX_RUN_FORMAL=1 CODEX_SKIP_QUALITY=0 CODEX_TOLERANT=0)
run_required "codex_quickstart" env "${codex_env[@]}" pnpm run codex:quickstart
run_required "verify_lite" pnpm run verify:lite
REQUIRED_COMPLETED=1

if [ "${AE_RUN_OPTIONAL}" = "1" ]; then
  run_optional "mbt" pnpm run mbt
  run_optional "pbt" pnpm run pbt
  run_optional_pbt_compat
  run_optional "mutation_quick" env STRYKER_TIME_LIMIT=0 pnpm run pipelines:mutation:quick
  run_optional "verify_csp" pnpm run verify:csp -- --file spec/csp/cspx-smoke.cspm --mode typecheck
  run_optional "verify_tla" pnpm run verify:tla -- --engine=tlc --file spec/tla/DomainSpec.tla
else
  echo "[optional] skipped by AE_RUN_OPTIONAL=${AE_RUN_OPTIONAL}" | tee -a "${RUN_DIR}/summary.md"
fi
