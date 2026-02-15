#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/import-gha-artifact.sh <run_id> [--artifact <name>] [--dest <dir>] [--repo <owner/repo>]

Examples:
  scripts/import-gha-artifact.sh 22036655477
  scripts/import-gha-artifact.sh 22036655477 --artifact ae-eval-full-artifacts
  scripts/import-gha-artifact.sh 22036655477 --dest artifacts/runs/gha-22036655477-1
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

if [[ -d "${DEST_DIR}" ]] && find "${DEST_DIR}" -mindepth 1 -print -quit | grep -q .; then
  echo "出力先ディレクトリが空ではありません: ${DEST_DIR}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
gh run download "${RUN_ID}" -R "${REPO_SLUG}" -n "${ARTIFACT_NAME}" -D "${DEST_DIR}"

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

echo "downloaded: ${DEST_DIR}"
