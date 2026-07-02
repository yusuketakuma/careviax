# Ultracode Expansion — Round 1 (Codex cross-review) — 2026-07-02

Claude の `ULTRACODE_EXPANSION_ROUND1_CLAUDE.md` CE01-CE19 を、Codex 側で read-only 再検証した結果。実装・stage・commit・DB write・migration 適用はしていない。

使用した視点: frontend, backend/TZ, concurrency, performance, medical-safety, security/adversarial。検証は `git status`, `rg`, `sed`/`nl` による静的確認のみ。

## Executive verdict

- **confirm**: CE01, CE02, CE03, CE05, CE06, CE09, CE10, CE11, CE12, CE13, CE14, CE15, CE16, CE17, CE18, CE19.
- **confirm with correction**: CE04, CE07, CE08.
- **important dedup**: CE05 is the decision-race half of F83. Keep CE05 as the concrete approve/reject race; keep F83-create as the duplicate-pending-request race.
- **highest implementation priority from this round**: CE01/CE02 false-safe UI gates, CE05/CE06 concurrency guards, CE12/CE13/CE14 offline reliability, CE11/N23-style latest-per-group overfetch, CE03/CE10/CE15 TZ correctness.

## Cross-review matrix

| id   | Codex verdict                                                               | consistency / correction                                                                                                                                                                                                                   | evidence anchor                                                                                                                                                | tests to require                                                                                                                                  |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CE01 | Confirm, but direct "immediate re-rental" needs status-inconsistency caveat | `pendingInspectionPumpIds` collapses on query error and safety gates open; normal returned-pending pump status is usually `maintenance`, so re-rental needs another status drift. The false-empty and maintenance action risk remain real. | `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx:489`, `:523`, `:845`, `:943`                                                                        | return-inspection query error shows error/retry, never `0件`; rental/select and maintenance action fail closed while inspection state is unknown. |
| CE02 | Confirm                                                                     | `visitPreparationSnapshot` errors are omitted from `workflowDataError`; `billing_blockers ?? []` can falsely complete readiness. Primary harm is billing/readiness integrity, with indirect clinical workflow risk.                        | `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx:565`, `:610`, `:672`, `:924`                                                                          | visit-preparation 500 blocks readiness/action completion and exposes retry.                                                                       |
| CE03 | Confirm                                                                     | Instant `created_at` is compared against server-local midnight. Use instant JST day boundary, not the @db.Date helper.                                                                                                                     | `src/app/api/dashboard/cockpit/route.ts:154`, `:293`; `src/lib/utils/date-boundary.ts:104`                                                                     | UTC runtime 00:00-08:59 JST carryover fixture.                                                                                                    |
| CE04 | Confirm as SSOT drift / FORCE-only gap                                      | Migrations force PatientSelfReport and CommunityActivity, but `rls-policies.sql` omits FORCE. This is conditional on SSOT provisioning or owner-bypass, not a proven live migration-chain leak.                                            | `prisma/rls-policies.sql:226`, `:511`; creating migration FORCE lines                                                                                          | RLS contract should assert ENABLE + policy + FORCE for every non-null `org_id` tenant table.                                                      |
| CE05 | Confirm, duplicate with F83 decision subcase                                | Concrete race: read pending outside tx, approve upserts stock, terminal state update is id-only. Track once as CE05/F83-decision.                                                                                                          | `src/app/api/pharmacy-drug-stock-requests/[id]/route.ts:40`, `:83`, `:87`, `:114`                                                                              | concurrent approve/reject gives exactly one winner and side effects match winner only.                                                            |
| CE06 | Confirm                                                                     | Version check is advisory because update where-clause omits version.                                                                                                                                                                       | `src/app/api/dispense-results/[id]/route.ts:144`, `:175`, `:274`                                                                                               | stale double-submit returns 409 and preserves first correction.                                                                                   |
| CE07 | Partial / contract-dependent                                                | `CommunicationRequest.due_date` is DateTime. If used as date-only sentinel, `new Date()` marks same-day requests overdue; if true deadline instant, current code may be intended. Clarify contract before patch.                           | `src/server/services/workflow-dashboard-queries.ts:494`; `prisma/schema/communication.prisma:94`                                                               | fixtures for due-today date-only and true deadline instant.                                                                                       |
| CE08 | Confirm root, impact corrected                                              | `end_date @db.Date` can store previous civil day in early JST, but CDS current-med reads also gate on `is_current=false`; do not frame as direct CDS false-negative.                                                                       | `src/server/services/prescription-intake-service.ts:1561`; `src/server/cds/checker.ts:1671`                                                                    | early-JST discontinuation stores expected JST date and current-med exclusion remains explicit.                                                    |
| CE09 | Confirm                                                                     | ResidualMedicationChart buckets instant `created_at` by `slice(0,10)` UTC date.                                                                                                                                                            | `src/components/features/patients/residual-medication-chart.tsx:43`; `prisma/schema/medication.prisma:75`                                                      | 00:00-08:59 JST residual record appears on same JST day.                                                                                          |
| CE10 | Confirm                                                                     | care-report send route builds month window from server-local month for instant `visit_date`; use `japanMonthInstantRange` and half-open upper bound.                                                                                       | `src/app/api/care-reports/[id]/send/route.ts:1715`, `:1729`; `prisma/schema/visit.prisma:195`                                                                  | JST month start/end visit fixtures for billing evidence upsert.                                                                                   |
| CE11 | Confirm                                                                     | Inventory forecast loads all historical prescription intakes, but only latest per patient is consumed. Result-preserving DB latest-per-group fix is possible.                                                                              | `src/app/api/admin/inventory-forecast/route.ts:109`; `src/lib/analytics/inventory-forecast.ts:366`, `:501`                                                     | equivalence test: DB-selected latest rows match current `selectLatestIntakeByPatient`.                                                            |
| CE12 | Confirm                                                                     | Global reconnect handler refetches queries only; page-scoped record listener is removed on navigation.                                                                                                                                     | `src/components/providers/query-provider.tsx:26`; `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx:658`; `src/lib/stores/sync-engine.ts:582`      | unmount record page, fire `online`, queue drains from provider.                                                                                   |
| CE13 | Confirm                                                                     | Offline store initializes green state; count refresh only runs on record/offline-sync pages.                                                                                                                                               | `src/lib/stores/offline-store.ts:27`; `src/components/layout/app-header.tsx:90`                                                                                | app shell bootstraps IndexedDB queue count and does not show green synced on refresh failure.                                                     |
| CE14 | Confirm                                                                     | `enqueueForSync` always adds; sibling conflict registration has scope dedup.                                                                                                                                                               | `src/lib/stores/sync-engine.ts:402`, `:441`                                                                                                                    | two offline saves for same `schedule_id` leave one pending queue row with newest payload.                                                         |
| CE15 | Confirm                                                                     | One server-local range is applied to both instant columns and @db.Date shift dates. Split instant vs date-only helpers.                                                                                                                    | `src/app/api/admin/staff-metrics/route.ts:8`, `:117`, `:139`, `:158`                                                                                           | UTC and Asia/Tokyo runtime month-boundary fixtures.                                                                                               |
| CE16 | Confirm, lower clinical impact                                              | Conference recurrence/proposal derives civil day from UTC getters on a DateTime instant. Staff review lowers immediate harm, but proposal date quality is wrong.                                                                           | `src/server/services/conference-data-sync.ts:210`, `:690`; `prisma/schema/communication.prisma:229`                                                            | early-JST conference recurrence weekday and +7 proposed date.                                                                                     |
| CE17 | Confirm as perf/semantics flag                                              | Query scans all historically expired rows. Do not blindly add `gte: today`; preserve behavior for already-expired-but-never-notified rows unless product approves change.                                                                  | `src/server/jobs/daily/prescriptions.ts:235`, `:240`, `:269`                                                                                                   | already-notified old row skipped; unnotified old expired behavior explicitly specified.                                                           |
| CE18 | Confirm                                                                     | `trimStringOrUndefined` has two exported copies plus inline route copies. Current output is identical; harm is future drift on write-path normalization.                                                                                   | `src/lib/validations/communication-request.ts:7`; `src/lib/validations/tracing-report.ts:6`; `src/app/api/files/presigned-upload/route.ts:22`                  | behavior-preserving helper centralization plus affected route tests/typecheck.                                                                    |
| CE19 | Confirm                                                                     | Mention ids are append-only and submitted verbatim after text deletion.                                                                                                                                                                    | `src/components/features/comments/mention-input.tsx:56`, `:107`; `src/components/features/comments/comment-thread.tsx:62`; `src/app/api/comments/route.ts:193` | deleting mention text before submit yields empty `mentions` payload.                                                                              |

