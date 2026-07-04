# BACKLOG — 統合 findings 台帳（唯一の候補管理ファイル）

> **運用ルール（2026-07-03 台帳再編）**: findings/実装候補はこのファイルだけで管理する。
> 旧カテゴリ別台帳（BUG/INCONSISTENCY/FE_BE/UI/DEAD_CODE/PERF/REFACTOR_PLAN/P0_PROPOSAL）は
> `archive/` に凍結、新規追記禁止。新規項目には **status を必ず付ける**:
> `open` / `in-progress(担当)` / `done(commit)` / `flagged(理由)` / `P0(→.agent-loop/BLOCKED.md)`。
> P0 の human-gate 正本は `.agent-loop/BLOCKED.md`（ここには参照のみ）。
> 実施記録・検証結果は `LOG.md`（1スライス1エントリ）へ。現在地は `STATE.md`。

**担当**: A3（未消化バックログ抽出）を核に A1(FE/BE)・A2(perf)・VG1 裁定を統合
**性質**: read-only 調査台帳。ソースコードは編集していない。実装は別スライスでユーザー GO 後。
**方法**: 下記ソースの各 ID を、`git log --oneline -80` / `REFACTOR_LOG.md` / 現在の src grep と
突合し、file:line で現存を確認したものだけを残した。消化済み・stale・P0 は除外/隔離した。

ソース:

- `ULTRACODE_FINDINGS_20260702.md`（F01-F89 原本）
- `ULTRACODE_EXPANSION_ROUND1_CLAUDE.md`（CE01-19）
- `ULTRACODE_EXPANSION_ROUND2_CLAUDE.md`（N01-33）
- `ULTRACODE_EXPANSION_MASTER_TARGETS.md`（EPIC統合・X01-13 CXR cross-review 参照）
- `ULTRACODE_REFACTOR_CANDIDATES_20260702.md`（R01-56 純粋リファクタ候補）
- `BUG_FINDINGS.md` / `INCONSISTENCY_FINDINGS.md` / `DEAD_CODE_FINDINGS.md`

## 消化状況サマリ

- `BUG_FINDINGS.md` / `INCONSISTENCY_FINDINGS.md` / `DEAD_CODE_FINDINGS.md`: **全件消化済み**。
  「Flagged / Not Yet Fixed」節は空（"No additional unresolved... is confirmed"）。新規記載なし。
- `ULTRACODE_EXPANSION_MASTER_TARGETS.md` の EPIC4（並行性）は W2-Q1a/b/c
  （commit `3c47febc` / `a00758ac` / `b5819a94`）で CE05/F83, CE06, X06, X09, X10,
  CXR1-CONC01/02 が消化済み。EPIC5（TZ）・EPIC6（false-empty/offline）は
  W2-Q2（`295379ee`）+ 個別スライス群でほぼ全消化（下記で個別確認）。EPIC7（no-store）は
  W1-9/10/11（`e58e3aae`）でほぼ消化。EPIC3 は F80/F88 消化、F87 は設計判断で non-issue 降格
  （org-wide 設計、[[careviax-access-model-orgwide]]）。**X01/CXR2-SEC01（GET
  /api/external-access が canReport で全org grant列挙）は未消化のまま残存**（P0/flag、下記）。
- `ULTRACODE_REFACTOR_CANDIDATES_20260702.md`（R01-56）: R01（DataTable CSV export の
  quotedCsvRow採用）は消化済み。R29（drug-master-content.tsx 分割）は**現在作業ツリーで
  進行中**（`drug-master-detail-sheet.tsx` 新規・本体 4056→3474 行、未コミット）— 重複実装を
  避けるため本バックログには載せない。残り R02-R56 のうち抜き取り検証した R03/R07/R22 は
  現存確認。他は原本の file:line 根拠を維持しつつ本バックログに統合（個別 grep 未実施分は
  「要再確認」と明記）。

---

## セクション A — P0 / flag（記録のみ・実装提案しない）

3省2ガイドライン/RLS/認可/PHI意味変更に該当。人間承認が必要。**現存確認のみ、着手しない。**

### A-1. RLS 欠落・SSOT drift（EPIC1、全件現存確認は前回ラウンドのまま・stale化なし）

