# Phase0 Recon: データ層（Prisma schema / RLS / API規約 / 監査 / DTO / migration）

調査日: 2026-07-11 / 調査者: Phase0 recon agent

## 1. Prisma スキーマ全体像

- 単一 `prisma/schema.prisma` は存在しない。**マルチファイルスキーマ**を採用: `prisma/schema/` ディレクトリに 16 ファイル、合計 6,039 行（`wc -l prisma/schema/*.prisma`）。
- `prisma/schema/_config.prisma:4-10` に generator（`prisma-client-js`）と datasource（`postgresql`）。`package.json:91-94` の db スクリプトは全て `--schema=prisma/schema/` を指定。
- **model 数: 166 / enum 数: 134**（`grep -h '^model '` / `'^enum '` の実測）。
- `_stubs.prisma` は「未実装モデルのスタブ置き場」だが現在は空（コメントのみ、`prisma/schema/_stubs.prisma:1-3`）。

### ドメイン別ファイル構成（model 数）

| ファイル | model 数 | 主なドメイン / 代表モデル |
| --- | --- | --- |
| `patient.prisma` | 18 | 患者: Patient, Residence, CareCase, ContactParty, ConsentRecord, ManagementPlan, PatientInsurance, PatientLabObservation, PatientFieldRevision, PatientMedicalProcedure, PatientNarcoticUse, PatientMcsLink/Summary/Message |
| `prescription.prisma` | 18 | 処方・調剤: MedicationCycle, PrescriptionIntake, PrescriptionLine, InquiryRecord, DispenseTask/Result/Audit, DispensingDecision, SetPlan/SetBatch/SetAudit, PackagingGroup, CycleHold, WorkflowException, QrScanDraft, JahisSupplementalRecord |
| `medication.prisma` | 11 | 薬歴・残薬・在庫(患者側): MedicationProfile, ResidualMedication, PatientMedicationStockItem, MedicationStockEvent/Snapshot/ObservationContext, ExternalMedicationStockObservation, MedicationIssue, Intervention, FirstVisitDocument, PackagingMethodMaster |
| `visit.prisma` | 12 | 訪問: VisitSchedule, VisitRecord, VisitInstruction, FacilityVisitBatch, VisitScheduleProposal(+Batch), VisitScheduleContactLog, VisitScheduleOverride, VisitPreparation, VisitHandoffExtraction, SpecialPatientStatus, VisitVehicleResource |
| `drug.prisma` | 12 | 医薬品マスタ・薬局在庫: DrugMaster, DrugPackage(+Insert), DrugPriceVersion, DrugInteraction, DrugAlertRule, PharmacyDrugStock, FormularyChangeRequest/Template, GenericDrugMapping, DrugMasterImportLog/ChangeEvent |
| `organization.prisma` | 17 | テナント・組織: Organization, PharmacySite, User, Membership, ServiceArea, PharmacistCredential/Shift, BusinessHoliday, Facility, FacilityUnit, FacilityContact, ExternalProfessional, PrescriberInstitution |
| `admin.prisma` | 20 | 監査・管理: **AuditLog**, AuditLogReview, BillingRule/Candidate/Evidence, Notification(+Rule), IntegrationJob, Template, Setting, FileAsset, UatFeedback, WebhookRegistration/Delivery, IncidentReport, IdSequence, PushSubscription |
| `communication.prisma` | 20 | 多職種連携: CareReport(+Revision/SendRequest), CommunicationEvent/Request/Response, InboundCommunicationEvent/Signal/Attachment, DeliveryRecord, ConferenceNote, TracingReport, PatientSelfReport, ExternalAccessGrant, TaskComment, HandoffBoard/Item |
| `pharmacy-partnership.prisma` | 18 | 薬局間連携・契約請求: PartnerPharmacy, PharmacyPartnership, PatientShareCase/Consent, PatientLink, PharmacyVisitRequest, PartnerVisitRecord, PharmacyContract(+Version/FeeRule), VisitBillingCandidate, PharmacyInvoice(+Item), ContractDocument |
| `standard-clinical-integration.prisma` | 12 | FHIR/外部臨床連携: ClinicalExternalSystem/Reference, ClinicalFhirResourceCache, ClinicalFhirRawResourceVault, ClinicalDisclosureGrant, YreseClinicalEvent/OutboundEvent, ClinicalSyncQueueItem, ClinicalProvenanceRecord, HomeCarePatientProfile, MedicationTimelineItem, ResidualMedicationAssessment |
| `platform.prisma` | 2 | 運営者: PlatformOperator, BreakGlassSession |
| `pca-pump.prisma` | 4 | PCAポンプ資産: PcaPump, PcaPumpMaintenanceEvent, PcaPumpRental(+Accessory) |
| `core-task.prisma` | 1 | Task |
| `saved-view.prisma` | 1 | SavedView |