## Round 1 implementation grouping

1. **Fail-closed UI / offline lifecycle**: CE01, CE02, CE12, CE13, CE14, CE19. Add provider-level lifecycle coverage and targeted RTL tests. CE12/CE13/N21/N22/N25 should share one offline-state design.
2. **Concurrency and data-integrity**: CE05, CE06. Implement with guarded `updateMany` / claim-first transactions. CE05 should be merged with F83 decision half.
3. **TZ helpers**: CE03, CE08, CE09, CE10, CE15, CE16, plus Round 2 N19/N20/N24/N26/N30 and Codex ADJ01/ADJ02. Fix by column type, not by broad local-time conversion.
4. **Perf latest-per-group**: CE11 and Round 2 N18/N23/N34. Preserve current ranking/tie-break semantics before reducing rows.
5. **RLS / security flags**: CE04 belongs with Round 2 RLS cluster. Migration/SSOT edits remain approval-gated.

## Adjacent candidates found during Round 1 review

These are not assigned F numbers here to avoid conflicting with the existing F79-F89 addendum. They should be reconciled by the next central queue pass.

### CXR1-MSR01 [new medical-safety] CDS ignores legacy string/object allergy_info

- Severity: high medical-safety.
- Evidence: `src/server/cds/checker.ts:883-897`, `src/lib/patient/operational-summary.ts:84-91`, `src/server/services/qr-allergy-promotion.test.ts:188-224`.
- Reproduction: legacy or mixed `patient.allergy_info` is a string/object; operational summary treats it as allergy-present, QR promotion preserves it, but CDS uses `Array.isArray(patient.allergy_info) ? patient.allergy_info : []` and silently checks no allergy.
- Impact: visible legacy allergy data can be omitted from CDS allergy checks.
- Fix direction: normalize legacy allergy_info via a shared parser and emit data-quality alerts for unparseable legacy entries. Keep `なし`/`none` non-allergy semantics.
- Tests: legacy string allergy emits data-quality/allergy handling; structured arrays remain unchanged.
- Confidence: high.