- `F79` FormularyChangeRequest + FormularyTemplate（=N11）— RLS皆無
- `N01` PatientPackagingProfile（患者PHI）— RLS皆無 ★最重要
- `N02`/`N13`/`N15` Facility, FacilityContact, ExternalProfessional — SSOT drift
- `N03` JahisSupplementalRecord（処方PHI）— SSOT drift
- `N04`/`N09` PharmacyCooperationMessage(+Thread) — SSOT drift
- `N05` SavedView — SSOT drift
- `N06` VisitScheduleOverride — RLS皆無
- `N07` VisitScheduleContactLog — RLS皆無
- `N08` PatientCondition（医療PHI）— SSOT drift
- `N12` FacilityUnit — RLS皆無
- `N14` BillingRule — RLS皆無
- `N17` PharmacySiteInsuranceConfig — RLS皆無
- `N28` PackagingMethodMaster — RLS皆無
- `N29` BusinessHoliday — RLS皆無
- `N31` UatFeedback — SSOT drift
- `N33` NotificationRule — RLS皆無
- `CXR2-RLS01` PrescriberInstitution — design判定待ち（global master疑い）
- `CXR2-RLS02` User — design判定待ち（auth/global identity疑い）
- 根本原因: `prisma/rls-policies.sql` SSOT と migration/failsafe を突合する契約テストが無い
  （既存 `src/tools/rls-policy-contract.test.ts` はハードコード allowlist）。個別修正の前に
  RLS contract 再設計スライスが必要（master targets 既存推奨のまま）。

### A-2. 認可（EPIC3、未消化1件のみ確認）

- **`X01`/`CXR2-SEC01`**: `src/app/api/external-access/route.ts:412` GET ハンドラが
  `permission: 'canReport'` のまま。同ファイル POST（グラント発行）は line 664 で
  `canManagePatientSharing` に修正済み（F80 消化根拠のコメントあり、line 660-663）が、
  **GET（全org grant列挙）は未修正のまま**。pharmacist_trainee でも全org分の外部共有grant
  一覧を閲覧できる状態が現存。

### A-3. CDS 医療安全 false-negative（EPIC2、flag class — 個別現存未再検証、原本のまま記録のみ）

一致ロジック変更は誤判定リスクが高く、本ロールでは再確認のみで実装提案しない。

- `F81` checkInteractions/checkDuplicates が drug_master_id=null の現行薬を無言スキップ
- `X02` CDS allergy cross-check が drug_code=null の処方行を無言スキップ
- `X03` 完全未解決の処方行が全 CDS check から脱落
- `F82` PatientCondition(problem-list) が CDS 禁忌チェック未使用
- `X04` checkRenalDoseAdjustment が eGFR 未記録時に silent-clean
- `X05` 添付文書 alert が unsorted で slice(0,3) 切り捨て
- `CXR1-MSR01` legacy string/object allergy_info を無視
- `CXR1-MSR02` 手動 MedicationProfile の master_id/drug_name 不整合

---

### A-4. BLOCKED.md 連携

- `X01` は `.agent-loop/BLOCKED.md` にも登録（human 承認待ち）。W1-10 で POST を
  canManagePatientSharing 化した際の GET 取り残しの可能性が高く、承認されれば同一 ratified
  パターン適用で済む見込み。status: **done(e02cec50)** — 2026-07-03 ユーザー承認→claude opus lane 実装・opus APPROVE・land 済み(GET を canManagePatientSharing 化、role-matrix 62/62 green)

---

## セクション B — 未消化・非P0・実装候補（confirmed via file:line, 2026-07-03 grep）

### B-0. Phase A (2026-07-03) 追加分

