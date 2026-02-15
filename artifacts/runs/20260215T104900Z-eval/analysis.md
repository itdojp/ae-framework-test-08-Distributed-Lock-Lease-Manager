# run analysis

## executed_at
- 2026-02-15 (UTC)

## required steps
- build: success
- codex_quickstart: success (quality gate warningあり)
- verify_lite: success

## optional steps
- mbt: success
- pbt: failed
  - reason: `tests/property/vitest.config.ts` が ae-framework 側で解決できず起動失敗
  - evidence: `logs/pbt.log`
- mutation_quick: command returned success, but内部で Stryker の initial dry-run timeout が発生
  - evidence: `logs/mutation_quick.log`
- verify_csp: success
- verify_tla: success

## note
- 本評価では「中間生成物保存」を優先し、失敗ログも保存済み。
