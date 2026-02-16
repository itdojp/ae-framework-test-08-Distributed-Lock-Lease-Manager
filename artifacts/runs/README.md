# artifacts/runs

実行証跡は `artifacts/runs/<YYYYMMDDTHHMMSSZ>/` へ保存する。
GitHub Actions取り込み時は `artifacts/runs/gha-<run_id>-<attempt>/` を使用する。

最低限、以下を含める。
- `metadata.json`
- `summary.md`
- `logs/*.log`

集約インデックス:
- `artifacts/runs/index.json`
- `artifacts/runs/index.md`

生成コマンド:
- `npm run artifacts:index`
- `npm run artifacts:sync-index`
- `npm run artifacts:backfill-meta`
- `npm run artifacts:hydrate-index`

運用ルールの詳細は `docs/specs/ARTIFACT-RETENTION-SPEC.md` を参照。
