# Mutation対象（LS-SPEC-001）

## 1. 判定境界
- `expires_at <= now` を `<` に変更する変異
- `now < expires_at` を `<=` に変更する変異

## 2. 所有者検証
- `owner_id` 一致チェック削除
- renew/release の owner 引数を無視

## 3. フェンシングトークン
- Acquire時の `token + 1` を `token` のままにする
- lock_key単位でなくグローバルtokenにする

## 4. ロック解放
- release/expire 時に `active_lease_id` をクリアしない
- force-release を no-op にする

## 5. 冪等性
- `request_id` マップ参照を削除
- request_id のキーに tenant を含めない
