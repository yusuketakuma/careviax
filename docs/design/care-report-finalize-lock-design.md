# Care Report Finalize / Lock 設計メモ

- 状態: **ラティファイ済（2026-07-03 fable）** — 方向確定: 行レベル楽観ロックは `updated_at`/`expected_updated_at` を維持（D-14 からの意図的逸脱、§14 に記録）/ 改訂チェーン連番は `report_revision` 命名 / 推奨は Option B。**Option B vs C の最終選択と §14 未決事項（unique 制約×改訂行の軸追加 or 同一行 amend metadata / content_hash 計算時点 / unlock・void 権限分離の詳細）は migration 提案時の human 承認で確定する。** それまでコード実装（S4/W3-M1 含む）は本メモの確定方向のみを前提にしてよい。opus critic レビュー2巡（CHANGES_REQUESTED→全6点解消→APPROVE）済
- 対象: W3-B6a 報告書 finalize/lock 版管理（RPT-007）
- 隣接: W3-B6b 到達証跡ハードゲート（KYO-007/008）、
  W3-B6c 保存年限構造化（RPT-002/009）、
  W3-B6d 単一建物月次動的計数（ZTK-06）
- 関連:
  - `Plans.md` W3-B6a-d
  - `docs/visit-report-collab-spec.md` RPT-007 / KYO-007 / KYO-008 /
    RPT-002 / RPT-009 / ZTK-06
  - `docs/design/billing-requirement-catalog-design.md`
  - `docs/design/api-versioning-decision.md`
- 補足: 本文書は設計メモのみ。コード、schema、migration、API 契約は変更しない。
  DB migration、auth/authorization、監査ログ、保存年限、請求 hard gate は
  human approval 前提で、本文書は推奨案と未決事項を整理する。

## 1. 現状確認（2026-07-03 実測）

### 1.1 CareReport / DeliveryRecord の現状

- `prisma/schema/communication.prisma:122-157` の `CareReport` は
  `status`, `content`, `template_id`, `pdf_url`, `created_by`,
  `created_at`, `updated_at` を持つ。
- 同 model には `report_revision`, `finalized_at`, `finalized_by`, `locked_at`,
  `retention_basis`, `retention_rule_id`, `retention_until`,
  `amended_from_id` などの revision/finalize/retention 系カラムが無い。
- `ReportStatus` は `draft`, `sent`, `failed`, `confirmed`,
  `response_waiting` で、`finalized`, `locked`, `amended`, `superseded`
  は存在しない。
- `DeliveryRecord` は `channel`, `recipient_*`, `status`, `sent_at`,
  `confirmed_at`, `failure_reason`, `retry_count` を持つが、
  `delivery_proof_type`, proof artifact, proof verifier, proof source
  を持たない。
- `src/server/services/report-generator.ts:647-670` は既存 `draft`
  report のみ refresh 対象とし、`expectedReportUpdatedAt` で stale draft
  を弾く。finalize/lock 状態はまだ判定に入っていない。
- `src/app/api/visit-records/route.ts:1704-1719` は訪問記録保存時に
  `care_report_followup` task を作成するが、報告書 finalize、delivery
  proof、retention とはまだ連動しない。
- `src/app/api/care-reports/[id]/route.ts:335-349` は draft → confirmed
  を薬剤師確認として許可し、non-draft の本文変更を拒否する。これは
  app-layer lock として機能しているが、schema 上の finalizer / lock
  metadata はまだ持たない。
- `src/app/api/care-reports/[id]/send/route.ts:1581-1585` 以降は送付先処理後に
  報告書状態・服薬サイクル遷移・算定エビデンスを更新する。finalize/lock
  導入時は、臨床本文の immutable lock と server-managed delivery metadata
  を区別する必要がある。

### 1.2 Spec 上の要求

- W3-B6 は `Plans.md:164` で B6a-d に分割されている。B6a は
  finalize/lock 版管理、B6b は到達証跡 hard gate、B6c は保存年限構造化、
  B6d は単一建物月次動的計数であり、1 migration / 1 実装に吸収しない。
