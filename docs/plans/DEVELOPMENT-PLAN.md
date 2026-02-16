# 開発計画（Distributed Lock / Lease Manager）

## 1. 計画メタ
- 作成日: 2026-02-15
- 対象仕様: Issue #1
- 実行環境記録: Issue #2
- 計画管理: Issue #3
- 開発方針: ae-framework を最大限自動化で利用し、生成物・中間物をGitHubに保存

## 2. 目的
1. 分散ロック／リースマネージャを仕様準拠で実装する。
2. ae-framework の Spec/Verification/Automation ツールチェーンの有効性を評価する。
3. 評価に必要な証跡（中間成果物・ログ・サマリ）を追跡可能な形で永続化する。

## 3. フェーズ計画
1. フェーズ0: キックオフ固定化
- 実施内容: 実行環境情報Issueの登録、計画とツール活用仕様の作成
- 完了条件: Issue #2 と本計画がGitHub上で参照可能

2. フェーズ1: 仕様正規化
- 実施内容: Issue #1 を SSOT 化し、`spec/` 配下に要求ID・不変条件・状態遷移を文書化
- 主成果物: `spec/requirements.md`, `contracts/openapi.yaml`, `schema/*.json`
- 完了条件: 仕様レビューで LS-INV/LS-ACC のトレーサビリティが成立

3. フェーズ2: 検証設計（テスト先行）
- 実施内容: MBT/Property/Formal の各検証観点をテスト仕様へ落とし込む
- 主成果物: `tests/mbt/*`, `tests/property/*`, `spec/formal/*`
- 完了条件: RED状態のテスト群が再現可能

4. フェーズ3: 実装（RED→GREEN）
- 実施内容: Acquire/Renew/Release/Get/ForceRelease を順次実装
- 主成果物: `src/*`, `tests/*`
- 完了条件: 要求ID対応のテストが GREEN

5. フェーズ4: 総合検証と評価
- 実施内容: verify-lite、formal、mutation、重め検証を実行し評価
- 主成果物: `artifacts/runs/*`, `reports/*`
- 完了条件: 受入基準 LS-ACC-01〜04 を満たし、評価サマリが作成済み

## 4. 運用ゲート
1. すべての実行ログを `artifacts/runs/<timestamp>/` に保存する。
2. CI成果物のみで済ませず、評価に必要な中間物はリポジトリにコミットする。
3. 主要マイルストーンごとに Issue 更新（仕様変更・検証結果）を残す。

## 5. 初期バックログ（次アクション）
1. `spec/requirements.md` の初版作成（Issue #1 の LS-* を転記）: 完了
2. `contracts/openapi.yaml` の初版作成（Acquire/Renew/Release/Get/Admin）: 完了
3. MBT最小モデルの作成（2クライアント競合）: 完了
4. Propertyテスト（LS-INV-001〜004）雛形を追加: 完了
5. `scripts/run-ae-eval.sh` で自動実行し、成果物を保存: 完了

## 6. 進捗ログ
### 2026-02-15
1. 仕様正規化を追加:
- `spec/requirements.md`
- `contracts/openapi.yaml`
- `schema/*.schema.json`
2. 実装を追加:
- `src/lease-manager.mjs`
- `src/server.mjs`
- `src/state-persistence.mjs`
- `src/sqlite-lease-manager.mjs`
3. 検証を追加:
- `tests/unit/lease-manager.test.mjs`
- `tests/contracts/api-contract.test.mjs`
- `tests/integration/server-api.test.mjs`
- `tests/property/lease-invariants.property.test.mjs`
- `tests/mbt/lease-state-model.mbt.test.mjs`
4. 成果物保存:
- `artifacts/runs/20260215T104900Z-eval/*`（ae-framework自動実行）
- `artifacts/runs/20260215T105530Z-impl-check/*`（本リポジトリ実装テスト）
5. 自動化改善:
- `scripts/run-ae-eval.sh` を更新し、実行開始後の更新分のみコピー
- `AE_RUN_OPTIONAL=0` で optional ステップをスキップ可能に変更
6. 改善後の実行証跡:
- `artifacts/runs/20260215T111100Z-eval-fast/*`
7. CI自動化を追加:
- `.github/workflows/ci-basic.yml`
- `.github/workflows/ae-eval-fast.yml`
8. トレーサビリティ自動化を追加:
- `scripts/generate-traceability-report.mjs`
- `artifacts/traceability/latest.json`
- `artifacts/traceability/latest.md`
9. 受入基準LS-ACCの専用テストを追加:
- `tests/acceptance/ls-acceptance.test.mjs`
10. 評価実行の耐障害化と証跡追加:
- `scripts/run-ae-eval.sh` に `EXIT` トラップを追加し、失敗時も `metadata.json` / `summary.md` を保存
- 異常終了時の `status` / `exit_code` / `failed_step` を `metadata.json` に記録
- 実行証跡:
  - `artifacts/runs/20260215T132609Z/`（依存未導入による失敗ログ）
  - `artifacts/runs/20260215T132700Z/`（ローカル fast 評価）
  - `artifacts/runs/20260215T133046Z/`（耐障害化後の再実行）
