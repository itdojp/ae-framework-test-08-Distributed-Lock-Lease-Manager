#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-gha-artifacts.sh [--repo <owner/repo>] [--branch <name>] [--limit <n>] [--workflow <name> ...]

Default workflows:
  - AE Eval Fast
  - AE Eval Full
  - CI Basic

Examples:
  scripts/sync-gha-artifacts.sh
  scripts/sync-gha-artifacts.sh --workflow "AE Eval Full"
  scripts/sync-gha-artifacts.sh --repo itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager --branch main

Notes:
  --limit は workflow ごとに探索する completed run 件数（新しい順）です。
  探索範囲内の success run について、未取り込み分をすべて同期します。
USAGE
}

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI が見つかりません。GitHub CLI をインストールしてください。" >&2
  exit 1
fi

REPO_SLUG="${GITHUB_REPOSITORY:-itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager}"
BRANCH="main"
LIMIT=100
WORKFLOWS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_SLUG="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --workflow)
      WORKFLOWS+=("${2:-}")
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

if [[ ${#WORKFLOWS[@]} -eq 0 ]]; then
  WORKFLOWS=("AE Eval Fast" "AE Eval Full" "CI Basic")
fi

workflow_to_artifact() {
  local workflow_name="$1"
  case "${workflow_name}" in
    "AE Eval Fast") echo "ae-eval-fast-artifacts" ;;
    "AE Eval Full") echo "ae-eval-full-artifacts" ;;
    "CI Basic") echo "ci-basic-logs" ;;
    *)
      echo ""
      ;;
  esac
}

for workflow in "${WORKFLOWS[@]}"; do
  artifact_name="$(workflow_to_artifact "${workflow}")"
  if [[ -z "${artifact_name}" ]]; then
    echo "[skip] workflow '${workflow}' は既定artifact名が未定義です。" >&2
    continue
  fi

  run_ids="$(gh run list \
    -R "${REPO_SLUG}" \
    --workflow "${workflow}" \
    --branch "${BRANCH}" \
    --status completed \
    --limit "${LIMIT}" \
    --json databaseId,conclusion \
    --jq '[.[] | select(.conclusion=="success") | .databaseId] | reverse | .[]')"

  if [[ -z "${run_ids}" ]]; then
    echo "[skip] workflow='${workflow}' branch='${BRANCH}' の成功runが見つかりません。"
    continue
  fi

  imported_count=0
  skipped_existing_count=0

  while IFS= read -r run_id; do
    if [[ -z "${run_id}" || "${run_id}" == "null" ]]; then
      continue
    fi

    if compgen -G "artifacts/runs/gha-${run_id}-*" > /dev/null; then
      echo "[skip] already imported: workflow='${workflow}' run_id=${run_id}"
      skipped_existing_count=$((skipped_existing_count + 1))
      continue
    fi

    echo "[import] workflow='${workflow}' run_id=${run_id} artifact='${artifact_name}'"
    scripts/import-gha-artifact.sh "${run_id}" --artifact "${artifact_name}" --repo "${REPO_SLUG}"
    imported_count=$((imported_count + 1))
  done <<< "${run_ids}"

  echo "[done] workflow='${workflow}' imported=${imported_count} skipped_existing=${skipped_existing_count}"
done
