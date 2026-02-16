#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/import-gha-artifact.sh <run_id> [--artifact <name>] [--dest <dir>] [--repo <owner/repo>] [--refresh-meta]

Examples:
  scripts/import-gha-artifact.sh 22036655477
  scripts/import-gha-artifact.sh 22036655477 --artifact ae-eval-full-artifacts
  scripts/import-gha-artifact.sh 22036655477 --dest artifacts/runs/gha-22036655477-1
  scripts/import-gha-artifact.sh 22036655477 --artifact ci-basic-logs --dest artifacts/runs/gha-22036655477-1 --refresh-meta
USAGE
}

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI が見つかりません。GitHub CLI をインストールしてください。" >&2
  exit 1
fi

RUN_ID="${1:-}"
if [[ -z "${RUN_ID}" ]]; then
  usage
  exit 1
fi
shift

REPO_SLUG="${GITHUB_REPOSITORY:-itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager}"
ARTIFACT_NAME=""
DEST_DIR=""
REFRESH_META=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      ARTIFACT_NAME="${2:-}"
      shift 2
      ;;
    --dest)
      DEST_DIR="${2:-}"
      shift 2
      ;;
    --repo)
      REPO_SLUG="${2:-}"
      shift 2
      ;;
    --refresh-meta)
      REFRESH_META=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "不明な引数: $1" >&2
      usage
      exit 1
      ;;
  esac
done

RUN_ATTEMPT="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.run_attempt')"
WORKFLOW_NAME="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.name')"
HEAD_SHA="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.head_sha')"
RUN_STATUS_RAW="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.status')"
RUN_CONCLUSION_RAW="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.conclusion // ""')"
RUN_EVENT="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.event // ""')"
RUN_CREATED_AT="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.created_at // ""')"
RUN_UPDATED_AT="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}" --jq '.updated_at // ""')"

ARTIFACT_ROWS="$(gh api "repos/${REPO_SLUG}/actions/runs/${RUN_ID}/artifacts" --jq '.artifacts[] | [.name, .id, .size_in_bytes, .digest] | @tsv')"
ARTIFACT_TOTAL="$(printf '%s\n' "${ARTIFACT_ROWS}" | sed '/^$/d' | wc -l | tr -d ' ')"

if [[ "${ARTIFACT_TOTAL}" == "0" ]]; then
  echo "run_id=${RUN_ID} にartifactがありません。" >&2
  exit 1
fi

if [[ -z "${ARTIFACT_NAME}" ]]; then
  if [[ "${ARTIFACT_TOTAL}" != "1" ]]; then
    echo "artifact名を指定してください。候補:" >&2
    printf '%s\n' "${ARTIFACT_ROWS}" | awk -F '\t' '{print "- " $1}' >&2
    exit 1
  fi
  ARTIFACT_NAME="$(printf '%s\n' "${ARTIFACT_ROWS}" | awk -F '\t' 'NR==1{print $1}')"
fi

ARTIFACT_ID=""
ARTIFACT_SIZE=""
ARTIFACT_DIGEST=""
while IFS=$'\t' read -r name id size digest; do
  if [[ "${name}" == "${ARTIFACT_NAME}" ]]; then
    ARTIFACT_ID="${id}"
    ARTIFACT_SIZE="${size}"
    ARTIFACT_DIGEST="${digest}"
    break
  fi
done <<< "${ARTIFACT_ROWS}"

if [[ -z "${ARTIFACT_ID}" ]]; then
  echo "artifact '${ARTIFACT_NAME}' が run_id=${RUN_ID} に存在しません。" >&2
  printf '%s\n' "${ARTIFACT_ROWS}" | awk -F '\t' '{print "- " $1}' >&2
  exit 1
fi

if [[ -z "${DEST_DIR}" ]]; then
  DEST_DIR="artifacts/runs/gha-${RUN_ID}-${RUN_ATTEMPT}"
fi

DEST_HAS_FILES=0
if [[ -d "${DEST_DIR}" ]] && find "${DEST_DIR}" -mindepth 1 -print -quit | grep -q .; then
  DEST_HAS_FILES=1
fi

