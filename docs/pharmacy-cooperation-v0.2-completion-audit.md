# Pharmacy Cooperation v0.2 Completion Audit

Date: 2026-06-20 JST

This document is the current-state audit for the attached v0.2 in-home cooperating pharmacy specification. Local e2e DB migration approval was granted on 2026-06-20 JST; the 18 pending migrations listed below were applied to `ph_os_e2e` only. Shared, staging, and production databases were not touched.

## Current Verdict

| Area                           | Verdict                             | Evidence                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code/schema implementation     | Mostly implemented in repo          | `prisma/schema/pharmacy-partnership.prisma`, pharmacy cooperation API routes, dashboard workflow/setup/billing screens                                                                                                                              |
| Unit and route coverage        | Implemented for the shipped slices  | Route/UI tests under `src/app/api/**` and `src/app/(dashboard)/**`                                                                                                                                                                                  |
| Route-mocked browser proof     | Implemented                         | `tools/tests/ui-route-mocked-smoke.spec.ts` covers consent, link, activation, visit, record, report, billing, invoice PDF link, and message posting                                                                                                 |
| Direct DB-backed browser proof | Partially complete                  | Patient-card share-case creation, consent registration, patient-link approval/acceptance, activation, visit-request creation/acceptance, and workflow display now pass against the local e2e DB; partner-record/report/billing gate remains pending |
| Migration application          | Local e2e complete                  | `prisma migrate deploy` applied all 18 pending migrations to `ph_os_e2e`; follow-up `prisma migrate status` reports schema up to date                                                                                                               |
| Rollback policy                | Documented as policy, not exercised | Existing Phase 5 rollback docs plus the v0.2 migration policy below                                                                                                                                                                                 |

## Feature Inventory