- `docs/visit-report-collab-spec.md:45` は RPT-007 として、
  作成者・確定者・確定時刻・変更履歴、finalize 後の改ざん防止、
  確定者の薬剤師免許束縛、訂正/追記の新版履歴、un-lock 限定、
  AuditLog 記録を要求している。
- `docs/visit-report-collab-spec.md:25` と `:47` は RPT-002/009 として、
  保険区分・起算点・管轄ルール別の保存年限と、確定文書の WORM
  保存を要求している。
- `docs/visit-report-collab-spec.md:26-27` は KYO-007/008 として、
  医師・ケアマネへの情報提供を delivery proof 付き hard gate にする
  ことを要求している。
- `docs/visit-report-collab-spec.md:30` と `:212-213` は ZTK-06 として、
  静的な単一建物患者数ではなく、請求月ごとの実績ベース動的計数を
  要求している。

## 2. スコープ分割

| 区分                       | 対象                                                                                            | 本文書での扱い                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Required in B6a            | CareReport finalize/lock、版管理、訂正/追記、un-lock 方針、AuditLog event                       | 推奨案を出す                                       |
| Interface reserved for B6b | delivery proof type、proof artifact、送付済み報告書の hard gate 入力                            | 境界を予約し、証跡十分性は未決にする               |
| Interface reserved for B6c | retention basis/jurisdiction/rule/until、Object Lock lifecycle                                  | フィールド案と連携境界を出し、年限解釈は未決にする |
| Interface reserved for B6d | monthly single-building count service、claim-record/provenance 入力                             | 接続点だけ定義し、計数実装は別設計に残す           |
| Non-goal                   | DB migration 実行、ReportStatus enum 変更、API response 変更、S3 Object Lock 実装、電子署名/TSA | 本文書では実装しない                               |

## 3. Option 比較

| 観点                     | Option A: 既存 `confirmed` status を拡張      | Option B: CareReport に additive finalize/revision columns を追加      | Option C: `CareReportRevision` / immutable snapshot table を新設 |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| schema 変更量            | 小。status 運用だけで始められる               | 中。nullable columns と `report_revision` を追加                       | 大。新 table / relation / backfill が必要                        |
| RPT-007 充足性           | 低。確定者、lock 時刻、版履歴、訂正理由が曖昧 | 中-高。1 row で確定・lock・amend chain を表現可能                      | 高。法的 record と編集 draft を明確に分離可能                    |
| 既存 API 互換            | 高いが、`confirmed` の意味をさらに曖昧にする  | 高。既存 response shape を維持しつつ内部 contract を追加できる         | 中。read/write path の join と API serializer 追随が必要         |
| migration リスク         | 低。ただし仕様未充足が残る                    | 中。additive migration だが revision/backfill/lock policy が必要       | 高。データ移行と rollback 設計が重い                             |
| 改訂行と既存 unique 制約 | 不十分。改訂を表現できない                    | 要検討。改訂を新規 `CareReport` row にすると既存 partial unique と衝突 | 有利。revision table 分離により既存 report uniqueness を温存可能 |
| report-generator 影響    | 小。ただし finalize lock を判定しにくい       | 中。draft refresh と finalized report を分岐しやすい                   | 大。generator/persister を大きく分割する必要                     |
| B6b/c/d との接続         | 弱い                                          | 十分。delivery proof / retention / monthly count の参照点を置ける      | 強いが先行コストが大きい                                         |
| 推奨度                   | 低                                            | 高                                                                     | 中（将来拡張候補。unique 制約面では相対的に強い）                |

## 4. 推奨案

**Option B を推奨する。** CareReport に非破壊の additive columns を追加し、
既存 `status` の互換を維持しながら、finalize/lock と版管理を status から
独立した第一級フィールドにする。

### 理由

1. **RPT-007 の責務を status 文字列から分離できる**:
   `confirmed` は既に送付・承認・response waiting と近い意味で使われており、
   電子保存上の finalize/lock 正本としては曖昧。`finalized_at` /
   `finalized_by` / `locked_at` / `report_revision` を独立させると、既存
   status 互換を壊さずに真正性を強化できる。
