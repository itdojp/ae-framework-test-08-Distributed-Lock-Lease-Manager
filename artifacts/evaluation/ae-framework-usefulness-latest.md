# ae-framework 有用性検証レポート

- generated_at_utc: 2026-02-16T11:10:29.748Z
- overall_score: 100
- conclusion: usable

## 指標

| metric | score | passed/total |
| --- | --- | --- |
| reproducibility | 100 | 3/3 |
| traceability | 100 | 1/1 |
| automation | 100 | 5/5 |
| quality_detection | 100 | 3/3 |

## 主要エビデンス

- traceability_coverage_percent: 100
- latest_ci_basic: gha-22055883217-1 (success)
- latest_ae_eval_fast: gha-22055883246-1 (success)
- latest_ae_eval_full: gha-22055991796-1 (success)
- ae_eval_full_optional_failure_runs: 5
- latest_full_optional_fail_count: 0
- latest_full_pbt_compat_triggered: 0

## 判定内訳

### reproducibility

- [x] 最新 CI Basic が success
  - evidence: gha-22055883217-1
- [x] 最新 AE Eval Fast が success
  - evidence: gha-22055883246-1
- [x] 最新 AE Eval Full が success
  - evidence: gha-22055991796-1

### traceability

- [x] トレーサビリティ被覆率が 100%
  - evidence: 100

### automation

- [x] CI Basic が push(main) で自動実行される
  - evidence: .github/workflows/ci-basic.yml
- [x] AE Eval Fast が push(main) で自動実行される
  - evidence: .github/workflows/ae-eval-fast.yml
- [x] AE Eval Full が schedule で定期実行される
  - evidence: .github/workflows/ae-eval-full.yml
- [x] Artifacts Maintenance が schedule で定期同期される
  - evidence: .github/workflows/artifacts-maintenance.yml
- [x] 完了イベント連動で artifacts 同期される
  - evidence: .github/workflows/artifacts-sync-on-workflow-complete.yml

### quality_detection

- [x] AE Eval Full で optional 失敗の履歴を観測できる
  - evidence: 5
- [x] 最新 AE Eval Full の optional_fail_count が 0
  - evidence: 0
- [x] 最新 AE Eval Full で pbt 互換フォールバックが不要
  - evidence: 0