| ID        | 分類           | 内容                                                                                                                                                                                                                                                                                                                                                          | Evidence                                              | 安全 | 効果 | 検証容易性 | 挙動変更 | status                          |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---- | ---- | ---------- | -------- | ------------------------------- |
| `A1-GEO`  | fe-be/flag     | GET /api/visit-records/[id] は da9c2c28 hardening 以降 visit_geo_log を response から除去（test-locked）だが FE visit-record-detail.tsx は型に保持し「訪問位置情報」カードを描画（現在恒久 dead）。**fable 裁定: 削除せず flagged** — spec に将来 geo evidence 意図あり（W3-O6 関連、codex VG1 撤回根拠と同一）。復活は sanitized field の契約設計(C/E)が前提 | visit-records/[id]/route.ts + visit-record-detail.tsx | -    | -    | -          | -        | flagged(W3-O6 設計待ち)         |
| `A1-CRC`  | fe-be (B)      | care-reports/[id] の `content` は can_edit\|\|can_send 時のみ response 含有だが FE は non-optional 型で無条件参照。crash は無いが view-only ロールで silent empty 表示                                                                                                                                                                                        | care-reports/[id]/route.ts + reports/[id]/page.tsx    | 4    | 2    | 3          | いいえ   | done(eebda8c3)                  |
| `PERF-01` | perf O(n²)     | CSV バルク在庫インポートの preview 行→operation 照合が nested .find() で O(N²)。rowNumber キー Map 化で O(N)、出力形状不変                                                                                                                                                                                                                                    | pharmacy-drug-stocks/bulk/route.ts:541-551            | 5    | 4    | 5          | いいえ   | done(981f1a58)                  |
| `PERF-02` | perf N+1 write | dispense-results 提出の行ごと tx 書き込み（同一 tx 上 Promise.all=実質逐次 round-trip）。ユニーク制約競合 fallback を壊さない再構成が必要                                                                                                                                                                                                                     | dispense-results/route.ts:678-760                     | 3    | 3    | 3          | いいえ   | done(60469cd1)                  |
| `PERF-03` | perf N+1 write | pharmacy-drug-stocks copy の在庫件数分逐次 upsert（行ごと値が異なり単純バルク化困難・低優先）                                                                                                                                                                                                                                                                 | pharmacy-drug-stocks/copy/route.ts:133-161            | 4    | 2    | 3          | いいえ   | flagged(raw SQL 要設計・低優先) |

