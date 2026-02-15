# LS-SPEC-001 要求仕様（正規化）

## 1. 文書メタ
- 文書ID: `LS-SPEC-001`
- 対象Issue: `#1`
- 作成日: `2026-02-15`
- 目的: 分散ロック/リースの要件を実装・検証可能な形へ正規化する

## 2. 要求ID一覧
### 2.1 不変条件
- `LS-INV-001`: 同一 `(tenant_id, lock_key)` に対して ACTIVE は最大1
- `LS-INV-002`: `fencing_token` は lock_key 単位で単調増加（重複禁止）
- `LS-INV-003`: Renew/Release は owner一致かつ期限内 ACTIVE のみ成功
- `LS-INV-004`: 期限切れ lease の Renew/Release は 409

### 2.2 Acquire
- `LS-ACQ-001`: ACTIVE lease が期限内なら `409 LOCK_HELD`
- `LS-ACQ-002`: lock空 or 期限切れなら新規 ACTIVE lease
- `LS-ACQ-003`: `current_fencing_token + 1` で採番
- `LS-ACQ-004`: `request_id` 再送は同一 lease を返す（期限内）

### 2.3 Renew
- `LS-RNW-001`: ACTIVE かつ owner一致 かつ `now < expires_at` のみ成功
- `LS-RNW-002`: `new_expires_at = now + ttl_seconds`
- `LS-RNW-003`: `request_id` 再送は冪等

### 2.4 Release
- `LS-REL-001`: owner一致かつ期限内のみ成功
- `LS-REL-002`: 解放後 lock は空
- `LS-REL-003`: `request_id` 再送は冪等

### 2.5 競合・期限切れ・認証
- `LS-CC-001`: Acquire は lock_key 単位で原子的
- `LS-EXP-001`: 期限切れ処理は冪等
- `LS-AUTH-001`: owner_id は原則トークン起点

### 2.6 フェンシング・受入
- `LS-FENCE-001`: 下流で token の新旧比較により古い要求を拒否可能
- `LS-ACC-01`: 同時Acquireで二重取得しない
- `LS-ACC-02`: Renew/Release は owner一致・期限内のみ
- `LS-ACC-03`: token 単調増加
- `LS-ACC-04`: request_id 再送で二重取得/二重解放なし

## 3. 状態遷移
| 現在 | 操作 | 遷移先 | 条件 |
| --- | --- | --- | --- |
| なし | acquire | ACTIVE | lock空または期限切れ |
| ACTIVE | renew | ACTIVE | owner一致・期限内 |
| ACTIVE | release | RELEASED | owner一致・期限内 |
| ACTIVE | expire | EXPIRED | `now >= expires_at` |
| RELEASED/EXPIRED | renew/release | 409 | 終端状態 |

## 4. トレーサビリティ
| 要求ID | 実装箇所 | テスト箇所 |
| --- | --- | --- |
| LS-INV-001 | `src/lease-manager.mjs` | `tests/property/lease-invariants.property.test.mjs` |
| LS-INV-002 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-INV-002（再起動後） | `src/state-persistence.mjs` | `tests/unit/state-persistence.test.mjs` |
| LS-INV-003 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-INV-004 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-ACQ-001..004 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-RNW-001..003 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-REL-001..003 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-CC-001 | `src/lease-manager.mjs` | `tests/mbt/lease-state-model.mbt.test.mjs` |
| LS-EXP-001 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-FENCE-001 | `src/lease-manager.mjs` | `tests/unit/lease-manager.test.mjs` |
| LS-AUTH-001 | `src/server.mjs` | `tests/integration/server-api.test.mjs` |
| API契約整合 | `contracts/openapi.yaml`, `schema/*.json` | `tests/contracts/api-contract.test.mjs` |
