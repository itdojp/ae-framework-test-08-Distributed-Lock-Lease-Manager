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
- GHA成果物の一括同期（未取り込み成功run全件）: `scripts/sync-gha-artifacts.sh`
- 既存取り込みのメタデータ補完: `scripts/backfill-imported-run-metadata.sh`
- 既存取り込みの run URL 補完: `scripts/backfill-gha-run-links.sh`
- 評価runインデックス生成: `scripts/generate-run-index.mjs`
- 生成成果物の保存先: `artifacts/runs/<UTC timestamp>/`
- 既定挙動: 実行開始後に更新された `ae-framework` 側成果物のみコピー
- オプション:
  - `AE_RUN_OPTIONAL=0` で optional ステップ（mbt/pbt/mutation/formal）をスキップ
  - `AE_PBT_COMPAT_MODE=1`（既定）で `pbt` が失敗し、かつ `tests/property/vitest.config.ts` の解決失敗を検知した場合のみ `test:property` を補助実行し、`metadata.json` に互換実行の結果を記録

## GitHub Actions
- `CI Basic` (`.github/workflows/ci-basic.yml`):
  - push/PR で `npm run test:all` を実行
  - `artifacts/runs/**` のみ変更された push では自動起動しない（artifact保存ループ防止）
- `AE Eval Fast` (`.github/workflows/ae-eval-fast.yml`):
  - `push(main)` / `workflow_dispatch` で ae-framework をクローンし、`AE_RUN_OPTIONAL=0` で評価実行
  - `metadata.json` の要約（status/exit_code/optional_fail_count）を Job Summary に出力
  - `artifacts/runs/**` のみ変更された push では自動起動しない（artifact保存ループ防止）
- `AE Eval Full` (`.github/workflows/ae-eval-full.yml`):
  - `workflow_dispatch` / `schedule`（毎日 UTC 03:37）で ae-framework をクローンし、`AE_RUN_OPTIONAL=1`（optional含む）で評価実行
  - `metadata.json` の要約（status/exit_code/optional_fail_count）を Job Summary に出力
- `Artifacts Maintenance` (`.github/workflows/artifacts-maintenance.yml`):
  - `schedule`（6時間ごと）/`workflow_dispatch` で run artifact 同期・メタ補完・index再生成を自動実行
  - `artifacts/runs/` に差分がある場合のみ自動コミット/Push
  - `index` 内容不変時は `generated_at_utc` を据え置き、timestamp-only 差分コミットを抑止
  - `artifacts-writer-main` concurrency group で他のartifact書き込みworkflowと直列実行
- `Artifacts Sync On Workflow Complete` (`.github/workflows/artifacts-sync-on-workflow-complete.yml`):
  - `CI Basic` / `AE Eval Fast` / `AE Eval Full` が `success` で完了した直後に起動し、同一 `head_sha` の成功runをまとめて取り込み
  - `backfill-meta` / `index` 更新まで実行し、差分がある場合のみ自動コミット/Push
  - push競合時は `origin/main` を照合し、対象runが既に反映済みなら成功扱いで終了

## ローカル実装の実行
- サーバー起動: `npm run start`
- テスト一括: `npm run test:all`
- 契約テストのみ: `npm run test:contract`
- 受入テストのみ: `npm run test:acceptance`
- 状態永続化テスト: `node --test tests/unit/state-persistence.test.mjs`
- 契約テスト雛形生成: `npm run contracts:generate`
- トレーサビリティレポート生成: `npm run traceability:generate`
- ae-framework有用性評価レポート生成: `npm run evaluate:ae-framework`
- GitHub Actions artifact 取り込み: `npm run artifacts:import-gha -- <run_id> [--artifact <artifact_name>]`
- GitHub Actions artifact一括同期（取得範囲内の未取り込みsuccess run全件）: `npm run artifacts:sync-gha -- [--workflow \"AE Eval Full\"]`
- 既存取り込みのメタデータ補完: `npm run artifacts:backfill-meta`
- 既存取り込みのrun URL補完: `npm run artifacts:backfill-links`
- 評価runインデックス生成: `npm run artifacts:index`
- 同期 + インデックス一括実行: `npm run artifacts:sync-index`
- 補完 + インデックス再生成: `npm run artifacts:hydrate-index`

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