2. **migration が段階化できる**:
   nullable columns を先に追加し、既存 report は `report_revision=1`、
   `finalized_at=null` として扱える。draft 更新 path と送付 path の
   behavior を一度に変えずに済む。
3. **B6b/c/d の接続点を予約できる**:
   finalized report の immutable source に delivery proof、retention rule、
   monthly single-building count の snapshot/provenance を接続できる。
4. **Option C へ退路がある**:
   将来、電子署名/TSA や完全な legal-record separation が必要になった場合、
   Option B の `report_revision` / `amended_from_id` を migration bridge として
   `CareReportRevision` table へ移せる。

## 5. CareReport 追加カラム案

### 5.1 B6a core columns

以下は推奨案であり、migration 実行前に fable/human approval が必要。

| Column                               | Type案            | 用途                                               | 互換性                                         |
| ------------------------------------ | ----------------- | -------------------------------------------------- | ---------------------------------------------- |
| `report_revision`                    | `Int @default(1)` | 訂正/追記 chain の連番。VisitRecord version とは別 | additive。ただし backfill/unique policy 要確認 |
| `content_schema_version`             | `Int @default(1)` | PDF/renderer 後方互換と content guard              | additive                                       |
| `finalized_at`                       | `DateTime?`       | 薬剤師による確定時刻（server trusted timestamp）   | additive                                       |
| `finalized_by`                       | `String?`         | 確定した user id                                   | additive                                       |
| `finalized_pharmacist_credential_id` | `String?`         | 確定時に検証した薬剤師資格の evidence pointer      | additive。FK 化は別承認                        |
| `finalized_role`                     | `String?`         | 確定時の role snapshot。role drift 対策            | additive                                       |
| `finalized_license_checked_at`       | `DateTime?`       | 薬剤師免許束縛を検証した時刻                       | additive                                       |
| `locked_at`                          | `DateTime?`       | content mutation を禁止する lock 時刻              | additive                                       |
| `locked_by`                          | `String?`         | lock 操作者。通常は `finalized_by` と同一          | additive                                       |
| `content_hash`                       | `String?`         | finalized content の改ざん検知用 hash              | additive                                       |
| `pdf_hash`                           | `String?`         | finalized PDF snapshot の改ざん検知用 hash         | additive                                       |
| `amended_from_id`                    | `String?`         | 訂正/追記元 CareReport id                          | additive self-reference                        |
| `amend_reason`                       | `String?`         | 訂正/追記理由                                      | additive                                       |
| `amended_by`                         | `String?`         | 訂正/追記を開始した user id                        | additive                                       |
| `amended_at`                         | `DateTime?`       | 訂正/追記時刻                                      | additive                                       |
| `superseded_by_id`                   | `String?`         | 旧版から新版への参照                               | additive self-reference                        |
| `voided_at`                          | `DateTime?`       | 取り消し/無効化時刻。原本削除ではない              | additive                                       |
| `voided_by`                          | `String?`         | 取り消し操作 user id                               | additive                                       |
| `void_reason`                        | `String?`         | 取り消し理由                                       | additive                                       |

`PharmacistCredential` は `prisma/schema/organization.prisma:271-285` に存在するが、
現状は `id` primary key と `org_id` index であり、`(id, org_id)` の composite
unique key は無い。したがって `finalized_pharmacist_credential_id` を
schema-level に same-org FK 化するなら、先に `@@unique([id, org_id])` などの
credential 側 hardening が必要になる。B6a の第一段階では app-layer の
same-org validation と AuditLog evidence で始め、composite FK は別 migration
proposal に分けることを推奨する。

`report_revision` は法的正本の訂正/追記 chain を表す連番であり、行レベルの
楽観ロックには使わない。CareReport は現行 PATCH route
`src/app/api/care-reports/[id]/route.ts:359-364` と
`report-generator.ts:598,629` で `updated_at` / `expected_updated_at` を stale
guard として使っているため、D-14 の一般形（`version` + 409）からはこの table
に限って意図的に逸脱し、既存 API 規約との互換を優先する。

