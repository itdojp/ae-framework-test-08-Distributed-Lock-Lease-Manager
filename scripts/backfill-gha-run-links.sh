#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/backfill-gha-run-links.sh [--repo <owner/repo>] [--root <artifacts/runs>]

Examples:
  scripts/backfill-gha-run-links.sh
  scripts/backfill-gha-run-links.sh --repo itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager
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
  if [[ ! -d "${dir}" || ! -f "${dir}/gha-artifact-download.json" ]]; then
    continue
  fi

  run_id="$(jq -r '.run_id // empty' "${dir}/gha-artifact-download.json")"
  repo="$(jq -r '.repository // empty' "${dir}/gha-artifact-download.json")"
  if [[ -z "${repo}" ]]; then
    repo="${REPO_SLUG}"
  fi

  if [[ -z "${run_id}" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  run_url="https://github.com/${repo}/actions/runs/${run_id}"
  run_api_url="https://api.github.com/repos/${repo}/actions/runs/${run_id}"
  has_download_link="$(jq -r --arg run_url "${run_url}" --arg run_api_url "${run_api_url}" '
    ( (.run_url // "") == $run_url ) and ( (.run_api_url // "") == $run_api_url )
  ' "${dir}/gha-artifact-download.json")"

  has_metadata_link="false"
  if [[ -f "${dir}/metadata.json" ]]; then
    has_metadata_link="$(jq -r --arg run_url "${run_url}" --arg run_api_url "${run_api_url}" '
      ( (.run_url // "") == $run_url ) and ( (.run_api_url // "") == $run_api_url )
    ' "${dir}/metadata.json")"
  fi

  if [[ "${has_download_link}" == "true" && "${has_metadata_link}" == "true" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  tmp_file="$(mktemp)"
  jq \
    --arg repo "${repo}" \
    --argjson run_id "${run_id}" \
    --arg run_url "${run_url}" \
    --arg run_api_url "${run_api_url}" \
    '
      .repository = (.repository // $repo) |
      .run_id = (.run_id // $run_id) |
      .run_url = $run_url |
      .run_api_url = $run_api_url
    ' \
    "${dir}/gha-artifact-download.json" > "${tmp_file}"
  mv "${tmp_file}" "${dir}/gha-artifact-download.json"

  if [[ -f "${dir}/metadata.json" ]]; then
    tmp_file="$(mktemp)"
    jq \
      --arg run_url "${run_url}" \
      --arg run_api_url "${run_api_url}" \
      '
        .run_url = (if (.run_url // "") == "" then $run_url else .run_url end) |
        .run_api_url = (if (.run_api_url // "") == "" then $run_api_url else .run_api_url end)
      ' \
      "${dir}/metadata.json" > "${tmp_file}"
    mv "${tmp_file}" "${dir}/metadata.json"
  fi

  if [[ -f "${dir}/summary.md" ]] && ! grep -q '^- run_url: ' "${dir}/summary.md"; then
    printf '%s\n' "- run_url: ${run_url}" >> "${dir}/summary.md"
  fi

  updated=$((updated + 1))
done

echo "run-link backfill complete: updated=${updated}, skipped=${skipped}"