（各行番号根拠: `grep -n '^model ' prisma/schema/*.prisma` の出力に基づく）

## 2. versioning / 確定状態 / 監査フィールド

- **楽観的ロック `version Int`**: MedicationCycle（`prescription.prisma:124`、コメント「楽観的ロック」）、DispenseResult（:330）、SetBatch（:459）、PackagingGroup（:535）、VisitSchedule（`visit.prisma:152`）、VisitRecord（:232）、Template（`admin.prisma:270`）、ManagementPlan（`patient.prisma:331`）。
- **版管理（revision テーブル分離）**:
  - CareReport は `report_revision Int @default(1)`（`communication.prisma:424`）+ `CareReportRevision`（:465、`revision_no` / `supersedes_revision_no`、`@@unique([org_id, report_id, revision_no])` :482）。
  - PartnerVisitRecord は `revision_no @default(1)` + `@@unique([org_id, visit_request_id, revision_no])`（`pharmacy-partnership.prisma:443,466`）。
  - PharmacyContract → PharmacyContractVersion（:536）。
  - **PatientFieldRevision**（`patient.prisma:576-611`）: 患者項目のフィールド単位履歴。`old_value/new_value(Json)`、`valid_from/valid_to`、`is_current`、`confirmed_by/confirmed_at`（別スタッフ確認）、`updated_by`、`change_reason`、`source`（patient_detail_edit/visit_record/mcs_sync/import）を持つ二時間軸型の改訂台帳。
- **保険改定版**: PharmacySiteInsuranceConfig が `revision_code`/`revision_label` + `@@unique([org_id, site_id, insurance_type, revision_code])`（`organization.prisma:179-195`）。DrugPriceVersion は薬価の版（`drug.prisma:157`）。
- **共通監査フィールド**: `created_at DateTime @default(now())` は 165 箇所、`created_by/updated_by` 系は 31 箇所（grep 実測）。ほぼ全モデルが `org_id`（テナントキー）と `created_at/updated_at` を持つ。多くの業務モデルが `display_id String?` + `@@unique([org_id, display_id])`（人間可読ID、IdSequence `admin.prisma:27` で採番）。

## 3. record lifecycle（draft/確定/修正）の schema 表現

- **調剤ワークフロー**: `MedicationCycleStatus` enum が 16 状態のパイプラインを表現: intake_received → structuring → inquiry_pending/resolved → ready_to_dispense → dispensing → dispensed → audit_pending → audited → setting → set_audited → visit_ready → visit_completed → reported、＋ on_hold / cancelled（`prescription.prisma:10-27`）。状態遷移は `CycleTransitionLog`（:146）に記録、保留は `CycleHold`（:546、HoldScope/HoldReason enum）。
- **監査(鑑査)確定**: DispenseAudit（:341）が `result DispenseAuditResult` + `audited_by/audited_at` + 差戻し理由コード、および単独薬剤師の自己監査例外（`same_operator_reason/approved_by`、two-person rule の限定例外コメント :356-357）。SetAudit も同型（:471）。DispensingDecision（:377）は「HOW」、DispenseResult は「WHAT」を分離（コメント :368-376）。
- **draft → 確定**: `draft` を初期値に持つ status enum が多数 — ReportStatus（draft/sent/failed/confirmed/response_waiting、`communication.prisma:11-17`）、ManagementPlanStatus（`patient.prisma:77-83`, :330 で `@default(draft)`）、PharmacyPartnership/PatientShareCase/PharmacyVisitRequest/PartnerVisitRecord/PharmacyContract/PharmacyInvoice（`pharmacy-partnership.prisma:174,212,353,444,508,640`）。QRスキャンは QrScanDraft + QrDraftStatus（`prescription.prisma:594-600`）。
- 「確定後は revision テーブルへ」パターン（CareReportRevision, PatientFieldRevision, PharmacyContractVersion）と「version Int による楽観ロック」パターンの併用。

## 4. RLS 構成

- **`prisma/rls-policies.sql`（1,094 行）**: 全マルチテナント表に `ENABLE ROW LEVEL SECURITY`（149 表）+ `FORCE ROW LEVEL SECURITY`（150 行）+ `CREATE POLICY tenant_isolation`。ヘッダ（:1-6）に「Run via psql or as a Prisma migration」「app は非superuser role `app_user` で接続」と明記。role 作成と GRANT も同ファイル（:9-20）。
- ポリシー述語は 2 方式が混在:
  - 旧: `org_id = current_setting('app.current_org_id', true)`（例 Patient :31-33）
  - 新（failsafe）: `org_id = public.app_enforced_org_id()`（例 PatientInsurance :72-74）
