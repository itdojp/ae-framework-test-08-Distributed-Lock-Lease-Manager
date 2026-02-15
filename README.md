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
- 生成成果物の保存先: `artifacts/runs/<UTC timestamp>/`
- 既定挙動: 実行開始後に更新された `ae-framework` 側成果物のみコピー
- オプション:
  - `AE_RUN_OPTIONAL=0` で optional ステップ（mbt/pbt/mutation/formal）をスキップ

## ローカル実装の実行
- サーバー起動: `npm run start`
- テスト一括: `npm run test:all`
- 契約テストのみ: `npm run test:contract`
- 状態永続化テスト: `node --test tests/unit/state-persistence.test.mjs`

## 前提バージョン
- Node.js: `>=20.11 <23`（ae-framework README 記載）
- pnpm: `10.x`（ae-framework README 記載）