### CXR1-MSR02 [new medical-safety] MedicationProfile allows drug_master_id / drug_name drift

- Severity: medium-high medical-safety.
- Evidence: `src/app/api/medication-profiles/route.ts:199-235`, `src/lib/validations/medication.ts:18-29`, `src/server/cds/checker.ts:573-631`.
- Reproduction: manual MedicationProfile POST supplies a valid `drug_master_id=A` but `drug_name` for B. The API verifies only that the master exists; CDS matches by A's YJ but displays profile `drug_name` in alerts.
- Impact: safety alert identity can be internally contradictory, confusing pharmacist review.
- Fix direction: canonicalize `drug_name` from DrugMaster when `drug_master_id` is supplied, or reject mismatches and store operator-entered text separately.
- Tests: mismatched master/name rejects or canonicalizes; no-master manual entry remains allowed.
- Confidence: medium-high.

### CXR1-CONC01 [new concurrency] duplicate open partial-dispense WorkflowException

- Severity: medium-high operational/data-integrity.
- Evidence: `src/app/api/dispense-results/route.ts:327`, `:786`, `:794`, `prisma/schema/prescription.prisma:532`.
- Reproduction: two partial dispense POSTs on an already-dispensing cycle both find no open `partial_dispense` exception and both create one. No partial unique/dedup key exists for open partial exception per cycle.
- Impact: duplicate work-queue/audit alerts for the same dispensing condition.
- Fix direction: add atomic dedup for open workflow exception, via partial unique key or upsert/claim pattern.
- Tests: concurrent partial submissions create one open exception.
- Confidence: medium-high.

### CXR1-CONC02 [new concurrency] stale patient-insurance DELETE can remove a concurrently corrected row

- Severity: medium-high billing/data-integrity.
- Evidence: `src/app/api/patients/[id]/insurance/[insuranceId]/route.ts:286`, `:299`.
- Reproduction: staff A opens delete, staff B updates coverage, A deletes by id-only after stale existence check.
- Impact: newly corrected billing data can be deleted by a stale UI action. Distinct from F85 overlap constraints.
- Fix direction: require `expected_updated_at` / ETag / If-Match for DELETE and use guarded `deleteMany`.
- Tests: stale DELETE returns 409 and preserves row.
- Confidence: medium-high.

## Non-actions

- No implementation was performed.
- No test/build command was run.
- No DB write, migration, or destructive command was run.