- **`app_enforced_org_id()`**（`prisma/migrations/20260328234500_rls_context_failsafe/migration.sql:1-22`）: `app.rls_context_applied = 'true'` でなければ `RAISE EXCEPTION 'RLS context missing'`、org_id 空でも例外。**fail-closed** 設計。同 migration の DO ブロックで主要表のポリシーを failsafe 型に張り替え（:106）。
- migrations 側にも RLS が反映済み: baseline migration に ENABLE/FORCE 各 49（`20260326000000_baseline/migration.sql`、CREATE TABLE 62）、以降の migration で追加表ごとに付与（migrations 全体で FORCE 153 行）。
- **`withOrgContext`**（`src/lib/db/rls.ts:54-89`）: `prisma.$transaction` 内で `set_config(key, value, true)`（SET LOCAL 相当、:40-42）により 8 個のセッション変数を設定（:7-22）: `app.current_org_id`, `app.rls_context_applied`, `app.current_actor_id`, `app.current_member_role`, `app.current_actor_pharmacy_id`, `app.current_actor_site_id`, `app.current_ip_address`, `app.current_user_agent`。orgId は `SAFE_APP_ID_PATTERN`（:6）で形式検証、request context の orgId 不一致は throw（:66-68）、context 欠落は `logSecurityEvent('rls_context_missing')`（:70-77）。
- `createScopedTxRunner`（:122-160）: 単一 org に束縛した短命トランザクション runner（timeout 3000ms/maxWait 2000ms、:111-112）。
- 検証装置: `pnpm test:rls-proof`（実DBに対する RLS 証明テスト、`package.json:90`）、`pnpm rls-policy-contract:check`（`src/tools/rls-policy-contract.test.ts`、`package.json:108`）、`db:e2e:rls-proof-role`（:89、非superuser role セットアップ）。

## 5. API レスポンス規約

- **`src/lib/api/response.ts`**:
  - success envelope: `ApiSuccess<TData, TMeta> = { data, meta? }`（:9-12）、`success(payload, status)`（:23-28）。
  - error envelope: `ApiError = { code, message, details? }`（:3-7）。ヘルパー: `validationError`(400/VALIDATION_ERROR :48)、`internalError`(500 固定文言・情報漏洩防止 :56)、`notFound`(404/WORKFLOW_NOT_FOUND :60)、`forbidden`(403 :64)、`conflict`(409 :68)、`rateLimited`(429 + Retry-After :76-87)、`unauthorized`(401 :111)、`authNoOrg`(400 :115)。
  - エラー文言は LabelDictionary によるローカライズ層（`localizedError` :100-109、`defaultLabelKeysByCode` :14-21）。
- **sensitive no-store**: `src/lib/api/sensitive-response.ts` — `SENSITIVE_NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' }` と `withSensitiveNoStore(response)`。
- 周辺規約モジュール: `list-envelope.ts`、`pagination.ts` / `keyset-cursor.ts` / `cursor-pagination-client.ts`、`versioning.ts`、`deprecation-catalog.ts`、`idempotency-key.ts`、`route-catalog.ts`、`response-schemas.ts`（いずれも `src/lib/api/` 直下、テスト同居）。
- CI ラチェット: `check-api-response-shape.mjs`（`tools/scripts/`、`package.json` にスクリプト登録あり）。

## 6. 監査ログ実装

- **アプリ層**: `src/lib/audit/audit-entry.ts` の `createAuditLogEntry(tx, ctx, input)` — `tx.auditLog.create` で org_id / actor_id / actor_pharmacy_id / actor_site_id / patient_id / action / target_type / target_id / changes(Json) / ip_address / user_agent を記録。周辺に `phi-read-audit.ts`（PHI 読取監査）、`break-glass-audit.ts`、`export-audit-sanitizer.ts`、`navigation.ts`（同ディレクトリ）。
- **DB 層トリガ**: `prisma/migrations/20260328120000_audit_log_triggers/migration.sql` — `ph_os_write_audit_log()` トリガ関数が withOrgContext の set_config 値（actor/role/ip/UA）を読み、INSERT/UPDATE(差分なしはスキップ)/DELETE を JSONB before/after で AuditLog に書く。トリガ 11 本 + `20260328223000_expand_audit_log_targets` で 3 本追加。関数名は `20260521094000_rename_audit_functions_to_ph_os` で `ph_os_` prefix に統一。
- AuditLog モデルは `admin.prisma:189`、レビュー運用は AuditLogReview（:218）+ `src/lib/audit-logs/review.ts`・`redaction.ts`。