### 5.2 B6c retention columns

| Column                        | Type案                                                    | 用途                          | 注意                                 |
| ----------------------------- | --------------------------------------------------------- | ----------------------------- | ------------------------------------ |
| `retention_basis`             | enum/string (`last_entry`, `case_closed`, `contract_end`) | 保存年限の起算点種別          | exact rule は未決                    |
| `retention_basis_at`          | `DateTime?`                                               | 起算点となる実日時            | JST date builder 再利用が必要        |
| `retention_jurisdiction`      | `String?`                                                 | 自治体/管轄 rule              | canonical code 要検討                |
| `retention_rule_id`           | `String?`                                                 | rule registry 参照            | rule registry 設計は B6c             |
| `retention_until`             | `DateTime?`                                               | Object Lock retain-until 入力 | 法定年限 ratification 前に固定しない |
| `retention_locked_object_key` | `String?`                                                 | WORM snapshot object          | file-storage 側実装が別途必要        |

### 5.3 B6b delivery proof columns（DeliveryRecord 側）

CareReport に delivery proof を直接詰めず、`DeliveryRecord` または後続の
proof table に置く方針を推奨する。

| Column                | Type案                                                                                                              | 用途                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `delivery_proof_type` | enum/string (`system_send_log`, `recipient_ack`, `conference_attendance`, `fax_confirmation`, `manual_attestation`) | hard gate に使う証跡種別                      |
| `proof_status`        | enum/string (`pending`, `accepted`, `rejected`)                                                                     | 算定 gate で見る状態                          |
| `proof_captured_at`   | `DateTime?`                                                                                                         | 証跡取得日時                                  |
| `proof_captured_by`   | `String?`                                                                                                           | 手入力/確認者                                 |
| `proof_artifact_key`  | `String?`                                                                                                           | FAX 送信票/受領確認等の object key            |
| `proof_metadata`      | `Json?`                                                                                                             | channel 固有の最小 metadata。PHI 過多にしない |

### 5.4 B6d monthly count connection

B6d は別 service で `payer`, billing month, facility/building/unit,
exception rule に基づく count を算出する。B6a 側は以下の接続だけ予約する。

- finalized report の `source_provenance` / `billing_context` に、
  monthly count の `calculation_id`, `payer`, `billing_month`,
  `building_tier`, `building_patient_count`, `rule_revision` を snapshot
  として含める。
- count の再計算で finalized content を直接書き換えない。
  差分が請求根拠に影響する場合は amendment/revision chain または
  claim-record correction として扱う。

## 6. 状態遷移案

### 6.1 Report lifecycle

```text
draft
  ├─ finalize(valid coverage + pharmacist license + updated_at optimistic lock)
  ▼
finalized/locked
  ├─ send(delivery request)
  ▼
sent / response_waiting
  ├─ proof accepted(B6b)
  ▼
delivery_proven

finalized/locked
  ├─ amend(reason + permission)
  ▼
draft amendment(report_revision n+1, amended_from_id = old id)
  ├─ finalize
  ▼
finalized/locked(report_revision n+1), old revision remains immutable/superseded

finalized/locked
  ├─ unlock(break-glass permission + reason)
  ▼
unlocked metadata state; original content and audit trail remain reviewable

finalized/locked
  ├─ void(void permission + reason)
  ▼
voided metadata state; original content remains immutable/auditable
```

### 6.2 Compatibility with current `ReportStatus`

- 初期移行では `ReportStatus` enum の即時追加を必須にしない。
- `status === 'draft'` かつ `finalized_at == null` のみ content refresh 可。
- `status === 'confirmed'` は既存互換として保持するが、法的 finalize の正本は
  `finalized_at != null && locked_at != null` と定義する。
- 新 status (`finalized`, `superseded`, `voided`) を追加する場合は enum
  migration となるため、human approval と route serializer 互換確認が必要。