if [[ "${DEST_HAS_FILES}" == "1" ]] && [[ "${REFRESH_META}" != "1" ]]; then
  echo "出力先ディレクトリが空ではありません: ${DEST_DIR}" >&2
  echo "--refresh-meta を指定すると既存ディレクトリでメタデータ再生成のみ実行できます。" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
if [[ "${DEST_HAS_FILES}" == "0" ]]; then
  gh run download "${RUN_ID}" -R "${REPO_SLUG}" -n "${ARTIFACT_NAME}" -D "${DEST_DIR}"
fi

if [[ "${DEST_HAS_FILES}" == "0" || ! -f "${DEST_DIR}/gha-artifact-download.json" ]]; then
  cat <<META > "${DEST_DIR}/gha-artifact-download.json"
{
  "repository": "${REPO_SLUG}",
  "run_id": ${RUN_ID},
  "run_attempt": ${RUN_ATTEMPT},
  "workflow_name": "${WORKFLOW_NAME}",
  "head_sha": "${HEAD_SHA}",
  "artifact_name": "${ARTIFACT_NAME}",
  "artifact_id": ${ARTIFACT_ID},
  "artifact_size_bytes": ${ARTIFACT_SIZE},
  "artifact_digest": "${ARTIFACT_DIGEST}",
  "downloaded_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
META
fi

to_eval_status() {
  local conclusion="$1"
  case "${conclusion}" in
    success)
      echo "success"
      ;;
    failure|timed_out|action_required|startup_failure)
      echo "failed"
      ;;
    cancelled|skipped)
      echo "aborted"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

to_exit_code() {
  local status="$1"
  case "${status}" in
    success)
      echo 0
      ;;
    failed)
      echo 1
      ;;
    aborted)
      echo 130
      ;;
    *)
      echo 1
      ;;
  esac
}

if [[ ! -f "${DEST_DIR}/metadata.json" ]]; then
  SYNTH_STATUS="$(to_eval_status "${RUN_CONCLUSION_RAW}")"
  SYNTH_EXIT_CODE="$(to_exit_code "${SYNTH_STATUS}")"
  EXECUTED_AT="${RUN_UPDATED_AT:-}"
  if [[ -z "${EXECUTED_AT}" ]]; then
    EXECUTED_AT="${RUN_CREATED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  fi

  cat <<SYNTHMETA > "${DEST_DIR}/metadata.json"
{
  "run_id": "gha-${RUN_ID}-${RUN_ATTEMPT}",
  "executed_at_utc": "${EXECUTED_AT}",
  "status": "${SYNTH_STATUS}",
  "exit_code": ${SYNTH_EXIT_CODE},
  "failed_step": "",
  "optional_step_count": 0,
  "optional_fail_count": 0,
  "optional_failures": [],
  "optional_results": [],
  "pbt_compat_mode": "n/a",
  "pbt_compat_triggered": 0,
  "pbt_compat_recovered": 0,
  "repository": "${REPO_SLUG}",
  "source": "gha-import-generated",
  "workflow_name": "${WORKFLOW_NAME}",
  "run_event": "${RUN_EVENT}",
  "run_status_raw": "${RUN_STATUS_RAW}",
  "run_conclusion_raw": "${RUN_CONCLUSION_RAW}",
  "head_sha": "${HEAD_SHA}",
  "artifact_name": "${ARTIFACT_NAME}",
  "artifact_id": ${ARTIFACT_ID},
  "artifact_size_bytes": ${ARTIFACT_SIZE},
  "artifact_digest": "${ARTIFACT_DIGEST}"
}
SYNTHMETA
fi

if [[ ! -f "${DEST_DIR}/summary.md" ]]; then
  cat <<SYNTHSUMMARY > "${DEST_DIR}/summary.md"
# imported github actions artifact summary

- run_id: gha-${RUN_ID}-${RUN_ATTEMPT}
- repository: ${REPO_SLUG}
- workflow: ${WORKFLOW_NAME}
- event: ${RUN_EVENT}
- head_sha: ${HEAD_SHA}
- artifact_name: ${ARTIFACT_NAME}
- artifact_id: ${ARTIFACT_ID}
- artifact_size_bytes: ${ARTIFACT_SIZE}
- artifact_digest: ${ARTIFACT_DIGEST}
- generated_by: scripts/import-gha-artifact.sh
SYNTHSUMMARY
fi

echo "downloaded: ${DEST_DIR}"