| Feature ID | Feature                             | State                                              | Current evidence                                                                                                                                                                                                                           | Remaining work                                                          | Refactor status                                                                                              | Priority |
| ---------- | ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| A-01       | Pharmacy partnerships               | Implemented                                        | `PharmacyPartnership` model; `/api/pharmacy-partnerships`; setup UI                                                                                                                                                                        | Shared/staging/prod DB apply proof                                      | Uses shared org/auth route conventions                                                                       | P0       |
| A-02       | Patient share cases                 | Implemented with local DB-backed proof             | `PatientShareCase`; `/api/patient-share-cases`; patient card create UI; workflow table; local e2e patient-card creation/activation proof                                                                                                   | Downstream partner-record/report/billing browser flow                   | `patient-share-scope.ts`, `patient-share-access.ts`                                                          | P0       |
| A-03       | Patient share consent               | Implemented                                        | `PatientShareConsent`; share-case consent APIs; consent document FileAsset hardening                                                                                                                                                       | DB apply proof for consent document column                              | Shared file storage/download audit                                                                           | P0       |
| A-04       | Patient link approval               | Implemented                                        | `PatientLink`; patient-link API; confirmation-gated workflow UI                                                                                                                                                                            | DB-backed browser proof                                                 | Central status/policy checks in route/service layer                                                          | P0       |
| A-05       | Share scope and correction requests | Implemented                                        | share-case PATCH, correction-request API/UI, audit filters                                                                                                                                                                                 | Broader UI density/a11y polish optional                                 | Canonical scope helper                                                                                       | P0       |
| A-06       | Read-only partner data boundary     | Implemented for v0.2 surfaces                      | active share read predicates and `canManagePatientSharing` route permissions                                                                                                                                                               | Full live role matrix proof after DB apply                              | `patient-share-access.ts`, route-level permission wrappers                                                   | P0       |
| B-01       | Management plan/version evidence    | Implemented with local DB-backed proof             | workflow references management plans; share-case creation validates approved same-patient plan/version snapshots; local browser proof verifies the persisted plan ID/version                                                               | Broader workflow proof                                                  | Existing management-plan services reused; patient-share API guards plan ownership/status/version             | P1       |
| B-02       | Visit request lifecycle             | Implemented with local DB-backed proof             | `PharmacyVisitRequest`, decision API, estimate snapshot, lifecycle status alignment; local e2e request creation/acceptance proof                                                                                                           | Partner-record/report/billing continuation                              | Contract estimate resolver in route/service layer                                                            | P0       |
| B-03       | Partner visit record lifecycle      | Implemented                                        | `PartnerVisitRecord`, draft/submit/review APIs, confirmation-gated UI                                                                                                                                                                      | DB-backed browser proof                                                 | Shared report draft and audit conventions                                                                    | P0       |
| B-04       | Physician report and claim note     | Implemented                                        | physician-report-draft API, `PartnerVisitReportDraft`, claim note fields                                                                                                                                                                   | Live PDF/report delivery outside route-mocked proof                     | Existing report generation reused                                                                            | P0       |
| B-05       | Patient/visit message threads       | Implemented                                        | `PharmacyCooperationMessageThread`; `GET/POST /api/pharmacy-cooperation-message-threads`; workflow UI and browser proof                                                                                                                    | DB apply proof                                                          | Existing notification service reused with PHI-free text                                                      | P0       |
| C-01       | Contracts, versions, fee rules      | Implemented                                        | `PharmacyContract`, `PharmacyContractVersion`, `PharmacyContractFeeRule`; setup APIs/UI                                                                                                                                                    | DB apply proof                                                          | `pharmacy-contract-documents.ts`, contract status alignment                                                  | P0       |
| C-02       | Contract document creation          | Implemented                                        | contract document API, PDF renderer, signed PDF upload, setup UI                                                                                                                                                                           | Real S3/DB upload/download proof                                        | Shared FileAsset/PDF services                                                                                | P0       |
| C-03       | Billing candidates                  | Implemented                                        | `VisitBillingCandidate`; candidate/summary APIs; route-mocked browser proof                                                                                                                                                                | DB apply proof                                                          | Shared contract fee snapshot logic                                                                           | P0       |
| C-04       | Invoices and free reports           | Implemented                                        | `PharmacyInvoice`, `PharmacyInvoiceItem`, PDF route, lifecycle PATCH, billing UI                                                                                                                                                           | DB-backed issue/send/payment proof                                      | `pharmacy-invoices.ts`, PDF service                                                                          | P0       |
| C-05       | Payment state                       | Implemented in schema/code                         | `payment_scheduled_for`, lifecycle metadata, billing UI                                                                                                                                                                                    | DB apply proof                                                          | Existing invoice lifecycle helpers                                                                           | P0       |
| R-01       | Patient reference commonality       | Implemented for v0.2 list/share surfaces           | share/access helpers, patient card/workflow consumers, patient-list `pharmacy_share` derived from active share cases                                                                                                                       | Broader cross-app patient summary resolver remains future work          | Shared active-share summary service started                                                                  | P1       |
| R-02       | Permission policy commonality       | Implemented for v0.2 boundaries                    | `canManagePatientSharing`, `canManageBilling`, active-share read predicates, patient-share correction/edit policy, shared data output policy for attachment/print/PDF/download scope checks, scope-update API output-action audit/response | Broader role-matrix browser proof after DB apply                        | In progress but sufficient for v0.2 surfaces                                                                 | P0       |
| R-03       | Audit commonality                   | Implemented for v0.2 surfaces                      | app audit helpers, DB trigger redaction migrations, audit filter options                                                                                                                                                                   | DB trigger proof after migration apply                                  | Shared audit entry/export/file-download helpers                                                              | P0       |
| R-04       | Notification commonality            | Implemented for messages and record submit/review  | existing notification service reused; PHI-free message text for message, submit, confirm, and return events                                                                                                                                | Broader notification delivery proof optional                            | Reused service                                                                                               | P1       |
| R-05       | Billing calculation commonality     | Implemented for cooperation billing                | contract estimate, billing candidate snapshots, invoice item snapshots                                                                                                                                                                     | Broader unification with all legacy billing engines remains future work | Started                                                                                                      | P1       |
| R-06       | PDF/file generation commonality     | Implemented for contract/invoice/report/file audit | shared PDF/FileAsset services                                                                                                                                                                                                              | Real S3 proof pending                                                   | Reused services                                                                                              | P0       |
| R-07       | State transition commonality        | Implemented for v0.2 mutation routes               | `pharmacy-partnerships.ts` transition helpers; patient-share consent/link/revoke/activate, visit/record/report/claim, and contract/version routes; invoice transition service                                                              | Broader legacy-wide state-machine modeling remains future hardening     | Patient-share case, visit request, partner record, contract, contract-version, and invoice rules centralized | P1       |

## Completion Criteria Audit