11. 自動化拡張:
- `AE Eval Fast` を `push(main)` でも自動実行するよう更新
- `AE Eval Full`（optional含む）workflow を追加し、手動で全量評価を実行可能化
12. optional失敗の機械可読化:
- `scripts/run-ae-eval.sh` の `metadata.json` に `optional_fail_count` / `optional_failures` を追加
- non-blocking失敗（例: pbt設定欠落）を自動集計可能な形式で保存
13. GHA成果物取り込み自動化:
- `scripts/import-gha-artifact.sh` を追加
- `npm run artifacts:import-gha -- <run_id>` で `artifacts/runs/gha-<run_id>-<attempt>/` へ保存可能化
14. 可観測性改善:
- `AE Eval Fast/Full` の Job Summary に `metadata.json`（status/exit_code/optional_fail_count）を出力
- 取り込み実績:
  - `artifacts/runs/gha-22037101340-1/`（CI Basic logs）
  - `artifacts/runs/gha-22037101333-1/`（AE Eval Fast）
15. 自動実行ループ抑止:
- `CI Basic` / `AE Eval Fast` の `push(main)` に `paths-ignore: artifacts/runs/**` を追加
- artifact-only commit では workflow を起動せず、証跡保存のための連鎖実行を防止
16. optional `pbt` 失敗時の互換フォールバックを追加:
- `scripts/run-ae-eval.sh` に `AE_PBT_COMPAT_MODE` を追加（既定 `1`）
- `pbt` が `tests/property/vitest.config.ts` 欠落で失敗した場合、`pbt_compat_test_property`（`pnpm run test:property`）を追加実行
- `metadata.json` に `optional_results` と `pbt_compat_triggered` / `pbt_compat_recovered` を記録
17. GHA成果物同期の自動化:
- `scripts/sync-gha-artifacts.sh` を追加し、workflow名（`AE Eval Fast`/`AE Eval Full`/`CI Basic`）ごとに成功runを列挙して未取り込み分を自動取り込み
- `npm run artifacts:sync-gha` を追加し、手動run ID指定を不要化
18. 評価runインデックスの自動生成:
- `scripts/generate-run-index.mjs` を追加し、`artifacts/runs/index.json` / `index.md` を生成
- `npm run artifacts:index` / `npm run artifacts:sync-index` を追加し、同期後の集約更新を標準化
19. 取り込み済みrunのメタデータ後補完を追加:
- `scripts/import-gha-artifact.sh` に `--refresh-meta` を追加し、既存ディレクトリでメタデータ補完を可能化
- `scripts/backfill-imported-run-metadata.sh` を追加し、`metadata.json` / `summary.md` 欠落runを一括補完
- `npm run artifacts:backfill-meta` / `npm run artifacts:hydrate-index` を追加し、補完後のインデックス再生成を標準化
20. run証跡メンテナンスの定期自動化:
- `.github/workflows/artifacts-maintenance.yml` を追加
- 6時間ごとの定期実行 + 手動実行で `sync-gha` / `backfill-meta` / `index` 更新を自動化
- `artifacts/runs/` に差分がある場合のみ自動コミット/Push
21. `AE Eval Full` の定期実行化:
- `.github/workflows/ae-eval-full.yml` に日次 `schedule`（UTC 03:37）を追加
- full評価（optional含む）を無人で継続実行し、`Artifacts Maintenance` で取り込み・インデックス更新を自動化
22. run index 生成の安定化:
- `scripts/generate-run-index.mjs` を更新し、`summary/runs` 不変時は `generated_at_utc` を維持
- `Artifacts Maintenance` で timestamp-only の不要コミットが発生しないよう抑止
23. 完了イベント連動の即時取り込み:
- `.github/workflows/artifacts-sync-on-workflow-complete.yml` を追加
- `CI Basic` / `AE Eval Fast` / `AE Eval Full` の成功完了を契機に起動し、同一 `head_sha` の成功runをまとめて即時取り込み
- `backfill -> index` まで自動実行し、6時間周期を待たずに証跡を反映
24. artifact書き込みworkflowの競合回避:
- `Artifacts Maintenance` と `Artifacts Sync On Workflow Complete` を `artifacts-writer-main` concurrency group で直列化
- 即時同期workflowの push 競合時は `origin/main` に対象runが反映済みかを照合し、重複実行を成功扱いで収束
25. run URL 補完の標準化:
- `scripts/import-gha-artifact.sh` で `gha-artifact-download.json` / 合成 `metadata.json` に `run_url` / `run_api_url` を出力
- `scripts/backfill-gha-run-links.sh` を追加し、既存 `gha-*` へ run URL を後補完
- `index` へ `run_url` を反映し、Issue/監査からrun画面へ直接遷移できる状態にする
26. optional `pbt` 互換フォールバック判定の厳密化:
- `scripts/run-ae-eval.sh` の `run_optional_pbt_compat` を更新し、`pbt` 成功時はフォールバックを実行しないよう修正
- `pbt` 失敗時も `tests/property/vitest.config.ts` の解決失敗ログがある場合のみ `pbt_compat_test_property` を起動するよう制約
- `pbt_compat_triggered` の誤検知を防止し、metadata の評価指標精度を改善
27. 仕様適合性検証の補強と有用性評価の自動化:
- `tests/unit/lease-manager.test.mjs` に `LS-ACQ-003` / `LS-RNW-002/003` / `LS-REL-002/003` の明示テストを追加
- `npm run test:all` と `npm run traceability:generate` で再検証し、`artifacts/traceability/latest.*` を更新
- `scripts/evaluate-ae-framework-usefulness.mjs` を追加し、`artifacts/runs/index.json` と `artifacts/traceability/latest.json` から有用性評価レポートを自動生成可能化