- 現行 PATCH route は `confirmed` を薬剤師確認、`sent/failed/response_waiting`
  を送信 API 責務として分離している。この互換を尊重し、`confirmed` の意味を
  法的 finalize に上書きしない。

### 6.3 Clinical content lock vs delivery metadata

finalize/lock は clinical report content を不変にするための境界であり、
送付処理や到達証跡の server-managed metadata を全面禁止する境界ではない。
次のどちらかを ratification 前に決める必要がある。

1. Delivery metadata を `DeliveryRecord` / proof table へ移し、`CareReport.content`
   は finalized 後完全 immutable にする。
2. `CareReport.content` 内に server-managed delivery keys の allowlist を定義し、
   clinical keys は immutable、delivery keys は送信 API だけが更新できるようにする。

推奨は 1。B6b の delivery proof hard gate とも分離しやすく、content hash の意味が
「臨床本文の hash」として明確になるため。

未決事項: `content_hash` / `pdf_hash` の計算時点は、
`src/app/api/care-reports/[id]/send/route.ts:1540-1585` の
`finalizeReportDelivery` が送付後に `mergeReportDeliveryTargets` で
`CareReport.content` を更新する順序と衝突しないように決める必要がある。
hash を送信前 content で固定するなら delivery target は `DeliveryRecord` 側へ移す。
送信後 content も hash 対象に含めるなら finalize と send の境界を再定義する。

## 7. report-generator への組み込み方針

`src/server/services/report-generator.ts:647-670` の draft 再生成判定は、
finalize/lock 導入後に次の rule へ変更する。

1. `finalized_at != null` または `locked_at != null` の既存 report は、
   通常の regenerate/refresh 対象から除外する。
2. 同一 `report_type` の finalized report がある状態で生成要求が来た場合、
   暗黙上書きはしない。以下のいずれかを明示要求する。
   - amendment draft 作成（`amend_reason` 必須）
   - 既存 finalized report の再送
   - human-approved unlock flow
3. draft refresh は現行通り `expectedReportUpdatedAt` を要求する。
4. finalized/amendment flow でも行レベル競合検知は `expected_updated_at`
   / `updated_at` を維持する。`report_revision` は競合検知ではなく、訂正/追記
   chain の連番としてのみ使う。
5. `source_provenance` と `billing_context` は finalized snapshot に固定し、
   VisitRecord / BillingEvidence / monthly count の後続変更で旧 content を
   直接 mutation しない。

この方針により、既存 draft の stale guard を維持しつつ、RPT-007 の
改ざん防止と訂正履歴保持を追加できる。

## 8. care_report_followup task との整合

現行 `care_report_followup` task は訪問記録保存時に
「訪問後報告の送付確認が必要」として作られる。finalize/lock 導入後は、
この task の完了条件を draft 生成ではなく次の段階に接続することを推奨する。

| 段階               | task との関係                                                            |
| ------------------ | ------------------------------------------------------------------------ |
| draft generated    | task は残す。下書き存在は follow-up 完了ではない                         |
| finalized/locked   | task metadata に finalized report id/revision を記録                     |
| sent               | 送信確認済みとして status を進めるが、B6b hard gate ではまだ不足の可能性 |
| proof accepted     | KYO-007/008 に必要な proof が揃ったら task close 候補                    |
| amendment required | 新版 draft task を作るか、既存 task を reopen する                       |

現行 task は `relatedEntityType='visit_record'`、`relatedEntityId=record.id` で
訪問記録に紐づき、`metadata` は `patient_id` / `case_id` のみを持つ
（`src/app/api/visit-records/route.ts:1704-1719`）。将来拡張では
`visit_record_id` を metadata に重複させるのではなく、必要に応じて
`required_report_types`, `finalized_report_ids`, `delivery_proof_state`,
`retention_state` を追加する。

## 9. 到達証跡 hard gate（B6b）設計境界

B6a は finalized report を生成するが、算定可否の最終 gate は B6b の
delivery proof に依存する。以下を推奨するが、証跡の十分性は未決事項とする。