| #   | Requirement                                              | Status                                                                   | Evidence                                                                                                                                              | Gap                                                                |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Inventory exists                                         | Complete in current audit                                                | This document's Feature Inventory                                                                                                                     | Keep updated as slices land                                        |
| 2   | Phase 1 equivalent functions implemented                 | Mostly complete                                                          | Models/APIs/UI listed above; `Plans.md` v0.2 track                                                                                                    | Full DB-backed workflow proof pending                              |
| 3   | Major flows work                                         | Route-mocked complete; patient-share and visit-request DB proof complete | `tools/tests/ui-route-mocked-smoke.spec.ts`; `tools/tests/ui-major-screens.spec.ts` patient-card creation/consent/link/activation/visit-request proof | Partner record/report/billing DB-backed flow pending               |
| 4   | Partner-owned data direct edit is blocked                | Implemented for v0.2 surfaces                                            | active-share predicates and permission route wrappers                                                                                                 | Full live role matrix proof pending                                |
| 5   | Only base-confirmed visits become billing candidates     | Implemented                                                              | `visit-billing-candidates` route/tests and route-mocked proof                                                                                         | DB apply proof pending                                             |
| 6   | Paid contract invoice PDF                                | Implemented                                                              | pharmacy invoice PDF service/route and browser PDF link proof                                                                                         | Real DB/S3 proof pending                                           |
| 7   | Free cooperation report                                  | Implemented in billing document model                                    | invoice/free document kind and free-report UI/API tests                                                                                               | Real DB proof pending                                              |
| 8   | Contract versions                                        | Implemented                                                              | contract version model/API/tests                                                                                                                      | DB apply proof pending                                             |
| 9   | Invoice snapshots                                        | Implemented                                                              | `pharmacy-invoices.ts` item and invoice snapshots                                                                                                     | DB apply proof pending                                             |
| 10  | Contract doc and fee table generation                    | Implemented                                                              | contract document service/PDF renderer/setup UI                                                                                                       | Real DB/S3 proof pending                                           |
| 11  | Shared auth/audit/patient/notification/billing/PDF logic | Implemented for v0.2 surfaces; broader refactor ongoing                  | helpers/services listed in Feature Inventory                                                                                                          | Legacy-wide consolidation is future hardening                      |
| 12  | Tests added and passing                                  | Complete for current slices                                              | focused Vitest, route tests, route-mocked Playwright, DB-backed patient-card Playwright, typecheck/lint/format results in `CODEX_GOAL_PROGRESS.md`    | Full DB-backed E2E gate pending                                    |
| 13  | DB migration rollback policy                             | Policy documented; local deploy exercised                                | Existing `docs/phase5-rollback-playbook.md`; v0.2 policy below; local e2e migration deploy on 2026-06-20 JST                                          | Rollback not exercised                                             |
| 14  | Final report                                             | Current-state report updated                                             | This document and `CODEX_GOAL_PROGRESS.md`                                                                                                            | Final completion report cannot mark the full workflow complete yet |

## Local E2E Migration Application

Initial `prisma migrate status` against `ph_os_e2e` reported these 18 pending migrations. After explicit local DB approval, `prisma migrate deploy` applied them all to the local e2e database, and the follow-up status check reported the schema up to date:

- `20260618022000_unique_packaging_group_key`
- `20260618045000_allow_reaudit_after_dispense_rejection`
- `20260618073000_add_visit_contact_log_idempotency`
- `20260618090000_add_visit_reproposal_source`
- `20260618101500_add_patient_self_report_idempotency`
- `20260618111500_add_care_report_send_request_idempotency`
- `20260618122500_add_communication_event_attachments`
- `20260619110800_add_pharmacy_partnership_foundation`
- `20260619150500_add_patient_share_consent_file_asset_index`
- `20260619153500_redact_consent_record_audit_document_url`
- `20260619173403_redact_patient_share_consent_audit`
- `20260619190000_add_audit_actor_context`
- `20260619193000_add_consent_record_document_file_id`
- `20260619200600_align_pharmacy_contract_statuses`
- `20260619202000_align_patient_share_case_statuses`
- `20260619204000_align_pharmacy_visit_request_statuses`
- `20260619214500_add_pharmacy_invoice_payment_schedule`
- `20260619223000_add_pharmacy_cooperation_message_threads`

## v0.2 Migration Application and Rollback Policy

No migration should be applied to shared, staging, or production databases without explicit target approval. When approval is granted, run this sequence against the target environment:

1. Capture current state: `pnpm exec prisma migrate status --schema=prisma/schema/`.
2. Run read-only prechecks: `pnpm db:e2e:verify-migration-preconditions` for local e2e, or the production-equivalent precheck command for the target.
3. Take a database backup or restore point before deploy. For local e2e, preserve a disposable reset path; for shared/staging/prod, require a recoverable backup.
4. Apply with the repository script for the target: local e2e uses `pnpm db:e2e:prepare`; deploy targets use `pnpm db:migrate:deploy`.
5. Regenerate/check client if needed: `pnpm db:generate`, then `pnpm typecheck`.
6. Run the direct browser proof: patient card creation -> consent/link/activation -> visit request -> partner record -> report -> billing.
7. Run the route-mocked browser smoke again to protect UI behavior independent of DB seed data.

