# ae-framework ツール活用仕様

## 1. 目的
Distributed Lock / Lease Manager 開発において、ae-framework で利用するツールを固定化し、実行方法・成果物・評価観点を標準化する。

## 2. 前提（根拠）
- Node.js `>=20.11 <23`（`https://github.com/itdojp/ae-framework/blob/main/README.md`）
- pnpm `10.x`（`https://github.com/itdojp/ae-framework/blob/main/README.md`）
- CodeX 統合導線（CLI/MCP/Adapter）あり（`https://github.com/itdojp/ae-framework/blob/main/docs/integrations/CODEX-INTEGRATION.md`）
- 最小検証キット指針あり（`https://github.com/itdojp/ae-framework/blob/main/docs/reference/SPEC-VERIFICATION-KIT-MIN.md`）

## 3. 採用ツール一覧
| 区分 | 採用コマンド | 目的 | 主出力 |
| --- | --- | --- | --- |
| 品質ゲート | `pnpm run verify:lite` | Lint/型/テストの最小合否を自動判定 | `artifacts/verify-lite/*` |
| CodeX PoC統合 | `pnpm run codex:quickstart` | CodeX連携の自動実行と要約生成 | `artifacts/codex-quickstart-summary.md` |
| 仕様合成MCP | `pnpm run codex:mcp:spec` | AE-Spec の validate/compile/codegen | `artifacts/codex/result-*.json` |
| 検証MCP | `pnpm run codex:mcp:verify` | 検証結果を機械可読で取得 | `artifacts/codex/result-verify.json` |
| テスト生成MCP | `pnpm run codex:mcp:test` | 契約/テスト生成の自動化 | `tests/api/generated/*` |
| 実装補助MCP | `pnpm run codex:mcp:code` | 実装テンプレ生成の自動化 | `artifacts/codex/result-code.json` |
| MBT | `pnpm run mbt` | 状態遷移の網羅検証 | `artifacts/*`（実行ログ含む） |
| Property | `pnpm run pbt` | 不変条件の確率的検証 | `artifacts/*`（実行ログ含む） |
| Mutation | `STRYKER_TIME_LIMIT=0 pnpm run pipelines:mutation:quick` | テスト有効性測定 | `reports/*`, `artifacts/*` |
| 形式検証（段階導入） | `pnpm run verify:csp ...`, `pnpm run verify:tla ...` | 並行性・安全性の検証 | `artifacts/hermetic-reports/formal/*` |

## 4. 自動化設定
- 方針: 手動判断を最小化し、コマンド列はスクリプト化する。
- 実行プロファイル:
  - `CODEX_RUN_FORMAL=1`
  - `CODEX_SKIP_QUALITY=0`
  - `CODEX_TOLERANT=0`
  - `AE_RUN_OPTIONAL=1`（標準）、`0` で optional ステップを省略
  - `AE_PBT_COMPAT_MODE=1`（標準）、`pbt` 設定不整合時に互換フォールバックを許可
- 実行入口: `scripts/run-ae-eval.sh`
- CI成果物のリポジトリ保存: `scripts/import-gha-artifact.sh <run_id>`（`--refresh-meta` で既存取り込み先のメタデータ再補完）
- CI成果物の最新一括同期: `scripts/sync-gha-artifacts.sh`（workflow名から最新成功runを自動解決）
- 既存取り込みのメタデータ補完: `scripts/backfill-imported-run-metadata.sh`
- 評価履歴インデックス生成: `scripts/generate-run-index.mjs`（`artifacts/runs/index.json` / `index.md`）
- 実行結果の保存先: `artifacts/runs/<UTC timestamp>/`
- 成果物コピー方針: 実行開始後に更新された `ae-framework` 側ファイルのみを保存
- optional ステップ失敗は non-blocking で継続し、`metadata.json` の `optional_failures` に記録する
- `pbt` が `tests/property/vitest.config.ts` 欠落で失敗した場合、`AE_PBT_COMPAT_MODE=1` では `pnpm run test:property` を `pbt_compat_test_property` として追加実行する
- `metadata.json` に `optional_step_count` / `optional_results` / `pbt_compat_triggered` / `pbt_compat_recovered` を記録する
- GitHub Actions:
  - `AE Eval Fast`（`AE_RUN_OPTIONAL=0`）: `push(main)` と `workflow_dispatch`
  - `AE Eval Full`（`AE_RUN_OPTIONAL=1`）: `workflow_dispatch`
  - 両workflowとも `metadata.json` 要約を Job Summary に出力し、optional失敗件数を即時確認可能にする
  - `CI Basic` / `AE Eval Fast` の `push` は `artifacts/runs/**` のみ変更時は起動しない（保存ループ抑止）

## 5. 実行順序（標準）
1. `pnpm run build`
2. `pnpm run codex:quickstart`
3. `pnpm run verify:lite`
4. `pnpm run mbt`
5. `pnpm run pbt`
6. `STRYKER_TIME_LIMIT=0 pnpm run pipelines:mutation:quick`
7. `pnpm run verify:csp -- --file spec/csp/cspx-smoke.cspm --mode typecheck`
8. `pnpm run verify:tla -- --engine=tlc --file spec/tla/DomainSpec.tla`

## 6. 評価指標
1. 検証再現性: 同一入力で同等の結果が再取得可能
2. 追跡可能性: 要件ID（LS-*）とテスト/検証結果の紐付けが可能
3. 自動化率: 手作業なしでフェーズ進行できる割合
4. 品質検出力: mutation/formal で欠陥が顕在化する割合

## 7. 変更管理
- 採用ツールの追加・削除は本仕様を更新し、Issueで理由を記録する。
- ツール未導入や前提不足がある場合は「未導入理由」と「代替手順」を明記する。