- `system_send_log`: PH-OS share / SES などシステム送信成功ログ。
  単独で hard gate に足るかは channel ごとに ratification が必要。
- `recipient_ack`: 受領者の明示 ack。最も強いが運用負荷が高い。
- `conference_attendance`: サービス担当者会議等の出席記録。介護の
  ケアマネ提供で使う可能性がある。
- `fax_confirmation`: FAX 送信票または受領確認。paper/FAX 運用のため
  artifact 保存と PHI 最小化が必要。
- `manual_attestation`: 管理者または薬剤師の手動到達確認。
  abuse 防止のため reason、actor、timestamp、review policy が必要。

KYO-007/008 hard gate は BillingRequirementCatalog / coverage-checker と
連動し、「単なる送信試行」ではなく accepted proof の存在を見るべきである。

## 10. 保存年限 / Object Lock（B6c）設計境界

B6a finalize 時に immutable snapshot を作るだけでは、RPT-002/009 の保存性は
完了しない。B6c で retention resolver と Object Lock lifecycle を実装する。

推奨する連携:

1. finalize 時に `retention_basis`, `retention_jurisdiction`,
   `retention_rule_id`, `retention_until` を resolver から受け取る。
2. `content_hash` と `pdf_hash` を保存し、PDF object は report purpose の
   Object Lock を付ける。
3. 医療/介護/自治体/監査ログの retention conflict は resolver が
   deterministic に解決する。
4. 起算点イベント（最終記入、case close、契約終了）が変わる場合、
   finalized report を直接短縮せず、長い retention 方向のみ安全に延長する。

法定年限の最終解釈、自治体 override、既存安全側 5 年運用との関係は、
human/fable ratification 前に固定しない。

## 11. 単一建物月次動的計数（B6d）設計境界

ZTK-06 は B6d の別スコープである。B6a は次の設計境界だけを確保する。

- finalized report は静的 patient intake count だけを正本にしない。
- monthly count service の出力を `billing_context` / `source_provenance` /
  ClaimRecord へ渡せるようにする。
- count correction が finalized report 後に発生した場合は、旧版を直接
  mutation せず amendment または claim-record correction として扱う。
- GH unit、同一世帯、戸数 10% 以下、20 戸未満 2 人以下等の特例は
  B6d ratification item とし、B6a では確定しない。

## 12. Migration 案と非破壊性評価

### 12.1 推奨 migration sequence

1. **Design ratification**:
   本文書の Option B、状態遷移、未決事項を fable/human が承認する。
2. **Additive schema migration**:
   nullable finalize/lock/amend/retention columns と
   `report_revision @default(1)` を追加する。
3. **Backfill dry-run**:
   既存 CareReport を `report_revision=1`, `finalized_at=null` と扱い、serializer と
   existing tests が変わらないことを確認する。
4. **Dual-read / no behavior change**:
   API は既存 response shape を保ち、内部で new columns を読むだけにする。
5. **Finalize endpoint / mutation guard**:
   finalized report の content mutation を拒否し、draft refresh は従来通り維持する。
6. **Amendment flow**:
   finalized report の訂正/追記は new revision draft を作る。
7. **B6b/c/d integration**:
   delivery proof、retention resolver、monthly count service を順に接続する。
8. **RLS / audit trigger impact review**:
   migration proposal では CareReport の RLS 継承と、監査トリガを DB 層で持つか
   app 層 AuditLog で持つかへの影響検証を必須にする。

### 12.2 非破壊と見なせる部分

- nullable columns の追加。
- `report_revision @default(1)` の追加。ただし大規模 table rewrite の有無は
  migration plan で確認する。
- API response に新 field を露出しない内部 read。
- existing draft refresh behavior を維持したまま、finalized/locked のみ
  mutation guard を追加すること。

### 12.3 human approval が必要な部分

- Prisma migration の本番適用。
- `ReportStatus` enum の追加/意味変更。
- finalized report の content update 拒否を API contract として強制すること。
- pharmacist license verification source と permission policy。
- un-lock/void 権限。
- retention rule と Object Lock retain-until。
- delivery proof の accepted matrix。
- monthly count 特例 rule。

