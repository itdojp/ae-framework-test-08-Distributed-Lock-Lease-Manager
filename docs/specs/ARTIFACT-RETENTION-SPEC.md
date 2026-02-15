# 成果物保存規約（ae-framework 評価用）

## 1. 目的
ae-framework の評価に必要な中間生成物・実行ログ・要約を欠落なく保存し、後追い検証と監査を可能にする。

## 2. 保存原則
1. CIの一時Artifactだけに依存しない。評価対象の中間物はリポジトリにコミットする。
2. 1実行につき 1 ディレクトリを作成し、再現に必要な情報を同梱する。
3. 失敗実行のログも保存対象とする（失敗理由の分析に利用）。

## 3. 保存構造
- ルート: `artifacts/runs/`
- 実行単位: `artifacts/runs/<YYYYMMDDTHHMMSSZ>/`
- 必須ファイル:
  - `metadata.json`（実行日時、コミット、ツールバージョン、Issue参照、`status`/`exit_code`/`failed_step`/`optional_fail_count`/`optional_failures`）
  - `summary.md`（実行結果サマリ）
  - `logs/*.log`（各コマンド標準出力/標準エラー）
- 任意保存:
  - `ae-framework-artifacts/`（ae-framework 側成果物コピー）
  - `ae-framework-reports/`（比較レポート等）
  - `artifacts/traceability/latest.json` / `latest.md`（要件トレーサビリティ自動検証結果）

## 4. コミット規約
1. 実行単位ディレクトリを丸ごと `git add` する。
2. コミットメッセージは `artifacts: run <timestamp> <result>` 形式を推奨。
3. 大容量バイナリは原則避け、必要時は圧縮の上で保存理由を `summary.md` に記載する。
4. GitHub Actions artifact を取り込む場合は `scripts/import-gha-artifact.sh <run_id>` を使用し、`artifacts/runs/gha-<run_id>-<attempt>/` に保存する。

## 5. 参照規約
- 各Issue/PRには対象実行ディレクトリへのパスを明記する。
- 仕様差分の議論では、`summary.md` と `metadata.json` を一次参照とする。

## 6. 異常終了時の取り扱い
1. 実行失敗時も `metadata.json` と `summary.md` を生成し、`status=failed` と失敗ステップを記録する。
2. `logs/` に失敗ステップのログを必ず残す。
3. 一時marker（`.run-start.marker`）は成功/失敗を問わず削除する。
4. optional ステップ失敗は non-blocking としつつ、`metadata.json` の `optional_failures` に必ず記録する。