Rollback policy:

- Prefer restore-from-backup for failed DB application in shared environments. This is safer than ad hoc down SQL for multi-table v0.2 changes and audit trigger rewrites.
- If restore is unavailable, use a forward corrective migration reviewed per failing migration. Do not hand-edit production tables outside a reviewed migration.
- For local e2e, reset/reprepare the disposable e2e database after preserving failure logs.
- For enum/status rename migrations, rollback requires data normalization before type/value rollback. Do not deploy an old app version against new enum values without a compatibility check.
- For audit trigger redaction migrations, rollback must preserve the stricter redacted payload shape unless legal/compliance owners explicitly approve reverting.
- For FileAsset/document-link migrations, rollback must not expose raw URLs or orphan files. Preserve `FileAsset` rows and revoke access paths before removing relation columns.

Rollback decision criteria:

- Any migration failure or Prisma P2022/P2023 on core patient/workflow pages after apply.
- Any 5xx on billing candidate or invoice generation paths after apply.
- Any audit trigger error that blocks medical data writes.
- Any evidence that partner-owned records can be mutated directly.
- Any generated invoice amount changing after contract/patient edits.

## Final Report Snapshot

### Implemented New Features

- Patient share case lifecycle, consent, patient link, correction requests, share scope, and audit filters.
- Pharmacy visit request, partner visit record, base review, physician report draft, billing candidate, and message-thread workflows.
- Pharmacy contract/version/fee-rule, contract document generation/storage, invoice/free-report generation, invoice lifecycle, and payment schedule field.

### Refactoring Completed

- Active patient-share access predicates and canonical share-scope helper.
- Patient-list pharmacy-share state derived from active patient-share-cases instead of patient-master flags.
- Patient-share correction/addition requests use shared owner/edit/request policy instead of route-local ownership maps.
- Shared patient-share output policy maps attachment view/download, print, PDF output/download, and data download actions to required `share_scope` keys, fails closed for inactive share cases, and is surfaced by the share-scope update API as allowed `output_actions` in audit/response metadata.
- Shared audit entry/export/file-download helpers and audit redaction trigger contracts.
- Existing notification service reuse for PHI-free cooperation messages and workflow events.
- Shared FileAsset/PDF infrastructure for consent, contract, invoice, and report artifacts.
- UI confirmation-gate pattern reused for high-risk workflow and billing actions.
- Shared pharmacy-cooperation lifecycle helpers for patient-share-case, visit request, partner visit record, contract, contract-version, and invoice status transitions.
- Patient-share-case creation validates approved same-patient management-plan version snapshots before storing shared plan evidence.

### Major Files

- Schema: `prisma/schema/pharmacy-partnership.prisma`, `prisma/schema/admin.prisma`, `prisma/schema/patient.prisma`.
- APIs: `src/app/api/patient-share-cases/**`, `src/app/api/pharmacy-visit-requests/**`, `src/app/api/partner-visit-records/**`, `src/app/api/visit-billing-candidates/**`, `src/app/api/pharmacy-contracts/**`, `src/app/api/pharmacy-invoices/**`, `src/app/api/pharmacy-cooperation-message-threads/route.ts`.
- UI: `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`, `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`, `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`, `src/app/(dashboard)/patients/[id]/card-workspace.tsx`.
- Services: `src/server/services/patient-share-access.ts`, `src/server/services/patient-share-policy.ts`, `src/server/services/patient-share-scope.ts`, `src/server/services/pharmacy-partnerships.ts`, `src/server/services/pharmacy-contract-documents.ts`, `src/server/services/pharmacy-invoices.ts`, `src/server/services/pdf-pharmacy-contract-document.tsx`, `src/server/services/pdf-pharmacy-invoice.tsx`, `src/server/services/file-download-audit.ts`.

### Added Tests

- API route tests for patient share, consent, patient link, visit requests, partner visit records, billing candidates, contracts, contract documents, invoices, and message threads.
- UI tests for pharmacy cooperation workflow, setup, billing, and patient card share creation.
- Route-mocked Playwright smoke for the end-to-end cooperation workflow that does not require DB migration application.

### Known Remaining Items

- Apply pending migrations after explicit approval.
- Run the direct DB-backed patient-card browser proof.
- Keep broader legacy-wide refactors open as follow-up hardening: patient summary resolver, full role-matrix browser proof, broader state-machine modeling beyond the v0.2 mutation routes, and wider table/accessibility polish.