## 13. テスト計画

### B6a finalize/lock

- draft report を finalize すると `finalized_at`, `finalized_by`,
  `locked_at`, `content_hash`, `report_revision` が保存される。
- 薬剤師権限/免許検証が無い actor は finalize できない。
- finalized report の content PATCH は拒否される。
- finalized report から amendment draft を作ると `report_revision + 1`,
  `amended_from_id`, `amend_reason`, `amended_by`, `amended_at` が保存される。
- 旧版は immutable のまま残る。
- un-lock/void は限定 role + reason + AuditLog が無いと拒否される。
- report-generator は finalized report を draft refresh 対象にしない。

### B6b delivery proof

- channel/proof type matrix で accepted/rejected を判定する。
- KYO-007 physician proof が無い report は claimable hard gate を通らない。
- care payer で KYO-008 care-manager proof が無い月は claimable にならない。
- proof artifact metadata が raw recipient contact / PHI を過剰にログ出力しない。

### B6c retention

- medical / care / jurisdiction override の retention resolver cases。
- report purpose の Object Lock headers / retain-until。
- retention を短縮する変更は拒否し、延長は可能にする。
- expired lifecycle が retain-until 前に削除しない。

### B6d monthly count

- payer split、billing month、building/unit/GH unit、特例 rule の cases。
- dynamic count が ClaimRecord / source_provenance に反映される。
- finalized report 後の count correction が amendment/correction flow を通る。

## 14. 未決事項

- `CareReport` に留める Option B で十分か、最初から `CareReportRevision`
  table を採用するか。
- 改訂を新規 `CareReport` row として作る場合、既存の
  `CareReport_org_visit_record_report_type_unique_idx`
  （`org_id`, `visit_record_id`, `report_type` の partial unique）および
  partner visit 側 `CareReport_org_partner_visit_report_type_key` と衝突する。
  Option B で進めるなら unique key に revision 軸を足すのか、同一 row 上の
  amendment metadata に留めるのかを migration proposal で決める。Option C は
  revision table 分離によりこの衝突を構造的に避けられる。
- CareReport の行レベル楽観ロックは D-14 の一般形から逸脱して
  `updated_at` / `expected_updated_at` を維持する方針でよいか。この逸脱は
  既存 PATCH / report-generator contract 互換のためだが、API versioning policy
  側に例外として記録するかは未決。
- `ReportStatus.confirmed` を互換 status として残すか、新 `finalized`
  enum を追加するか。
- 薬剤師免許の authoritative source と、実訪問薬剤師への束縛方法。
- partner visit record や代理薬剤師の場合の finalizer 判定。
- 訂正/追記は常に new revision とするか、addendum section を同一 legal record
  に追記できるか。
- un-lock/void の許可 role、reason code、二者承認要否。
- delivery proof type ごとの accepted 条件。
- retention rule の優先順位（医療/介護/自治体/監査ログ/既存 5 年運用）。
- finalized PDF Object Lock を B6c 完了まで一律 5 年にするか、per-report
  retain-until を待つか。
- single-building dynamic count correction が finalized report と claim-record
  に与える影響。
- report-send / status-change / finalize audit を誰が閲覧できるか。

## 15. 推奨 review / implementation order

1. fable/Claude が本文書を ratify し、Option B 採否と未決事項 owner を決める。
2. B6a schema migration proposal を別 PR で出す。
3. finalize endpoint / mutation guard / report-generator finalized exclusion を
   code-only slice として実装する。
4. amendment/revision chain を別 slice にする。
5. B6b delivery proof hard gate を BillingRequirementCatalog / coverage-checker
   と接続する。
6. B6c retention resolver / Object Lock lifecycle を実装する。
7. B6d monthly single-building count service を claim-record projector と接続する。

W3-B4 / W3-B6 / W3-M1 は `report-generator` と source provenance 境界で競合するため、
実装順は引き続き fable/Claude の直列調整に従う。