| ID         | 分類               | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                     | 安全 | 効果 | 検証容易性 | 挙動変更 | status                    |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---------- | -------- | ------------------------- |
| `F84`      | bug/concurrency    | ConsentRecord 作成が `findFirst`（active重複チェック）→`create` の check-then-act。partial unique index 無しで並行作成すると同一 `patient_id+consent_type` の有効同意記録が重複しうる。W2-Q1b/c と同じ advisory-lock パターンで app層防御が可能（DB制約追加は別途migration提案）。                                                                                                                                                      | `src/app/api/consent-records/route.ts:300-312`（重複チェック）, `:345-364`（create）                                                         | 4    | 3    | 4          | いいえ   | done(c22c7fe3)            |
| `DR-DUP1`  | bug/data-integrity | `POST /api/dispense-results` が通常書込 path で同一 payload 内の重複 `lines[].line_id` を拒否せず、同じ `DispenseResult` を create/P2002 fallback update または複数 update しうる。正規 FE は単一 workbench chain で line id 一意の `count_rows.map(line.id)` から payload を作るため、防御的 validation 強化として隔離修正。                                                                                                           | `src/app/api/dispense-results/route.ts:86`, `:522`, `:678-760`; `prisma/schema/prescription.prisma:316`                                      | 4    | 4    | 4          | はい     | done(2e0c7fdb)            |
| `CE19`     | bug/fe-be          | `MentionInput` が `handleChange`（テキスト編集）で `mentions` 配列からの削除パスが無く、`insertMention` の追加のみ。@mention 文字列を削除・編集しても mention id が残留し、無関係スタッフに通知され続ける。                                                                                                                                                                                                                             | `src/components/features/comments/mention-input.tsx:56-128`（`insertMention`のみ追加、`handleChange`に除去ロジック無し）                     | 4    | 3    | 5          | はい     | done(2136c93a)            |
| `CE17`     | perf               | 夜間 `checkPrescriptionExpiry` ジョブが `prescription_expiry_date: { lte: tomorrow }` のみで下限日無し。処方取込履歴テーブル全件を毎晩無制限スキャン（dedupe_keyで再通知は防止済みだが、クエリ自体は年数分蓄積するテーブルを無条件全件走査し続ける）。                                                                                                                                                                                  | `src/server/jobs/daily/prescriptions.ts:235-247`                                                                                             | 5    | 3    | 4          | いいえ   | done(5205fc48)            |
| `CE20`     | bug/TZ             | 処方箋期限通知 message が `formatDateKey(prescription_expiry_date)` を使い、プロセスローカルTZに依存する。JST 期限日として表示すべき値が非東京TZ実行で前後日にずれる可能性がある。今回 CE17 では scan 窓のみ修正し、表示日付は別スライスで扱う。                                                                                                                                                                                        | `src/server/jobs/daily/prescriptions.ts:268`                                                                                                 | 4    | 2    | 4          | いいえ   | done(66d65f99)            |
| `ID-1a`    | design/spike       | display_id 採番基盤の E1/E2 判定スパイク。Prisma 7.8 query extension の `create/createMany` hook から IdSequence 相当 upsert を親 create と同一 interactive tx 接続で実行できるかを、既存 schema + 実DB disposable table で判定する。                                                                                                                                                                                                   | `docs/design/display-id-design.md:293-304`, `src/lib/db/display-id-spike.test.ts`                                                            | 5    | 5    | 5          | いいえ   | done(9ac76b13)            |
| `ID-1b`    | infra/db           | ID-1a で採用した E2 の採番基盤。`IdSequence` 内部カウンタ表、138件 prefix registry、`allocateDisplayId(tx, model, orgId)` / range / global sentinel、RLS intentional exclusion、direct access grep gate、local e2e DB concurrent/rollback テストを追加する。                                                                                                                                                                            | `docs/design/display-id-design.md:238-407`, `src/lib/db/display-id.ts`                                                                       | 5    | 5    | 5          | いいえ   | done(0a3b910c)            |
| `ID-2-W1`  | infra/db           | display_id 第1波。`patient.prisma` の18 org-scoped model に nullable `display_id` と tenant-local unique 宣言を追加し、DB migration は partial unique index + generic backfill script で既存 row を org別 `created_at,id` 順に E2 allocator range 採番する。                                                                                                                                                                            | `prisma/schema/patient.prisma`, `tools/scripts/backfill-display-ids.ts`, `src/lib/db/display-id.test.ts`                                     | 5    | 5    | 5          | いいえ   | done(898c0d6a)            |
| `ID-2-W2`  | infra/db           | display_id 第2波。`prescription.prisma` の18 org-scoped model に nullable `display_id` と tenant-local unique 宣言を追加し、W1 と同じ partial unique migration + generic backfill script で既存 row を org別 `created_at,id` 順に E2 allocator range 採番する。                                                                                                                                                                         | `prisma/schema/prescription.prisma`, `tools/scripts/backfill-display-ids.ts`, `src/lib/db/display-id.test.ts`                                | 5    | 5    | 5          | いいえ   | done(90a1276e)            |
| `ID-2-W3`  | infra/db           | display_id 第3波。`visit.prisma` の10 model + `communication.prisma` の14 direct org-scoped model に nullable `display_id` と tenant-local unique 宣言を追加し、W1/W2 と同じ partial unique migration + generic backfill script で既存 row を org別 `created_at,id` 順に E2 allocator range 採番する。`HandoffItem` は orgViaParent のため W7 残余。                                                                                    | `prisma/schema/visit.prisma`, `prisma/schema/communication.prisma`, `tools/scripts/backfill-display-ids.ts`, `src/lib/db/display-id.test.ts` | 5    | 5    | 5          | いいえ   | done(8c7e34e7)            |
| `ID-2-W4`  | infra/db           | display_id 第4波。`organization.prisma` の direct org-scoped model 15件（`Organization` と `User` は対象外）に nullable `display_id` と tenant-local unique 宣言を追加し、W1-W3 と同じ partial unique migration + generic backfill script で既存 row を org別 `created_at,id` 順に E2 allocator range 採番する。                                                                                                                        | `prisma/schema/organization.prisma`, `tools/scripts/backfill-display-ids.ts`, `src/lib/db/display-id.test.ts`                                | 5    | 5    | 5          | いいえ   | done(7e18fcb2)            |
| `ID-2-W5`  | infra/db           | display_id 第5波。`pharmacy-partnership.prisma` の direct org-scoped model 18件に nullable `display_id` と tenant-local unique 宣言を追加し、W1-W4 と同じ partial unique migration + generic backfill script で既存 row を org別 `created_at,id` 順に E2 allocator range 採番する。cross-org共有系も row の `org_id` で自org採番し、外部/相手org向け表示番号にはしない。                                                                | `prisma/schema/pharmacy-partnership.prisma`, `tools/scripts/backfill-display-ids.ts`, `src/lib/db/display-id.test.ts`                        | 5    | 5    | 5          | いいえ   | done(86d9d273)            |
| `ID-2-UR`  | infra/db           | display_id 波 残余/追跡。M-1(User 分類矛盾)は W6(d2bcde00) で解消: registry scope='global' 是正、staff 表示は Membership.display_id。L-1 completeness gate も W6 で実装済み(wave 所属 or 明示 DEFERRED)。残余: `DrugAlertRule`/`IntegrationJob` は nullable org_id のため**恒久 defer**(専用設計 = partial unique 2本 or COALESCE index が必要になったら別スライス)。`HandoffItem`(orgViaParent) は W7 で処理中。                       | `src/lib/db/display-id-registry.ts`, `src/lib/db/display-id.test.ts`, `docs/design/display-id-design.md`                                     | 4    | 3    | 4          | いいえ   | 部分done(d2bcde00)/残余W7 |
| `ID-2-OPS` | infra/ops          | display_id 本番展開の運用ノート(opus W6 Medium)。本番 RDS への migration 適用時、高書込テーブル(AuditLog/Notification/BillingEvidence/WebhookDelivery 等)への CREATE UNIQUE INDEX は Prisma のトランザクショナル migration 内では CONCURRENTLY 不可 → (a) 該当 index を別ステップの `CREATE UNIQUE INDEX CONCURRENTLY` に分離、または (b) メンテナンス窓で適用。本番 deploy は hard-stop 対象なので実施時に human 承認+この手順を適用。 | `prisma/migrations/20260703160000_add_admin_drug_display_ids/`, 全波 migration                                                               | -    | -    | -          | -        | open(運用手順)            |
| `N18`      | perf               | 印刷ハブ（`print-hub-content.tsx`）が `GET /api/set-plans`（`patient_id`等の絞り込み無し）で組織の SetPlan 全件を取得し、`pickPrintSetPlan()` で1件だけ選ぶために使う。組織のセットプラン数に比例して不要なペイロード肥大。（codex/codex2 の重複指摘で stale 確認: 実装済み）                                                                                                                                                           | `src/app/(dashboard)/reports/print/print-hub-content.tsx:123-135`                                                                            | 5    | 3    | 4          | いいえ   | done(ad0ff309)            |

