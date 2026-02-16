#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/backfill-imported-run-metadata.sh [--repo <owner/repo>] [--root <artifacts/runs>]

Examples:
  scripts/backfill-imported-run-metadata.sh
  scripts/backfill-imported-run-metadata.sh --root artifacts/runs
USAGE
}

if ! command -v jq >/dev/null 2>&1; then
  echo "jq が見つかりません。jq をインストールしてください。" >&2
  exit 1
fi

REPO_SLUG="${GITHUB_REPOSITORY:-itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager}"
RUNS_ROOT="artifacts/runs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_SLUG="${2:-}"
      shift 2
      ;;
    --root)
      RUNS_ROOT="${2:-}"
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

if [[ ! -d "${RUNS_ROOT}" ]]; then
  echo "対象ディレクトリが存在しません: ${RUNS_ROOT}" >&2
  exit 1
fi

updated=0
skipped=0

for dir in "${RUNS_ROOT}"/gha-*; do
  if [[ ! -d "${dir}" ]]; then
    continue
  fi

  if [[ -f "${dir}/metadata.json" && -f "${dir}/summary.md" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [[ ! -f "${dir}/gha-artifact-download.json" ]]; then
    echo "[skip] gha-artifact-download.json がないため対象外: ${dir}"
    skipped=$((skipped + 1))
    continue
  fi

  run_id="$(jq -r '.run_id // empty' "${dir}/gha-artifact-download.json")"
  artifact_name="$(jq -r '.artifact_name // empty' "${dir}/gha-artifact-download.json")"

  if [[ -z "${run_id}" || -z "${artifact_name}" ]]; then
    echo "[skip] run_id/artifact_name が取得できないため対象外: ${dir}"
    skipped=$((skipped + 1))
    continue
  fi

  echo "[backfill] ${dir} (run_id=${run_id}, artifact=${artifact_name})"
  scripts/import-gha-artifact.sh "${run_id}" \
    --artifact "${artifact_name}" \
    --dest "${dir}" \
    --repo "${REPO_SLUG}" \
    --refresh-meta
  updated=$((updated + 1))
done

echo "backfill complete: updated=${updated}, skipped=${skipped}"