## 7. DTO / presenter 規約と checker

- **`tools/scripts/check-dto-direct-prisma-return.mjs`**（API-DTO-001 / MOD-CI-001）: `src/app/api` を走査し、Prisma delegate の戻り値を presenter を介さず `success(...)` / `{ data: ... }` に直接渡すパターンを正規表現で検出（:18-22）。既存負債は `tools/dto-direct-prisma-return-allowlist.json` に **29 エントリ**（path/expectedCount/owner/debtId/reason/plannedAction 形式）で凍結し、新規は CI fail（ラチェット方式、スクリプト冒頭コメント :2-8）。実行: `pnpm dto-direct-prisma-return:check`（`package.json:104`）。
- presenter/mapper の実体は `src/server/mappers/`（例 `patient-response-mapper.ts`）や `src/server/services/` に分散。単一の presenter ディレクトリ規約は未確認。
- 関連 checker 群（`tools/scripts/`）: `check-module-boundaries.mjs`（`pnpm boundaries:check`、`package.json:101`）、`check-api-response-shape.mjs`、`check-client-json-schema.mjs`、`check-client-phi-log.mjs` など。

## 8. migration 運用

- `prisma/migrations/` に **161 個**の migration ディレクトリ（2026-03-26 baseline 〜 2026-05-21）。命名は timestamp + snake_case 説明（一部 `20260401_...` の短縮形も混在）。
- 運用コマンド（`package.json:91-94`）: `db:migrate` = `prisma migrate dev --schema=prisma/schema/`、`db:migrate:deploy` = `prisma migrate deploy`、`db:generate` = `prisma generate` + `tools/scripts/link-prisma-client.mjs`。
- RLS/トリガ/関数などの raw SQL は通常の migration ファイル内に直接記述する方式（例: rls_context_failsafe, audit_log_triggers, security_hardening）。`rls-policies.sql` は集約リファレンス兼再適用スクリプトの位置づけ（ヘッダ「Run via psql or as a Prisma migration」）。
- E2E 用ローカル DB は 5433/brew postgresql、migrate deploy + seed 直叩き運用（`package.json:89-90` の接続文字列）。

## 9. 「想定スタック」との差分判定（データ層関連）

| 想定 | 実態 | 根拠 |
| --- | --- | --- |
| Cognito + NextAuth | **実在**。`next-auth@4.24.14`（lockfile 実測 4.24.14）、`src/lib/auth/` に request-context 等 | `pnpm-lock.yaml:140-142` |
| Serwist (PWA) | **実在**。`@serwist/next` / `serwist` とも 9.5.11（lockfile 実測） | `pnpm-lock.yaml:167-169` |
| DynamoDB レート制限 | **実在（opt-in）**。既定は in-memory fixed window、`RATE_LIMIT_STORE=dynamodb` で DynamoDB 分散カウンタに切替 | `src/lib/api/rate-limit.ts:7-11,128-129` |
| ECS / Lightsail 計画資産 | **実在**。`aws:ecs-express:plan`, `aws:lightsail:plan` ほか多数の plan/validate スクリプト | `package.json:41-50` |
| standalone output | **実在**。`output: 'standalone'` | `next.config.*:11` |
| モジュール境界チェック | **実在**。`check-module-boundaries.mjs` + `pnpm boundaries:check` | `package.json:101` |
| S3 / SES / CloudWatch metrics | package.json の `@aws-sdk/*` 依存行は本調査のデータ層スコープでは個別未確認（**未確認**。CLAUDE.md 記載と `src/lib/storage` 等の存在から実装は示唆されるが、行番号根拠を取っていない） | — |
| Prisma 単一 schema.prisma | **差分**: マルチファイル `prisma/schema/` 方式 | `prisma/schema/_config.prisma` |

## 10. 主要バージョン（lockfile 実測）

- `prisma` / `@prisma/client`: **7.8.0**（`pnpm-lock.yaml:74-76,149-151`）
- `next`: **16.2.9**（:137-139）、`next-auth`: **4.24.14**（:140-142）
- `zod`: **4.4.3**（:182-184）、`serwist`: **9.5.11**（:167-169）
- `react` / `react-dom`: **19.2.7**、`typescript`: **6.0.3**（lockfile 解決文字列内で確認）
- 直接依存に `pg@8.21.0` あり（Prisma 外の生 PostgreSQL アクセス経路、用途未確認）