---

## セクション C — 純粋リファクタ候補（`ULTRACODE_REFACTOR_CANDIDATES_20260702.md` R01-56 由来）

**方法**: 原本の score（[]内、effort込みの相対優先度）をそのまま引き継ぐ。R01（DataTable CSV
export）は `src/components/ui/data-table.tsx:46,355` で `quotedCsvRow`/safe-csv 採用済みと
確認、消化済みにつき除外。R29（drug-master-content.tsx 分割）は現在進行中の未コミット作業
（`drug-master-detail-sheet.tsx` 新規, 本体 4056→3474 行）と重複するため除外。
R03/R07/R22 は個別 grep で現存を再確認済み（下表に✓）。それ以外は原本 file:line 根拠のみで
本ラウンドでは再 grep していない（「要再確認」）。効果上位40件のうち今回除外分を差し引いた
残りをそのまま列挙する。

| ID  | score | 分類                      | 内容（原本要約）                                                                                                                                                                                                                                                                                                                              | 現存確認                         |
| --- | ----- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| R02 | 21    | dup-helper (M)            | `parseJsonBodyOrError(req, schema)` 抽出 — read-body+null-check+safeParse+validationError が約214箇所重複                                                                                                                                                                                                                                     | 要再確認                         |
| R03 | 21    | dead-code (S)             | `src/lib/api/route-builder.ts` + deprecated `auth/middleware.ts` チェーン削除（本番0参照、約280行）。live file absence と git history で既消化を確認。                                                                                                                                                                                        | done(3b31cec1)                   |
| R04 | 21    | oversized-split (M)       | `card-workspace.tsx`: 自己完結の6 QuickFormコンポーネント(~1690行)が4747行ファイルに inline                                                                                                                                                                                                                                                   | 要再確認                         |
| R05 | 21    | dup-helper (S)            | MHLW open-data importer の local CSV helper(`stripBom`/`csvRows`/`readCsvCell`)を `drug-master-import/shared` の delimited row helper へ収束。                                                                                                                                                                                                | done(f2fe83df)                   |
| R06 | 21    | type-drift (S)            | `CdsAlert` が server/cds/checker.ts と components/features/cds/alert-panel.tsx でbyte-identical重複。現行コードは `src/lib/cds/alert-contract.ts` へ共有型化済み。                                                                                                                                                                            | done(a59d9d4a)                   |
| R07 | 21    | dead-code (S)             | `src/lib/dashboard/home-config.ts`: 11 export全て参照0（358行）                                                                                                                                                                                                                                                                               | done(f3733036)                   |
| R08 | 21    | dead-code (M)             | 参照0のlib/serverモジュール一掃: 5モジュール+5テスト、922行削除（health-check/care-trend/workflow-order/recent-operations/user-settings。network-status.tsxはF26既済につき除外、R03分は3b31cec1で先行消化済み）。opus Low: design-gap-analysis 等に recent-operations の stale 記述残（元々未配線・退行なし、doc掃除follow-up）               | done(cee20c66)                   |
| R09 | 20    | dup-component (S)         | cockpit rail guard block(31行)がhandoff/schedule/report-share 3ワークスペースにコピペ                                                                                                                                                                                                                                                         | done(63b98972)                   |
| R10 | 20    | dup-helper (M)            | blocked_reasons→BlockedReason[] rail mapping を `buildDailyOpsBlockedReasons` へ収束し、buildWorkspaceNextAction準コピー2箇所も `buildDailyOpsNextAction` fallback wrapperへ収束。                                                                                                                                                            | done(3d23dc1b)                   |
| R11 | 20    | dup-route-boilerplate (L) | `withAuthContext`未採用の手動routeファイル約174件（35件はwithOrgContextでrequest context欠落）                                                                                                                                                                                                                                                | 要再確認                         |
| R12 | 20    | oversized-split (M)       | `pharmacy-cooperation-workflow-content.tsx`: props-onlyパネル8個(~1490行)が3585行ファイルにinline                                                                                                                                                                                                                                             | 要再確認                         |
| R13 | 20    | oversized-split (M)       | `billing-evidence/core.ts`(2297行): candidate-workbench trio(1964-2297行)を別submoduleへ                                                                                                                                                                                                                                                      | 要再確認                         |
| R14 | 20    | oversized-split (M)       | `cds/checker.ts`: 独立12 check\*関数+clinical-JSONパーサが単一ファサード内                                                                                                                                                                                                                                                                    | 要再確認                         |
| R15 | 20    | pattern-inconsistency (M) | `buildOrgHeaders`採用が中断: 74ファイルで217箇所が生の`'x-org-id':`リテラル                                                                                                                                                                                                                                                                   | 要再確認                         |
| R16 | 20    | dup-helper (M)            | JST日付導出がIntlフォーマッタで4回再実装、formatUtcDateKeyのverbatimクローンあり（canonicalはjapanDateKey）。service/lib 層は R16-MIN(da5889f0)+R16-SWEEP(6f26c04c) で収斂済み。残: API route 面(list-only: prescription-intakes, patients/[id]系, workbench route, visit-preparations)と planner localDateKey(1241-1245, opus Low, 実害なし) | done(6f26c04c)+残余              |
| R17 | 20    | type-drift (L)            | truncated-list envelope が23 APIルート+16 FEファイルで手組み・drift                                                                                                                                                                                                                                                                           | 要再確認                         |
| R18 | 20    | dup-helper (S)            | PrescriptionLine(14field)/InquiryRecord(10field)がprescriptions FEに複数コピー（prescription.shared.ts既存）                                                                                                                                                                                                                                  | 要再確認                         |
| R19 | 20    | type-drift (S)            | DiffReviewRow等のdiff-review契約がAPIルートと単一FE consumerで重複。現行コードは `src/lib/prescriptions/diff-review-contract.ts` をAPI/FE双方が参照済み。                                                                                                                                                                                     | done(current-state)              |
| R20 | 20    | test-harness-dup (S)      | `expectSensitiveNoStore`アサーションが156 APIルートテストファイルにコピペ(~620行)                                                                                                                                                                                                                                                             | 要再確認                         |
| R21 | 20    | test-harness-dup (S)      | sonner toastモックが71テストファイルで重複・メソッド surface drift。共有 helper 追加+3画面移行済み(68688360)。残: 他68ファイルの段階移行(機械的 follow-up)                                                                                                                                                                                    | done(68688360)+残余              |
| R22 | 20    | dead-code (M)             | Yjs協調編集フック/プロバイダチェーン+yjs/y-protocols/y-websocket/lib0依存が無consumer。R22-EXEC(app/route/deps/docs)は opus 計画審査+実装レビュー APPROVE で done(759b4dbc)。R22b repo cleanup は `tools/infra/websocket/` 一式と infra/cost/env/docs の stale 参照を削除。残る外部確認は AWS live-state inventory/teardown gate として分離。 | done(759b4dbc)+R22b repo cleanup |
| R23 | 20    | dup-helper (M)            | `messageFromError(e, fallback)`抽出候補 — 同型ternaryが174箇所/66ファイルに重複（141箇所はtoast.error内）                                                                                                                                                                                                                                     | 要再確認                         |
| R24 | 20    | pattern-inconsistency (M) | 約27箇所の手組みカーソルページネーションを既存`buildCursorPage`へ収束                                                                                                                                                                                                                                                                         | 要再確認                         |
| R25 | 20    | pattern-inconsistency (M) | ErrorState retry定型句(`action={{label:'再試行'...}}`)が106箇所で手組み                                                                                                                                                                                                                                                                       | 要再確認                         |
| R26 | 19    | dup-route-boilerplate (L) | external-viewer PanelBodyを共有guarded-queryパネルへ昇格                                                                                                                                                                                                                                                                                      | 要再確認                         |
| R27 | 19    | query-helper (M)          | `/api/dashboard/cockpit`フェッチャの手組みコピーが5箇所、queryKey形状が3種にdrift                                                                                                                                                                                                                                                             | 要再確認                         |
| R28 | 19    | query-helper (M)          | 95ルートファイルがsearchParams→safeParseを手組み（メッセージ文言107 vs 44でdrift）                                                                                                                                                                                                                                                            | 要再確認                         |
| R30 | 19    | dup-helper (S)            | `formatFileSize`がvisit-attachmentビュー2箇所でbyte-for-byte重複。現行コードは `src/lib/files/format-file-size.ts` とテストへ共有化済み。                                                                                                                                                                                                      | done(current-state)              |
| R31 | 19    | test-harness-dup (L)      | 364 APIルートテストがvi.hoisted auth/RLS/logger/performanceモック定型文(~90行/ファイル)を個別実装                                                                                                                                                                                                                                             | 要再確認                         |
| R32 | 19    | test-harness-dup (S)      | QueryClientテストwrapper重複を `src/test/query-client-test-utils.tsx` の `createQueryClientWrapper` / `createTestQueryClient` へ収束。`src/app` / `src/components` の test files で direct `new QueryClient` / `QueryClientProvider` / local `createWrapper` / `createQueryClient` は scan 0件。                                              | done(bcf516b7)                   |
| R33 | 19    | dup-helper (M)            | billing-evidenceの private Japan month-range/JST-offsetヘルパーをdate-boundary SSOTへ統合。`core.ts` の private JST offset/月part計算を `date-boundary` の `japanDateKey` / `japanMonthInstantRange` / `utcMonthDateRange` へ収束し、UTC runtime の JST 月初境界テストを追加。                                                                 | done(4561a33d)                   |
| R34 | 19    | dup-helper (M)            | `getErrorMessage(error, fallback?)`抽出候補 — 同型ternaryが192箇所/76ファイルで重複、divergent local helper 2種既存                                                                                                                                                                                                                           | 要再確認                         |
| R35 | 19    | type-drift (S)            | ErrorState/EmptyStateがheading-switch/href-onClickレンダラを内部で重複実装。`src/components/ui/state-elements.tsx` に `StateHeading` / `StateActionButton` を抽出し、ErrorState/EmptyState の既存 props とDOM contractを維持したまま共有化。                                                                                               | done(80a77b03)                   |
| R36 | 18    | query-helper (M)          | pagination.ts/validation.ts/search-params.tsの3系統bounded-integerヘルパーを1系統へ収束                                                                                                                                                                                                                                                       | 要再確認                         |
| R37 | 18    | oversized-split (L)       | `prescription-intake-form.tsx`: 単一2731行、6つのfieldsetシーム分割余地あり                                                                                                                                                                                                                                                                   | 要再確認                         |
| R38 | 18    | oversized-split (M)       | `visit-record-form.tsx`: 2040行、既存VisitRecordWorkflowSectionステップ境界あり                                                                                                                                                                                                                                                               | 要再確認                         |
| R39 | 18    | oversized-split (S)       | `prescription-intake-service.ts`: drug-identity解決(~175行)/medication-profile sync(~215行)が抽出可能                                                                                                                                                                                                                                         | 要再確認                         |
| R40 | 18    | query-helper (L)          | `res.json().catch(...)`+throw定型が86ファイル194箇所、canonical readApiJsonは14ファイルのみ採用                                                                                                                                                                                                                                               | 要再確認                         |
| R41 | 18    | type-drift (M)            | visit-schedule billing preview契約がFE/server間でtype-widening drift、BillingCadencePreviewが9fieldコピー                                                                                                                                                                                                                                     | 要再確認                         |
| R42 | 18    | dup-helper (S)            | `VisitVehicleResourceOption`が2 FEファイルでbyte-identical再宣言、`VisitVehicleResourcesResponse`が3箇所triplicated                                                                                                                                                                                                                           | 要再確認                         |
| R43 | 18    | test-harness-dup (M)      | `stubFetch`が26回・2系統で再実装                                                                                                                                                                                                                                                                                                              | 要再確認                         |
| R44 | 18    | pattern-inconsistency (L) | クライアントfetchエラー処理をreadApiJsonへ収束 — 222箇所の固定メッセージ`if (!res.ok) throw`、採用は13箇所のみ                                                                                                                                                                                                                                | 要再確認                         |
| R45 | 17    | pattern-inconsistency (S) | ErrorState以前のplain text-destructiveエラー分岐が5箇所残存（medication-calendarは既収束）                                                                                                                                                                                                                                                    | 要再確認                         |
| R46 | 17    | pattern-inconsistency (S) | `buildCursorPage`未採用の手組みhasMore/slice/nextCursorが約20ルートに残存                                                                                                                                                                                                                                                                     | 要再確認                         |
| R47 | 17    | type-drift (M)            | Conference-note JSON列shape(ActionItem/Participant)がFE/sync/tasks/pdfで4x/3x重複（canonical zod schema既存）                                                                                                                                                                                                                                 | 要再確認                         |
| R48 | 17    | test-harness-dup (M)      | next/navigationとuse-org-idモックが40/123テストファイルでshape drift                                                                                                                                                                                                                                                                          | 要再確認                         |
| R49 | 17    | pattern-inconsistency (S) | State-color未裁定の取り残し2箇所（patient-field-revision, settings-catalog scope badge）                                                                                                                                                                                                                                                      | 要再確認                         |
| R50 | 17    | dup-helper (S)            | patientLabObservation latest-per-analyte手組みコピーが3箇所、listPatientLabSummaryへ収束余地                                                                                                                                                                                                                                                  | 要再確認                         |
| R51 | 16    | dup-component (M)         | icon-bubble KPIカード3種(staff/workflow/performance、~87行)を共有icon-stat-cardへ                                                                                                                                                                                                                                                             | 要再確認                         |
| R52 | 16    | test-harness-dup (M)      | `createRequest` NextRequestビルダーが255回重複                                                                                                                                                                                                                                                                                                | 要再確認                         |
| R53 | 16    | query-helper (M)          | `firstWinsByKey`/`groupIntoLists`抽出候補（findMany desc→newest-per-key idiomが21+62箇所）                                                                                                                                                                                                                                                    | 要再確認                         |
| R54 | 15    | dup-helper (M)            | FE日付ラベル整形: formatOptionalDateがformatDateLabelと重複、ローカルformatterコピー5種+inline26箇所                                                                                                                                                                                                                                          | 要再確認                         |
| R55 | 15    | pattern-inconsistency (M) | 「読み込み中...」plain text表示が18ファイル31箇所（Skeleton未採用）。2026-07-04 R55 wave で route-level fallback、raw `<Loading />`、component visible generic loading copy を順次画面/領域固有 label へ置換。最終 targeted generic visible loading scan は no matches。                                                                      | done(07696837)                   |
| R56 | 14    | dup-component (M)         | MetricCard/KpiCard/SummaryCard手組みが7-11画面、StatCardが置換候補と自己docに明記                                                                                                                                                                                                                                                             | 要再確認                         |

> 注記: 上表は原本の記述をそのまま転記した候補リストであり、本ラウンドでは R03/R07/R22 のみ
> file:line 再確認を行った。他項目は実装着手前に個別 grep での現存確認が必須（Wave 3 以降の
> DataTable移行・billing-rules registry化・drug-master分割等で一部が部分的に消化されている
> 可能性がある）。

---

## 実装ガードレール（着手時の共通ルール、再掲）

1. セクションAは記録のみ。RLS/認可/CDS変更は人間承認 + `.agent-loop/BLOCKED.md` ハードストップ対象。
2. セクションB/Cは1件1スライス、maker/checker分離、objective gate（lint/typecheck/test/build）必須。
3. Cセクションの「要再確認」項目は着手前に必ず現在の grep / git log -S で現存・スコープを再検証し、
   Wave3以降の並行作業と衝突しないか確認すること（特にDataTable/billing-rules/drug-master分割領域）。
