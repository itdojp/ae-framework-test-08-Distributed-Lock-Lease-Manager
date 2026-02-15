# ae-framework-test-08 Distributed Lock / Lease Manager

## 目的
このリポジトリは、分散ロック／リースマネージャの実装を行いながら、`itdojp/ae-framework` の実運用有用性を評価するための検証用プロジェクトです。

## 参照 Issue
- 仕様書: https://github.com/itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager/issues/1
- 開発開始時点の Codex 実行情報: https://github.com/itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager/issues/2
- 開発計画と ae-framework 活用仕様: https://github.com/itdojp/ae-framework-test-08-Distributed-Lock-Lease-Manager/issues/3

## 主要ドキュメント
- 開発計画: `docs/plans/DEVELOPMENT-PLAN.md`
- ae-framework ツール活用仕様: `docs/specs/AE-FRAMEWORK-TOOL-USAGE-SPEC.md`
- 成果物保存規約: `docs/specs/ARTIFACT-RETENTION-SPEC.md`
- 自動化プロファイル: `configs/ae-eval-profile.yaml`
- 要求仕様（正規化）: `spec/requirements.md`
- API契約: `contracts/openapi.yaml`

## 自動化実行
- 実行スクリプト: `scripts/run-ae-eval.sh`
- GHA成果物取り込み: `scripts/import-gha-artifact.sh`
- 生成成果物の保存先: `artifacts/runs/<UTC timestamp>/`
- 既定挙動: 実行開始後に更新された `ae-framework` 側成果物のみコピー
- オプション:
  - `AE_RUN_OPTIONAL=0` で optional ステップ（mbt/pbt/mutation/formal）をスキップ

## GitHub Actions
- `CI Basic` (`.github/workflows/ci-basic.yml`):
  - push/PR で `npm run test:all` を実行
- `AE Eval Fast` (`.github/workflows/ae-eval-fast.yml`):
  - `push(main)` / `workflow_dispatch` で ae-framework をクローンし、`AE_RUN_OPTIONAL=0` で評価実行
  - `metadata.json` の要約（status/exit_code/optional_fail_count）を Job Summary に出力
- `AE Eval Full` (`.github/workflows/ae-eval-full.yml`):
  - `workflow_dispatch` で ae-framework をクローンし、`AE_RUN_OPTIONAL=1`（optional含む）で評価実行
  - `metadata.json` の要約（status/exit_code/optional_fail_count）を Job Summary に出力

## ローカル実装の実行
- サーバー起動: `npm run start`
- テスト一括: `npm run test:all`
- 契約テストのみ: `npm run test:contract`
- 受入テストのみ: `npm run test:acceptance`
- 状態永続化テスト: `node --test tests/unit/state-persistence.test.mjs`
- 契約テスト雛形生成: `npm run contracts:generate`
- トレーサビリティレポート生成: `npm run traceability:generate`
- GitHub Actions artifact 取り込み: `npm run artifacts:import-gha -- <run_id> [--artifact <artifact_name>]`

## API認可補足
- `acquire/renew/release` は `x-owner-id` 必須（不足時 `401 OWNER_TOKEN_REQUIRED`）
- `x-owner-id` と `owner_id` が不一致の場合は `401 OWNER_TOKEN_MISMATCH`
- `POST /locks/{lock_key}/force-release` は `x-role: ADMIN` が必須（不足時 `403 FORBIDDEN`）

## 前提バージョン
- Node.js: `>=20.11 <23`（ae-framework README 記載）
- pnpm: `10.x`（ae-framework README 記載）

## SQLite実装補足
- `src/sqlite-lease-manager.mjs` は `node:sqlite` を使用（Node 22系では experimental warning が出る）
- SQLiteバックエンドを実行する場合は Node.js 22 以上が必要（Node 20系では `SQLITE_UNSUPPORTED` を返す）

## フェンシング利用サンプル
- `src/fenced-resource.mjs` は下流更新時に `fencing_token` の単調増加を強制する最小実装
- 古い token は `409 STALE_FENCING_TOKEN` で拒否（`tests/unit/fenced-resource.test.mjs`）
