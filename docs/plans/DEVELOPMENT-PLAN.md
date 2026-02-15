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
