# CODEX Goal Progress

## Current Goal - 2026-06-19 JST Adjacent Feature and Consistency Loop

Objective: investigate the current CareViaX implementation, add/improve nearby features that naturally extend existing product flows, remove duplication/inconsistency/unfinished behavior, and continue until actionable in-session candidates are exhausted.

### Acceptance Criteria

- Run at least two implementation/audit loops.
- List and score at least five adjacent candidates across short/mid/long terms.
- Prefer extension/reuse of existing APIs, permissions, components, hooks, types, tests, and docs.
- Implement all actionable short/mid/long candidates that do not require external approval, destructive DB changes, credentials, legal/product/design decisions, or environment-only access.
- Finish only after two consecutive re-audits report no new actionable candidates.

### Loop 0 - Baseline

Required context read:

- `AGENTS.md`
- `README.md`
- `Plans.md`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`
- `package.json`
- `.github/workflows/ci.yml`
- `docs/ui-ux-design-guidelines.md`
- `docs/api-conventions.md`
- `docs/high-roi-functional-proposals-2026-06-18.md`
- Next.js local route-handler and route file-convention docs under `node_modules/next/dist/docs/`

Initial validation:

- `pnpm format:check`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.

Initial worktree:

- Pre-existing dirty file: `.harness-mem/state/continuity.json`.
- No repository source edits had been made for this goal before the baseline checks.

### Loop 1 - Inventory and Required Agent Review

Required read-only agents completed:

- Product Discovery Agent: existing flows, TODOs, unfinished areas, adjacent candidates.
- Similarity Agent: reusable components/hooks/services/API/types/validators/utilities/stores.
- Architecture Agent: placement, responsibility, dependencies, naming, type design.
- UX/API Consistency Agent: UI, API, loading/error/empty, permissions.
- Duplication Agent: double implementations and consolidation opportunities.
- Test Agent: normal/error/empty/boundary/permission/invalid-input/data-integrity coverage.
- Documentation Agent: README/API/runbook/type/comment drift.

Major product surfaces identified:

- Dashboard cockpit and daily operations.
- Patient home/visit preparation/report/billing continuity.
- Care-report authoring, confirmation, delivery, sharing, and delivery history.
- Dispense/set/audit workflows.
- Collaboration, communication requests, tasks, and external professional contact flows.
- Admin/operations APIs and runbooks.

### Loop 2 - Candidate Evaluation

| Candidate                                         | Term      | Priority | Nearby existing implementation                                                                   | Value                                                               | Cost   | Risk   | Decision                                               |
| ------------------------------------------------- | --------- | -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------ |
| Permission-aware report detail actions            | Short     | High     | `requireAuthContext`, `hasPermission`, care-report GET/PATCH/send routes, report detail UI/tests | Stops clerk/read-only users from seeing edit/send actions that 403  | Low    | Low    | Implement first                                        |
| Today report workspace billing blockers           | Short/Mid | High     | `care-reports/today-workspace`, billing candidate/check surfaces, `ReportOpenIssue`              | Connects report readiness to billing blockers in the same workspace | Medium | Medium | Actionable after first slice                           |
| Dashboard freshness/staleness grounding           | Short     | Medium   | existing dashboard/cockpit generated timestamps/cache TTL                                        | Preserves current cockpit while reducing stale-state ambiguity      | Low    | Low    | Actionable if no higher report/billing blockers remain |
| API/docs pagination/version drift cleanup         | Short     | Medium   | `docs/api-conventions.md`, cursor helpers, actual route responses                                | Prevents repeated client/API mismatch                               | Low    | Low    | Actionable docs slice                                  |
| Inline error heading hierarchy                    | Short/Mid | Medium   | shared `ErrorState`/alert components and UI guideline SSOT                                       | Improves accessible page structure without redesign                 | Medium | Low    | Actionable after focused scan                          |
| Admin webhook response/audit consistency          | Mid       | Medium   | `withAuthContext`, response helpers, audit helper                                                | Aligns admin API error shape and audit trail                        | Medium | Medium | Actionable if tests are localized                      |
| Patient detail timeline duplication consolidation | Mid/Long  | Medium   | `patient-detail-timeline-events` service and patient detail route local builder                  | Removes duplicate timeline construction                             | High   | Medium | Actionable only if safe after report/billing loops     |

Current first implementation target:

- Fix report detail UI/API permission metadata by reusing the existing permission matrix instead of duplicating role logic in the client.

### Loop 3 - Similarity and Design Decision

- Reuse `hasPermission(role, 'canAuthorReport' | 'canSendCareReport')` in `GET /api/care-reports/[id]`.
- Add a small `permissions` metadata object to the existing report detail payload.
- Keep existing route permissions unchanged: viewing still uses `canReport`; editing still uses `canAuthorReport`; sending still uses `canSendCareReport`.
- Gate existing `ReportEditForm`, draft confirmation review, send dialog, and composer entry points by the metadata.
- Keep print/share detail links available because they already route through their own access checks and are not report authoring/send mutations.

### Loop 4 - Implementation Pass 1: Report Permissions and Billing Blockers

Implemented:

- Added `permissions.can_edit` and `permissions.can_send` to `GET /api/care-reports/[id]` using the existing role permission matrix.
- Gated report detail edit, draft confirmation, send dialog, and composer entry points by those server-provided permissions.
- Added same-workspace `BillingCandidate(status=candidate)` blockers to `/api/care-reports/today-workspace` `open_issues`, limited to patients already present in the report workspace.
- Extended `ReportOpenIssue` with `kind` and nullable `report_id` so report issues and billing candidate issues can share the existing UI section without fake report IDs.

Deleted or consolidated:

- No new report action component, route, or permission map was created.
- Reused existing `ReportOpenIssuesSection`, `/billing/candidates` filters, and billing candidate data.

Focused validation:

- `pnpm exec vitest run 'src/app/api/care-reports/[id]/route.test.ts' 'src/app/(dashboard)/reports/[id]/page.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 24 tests.
- `pnpm exec vitest run 'src/app/api/care-reports/today-workspace/route.test.ts' 'src/app/(dashboard)/reports/report-share-workspace.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 17 tests.
- Touched-file ESLint for the report slices: passed.

### Loop 5 - Implementation Pass 2: Cockpit Freshness, Docs Drift, ErrorState, Admin Webhooks

Implemented:

- Added dashboard cockpit freshness metadata: fresh snapshots keep the existing time-only display; stale snapshots show `HH:mm / 要更新`.
- Updated API docs to match actual cursor response shape `{ data, hasMore, nextCursor?, totalCount? }`.
- Updated API versioning docs to clarify that current endpoints are unprefixed `/api` v1-equivalent and `/api/v1` is not currently implemented.
- Corrected deploy/recovery migration runbooks to use `pnpm prisma migrate deploy --schema=prisma/schema/` where deploy semantics are intended.
- Updated shared `ErrorState` so inline usage defaults to `h2`, page usage defaults to `h1`, and callers can set `headingLevel`.
- Aligned `/api/admin/webhooks` with response helpers and added creation audit logging without persisting the generated secret.

Focused validation:

- `pnpm exec vitest run 'src/app/(dashboard)/dashboard/dashboard-cockpit.test.tsx' 'src/app/(dashboard)/dashboard/dashboard-cockpit.helpers.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 29 tests.
- `pnpm exec vitest run src/components/ui/error-state.test.tsx --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec vitest run 'src/app/api/admin/webhooks/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- Touched-file ESLint for dashboard, ErrorState, and admin webhooks: passed.

### Loop 6 - Implementation Pass 3: Patient Timeline Consolidation

Implemented:

- Replaced the duplicated patient detail timeline event builder in `src/app/api/patients/[id]/route.ts` with the canonical `buildPatientTimelineEvents` service helper.
- Preserved existing source queries and avoided an additional timeline-service DB round trip.
- Added `billing_candidate` timeline entries to patient detail from the already-returned billing candidate summary data.
- Added `updated_at` to the patient detail billing candidate select so the canonical builder has a stable event timestamp.

Deleted or consolidated:

- Removed route-local timeline label maps and helper functions that duplicated `patient-detail-timeline-events.ts`.
- Reduced the patient detail route diff surface by delegating timeline presentation rules to the shared service.

Focused validation:

- `pnpm exec vitest run 'src/app/api/patients/[id]/route.test.ts' src/server/services/patient-detail.test.ts --reporter=dot --testTimeout=30000`: passed, 2 files / 64 tests.
- Touched-file ESLint for patient route/timeline service: passed.

### Loop 7 - Validation Snapshot Before Re-Audit

Validation:

- `pnpm format:check`: passed after Prettier.
- `pnpm lint`: passed.
- `pnpm typecheck`: initially failed on missing `ReportOpenIssueSeverity` import in `today-workspace`, then passed after adding the type import.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- Combined focused regression bundle for report, dashboard, ErrorState, admin webhooks, patient detail, and patient-detail service: passed, 10 files / 141 tests.

Remaining candidates for re-audit:

- Re-run Discovery/Similarity/Duplication/Test/Review agents over the current diff.
- Decide whether remaining medium/long items are safe in-session or blocked by product/API/privacy/DB migration scope.
- Run full `pnpm test` and `pnpm build` after re-audit fixes, if no new actionable items remain.

### Loop 8 - Zero Audit 1 Findings and Follow-up Implementation

Zero Audit 1 agents completed:

- Discovery/Explorer: found remaining shortcut permission, output-route, webhook display, and open-issue fairness gaps.
- Similarity/Duplication: found duplicate webhook URL credential/redaction helpers and validation-layer message reads.
- Strict Review: found direct PDF/print URL output still allowed through broader report-view access.
- Test Auditor: found same-severity open-issue starvation cases missing tests.
- Medical Safety and Privacy: found report output and webhook URL response exposure issues that should be fixed before a zero audit.

Implemented:

- Changed `/api/care-reports/[id]/pdf` to require `canSendCareReport`, aligning direct PDF export with the report-detail output UI.
- Added print-page permission gating from the existing care-report detail `permissions.can_send` metadata, preventing direct print URL rendering and auto-print for send-denied roles.
- Added shared `CareReportActionPermissions` and extended care-report detail metadata with `can_view_patient` and `can_view_related_requests`.
- Filtered report-detail shortcuts by server-provided permissions so read-only/report-only roles do not get patient or related-request shortcuts they cannot use.
- Changed today-workspace billing-candidate scan from the visible issue limit to a bounded oversample and added fair source preservation so report and billing issues do not completely starve each other at equal severity.
- Added `collectBillingValidationMessages()` and reused `readBillingValidationLayers()` in billing candidate badge, evidence summary, detail panel, and today-workspace BFF paths.
- Moved webhook URL credential detection and display redaction into `outbound-webhook` service helpers.
- Redacted webhook URL query/hash/userinfo in admin webhook GET/POST responses while preserving raw stored URLs for dispatch.
- Added `fieldErrors` as a compatibility alias for admin webhook schema validation errors.

Focused validation:

- `pnpm exec vitest run 'src/app/api/care-reports/[id]/pdf/route.test.ts' 'src/app/(dashboard)/reports/[id]/print/page.test.tsx' 'src/app/api/care-reports/today-workspace/route.test.ts' 'src/app/(dashboard)/billing/candidates/billing-candidates-content.test.tsx' 'src/app/api/admin/webhooks/route.test.ts' 'src/server/services/outbound-webhook.test.ts' 'src/app/(dashboard)/reports/[id]/page.test.tsx' 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx' 'src/app/api/care-reports/[id]/route.test.ts' --reporter=dot --testTimeout=30000`: passed after fixing the print-page test to mock `useQuery`, 9 files / 83 tests.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: initially failed on one share-page view-only fixture missing the new permission fields, then passed after fixture update.
- `git diff --check`: passed.

Next loop:

- Run Zero Audit 2. If it reports no actionable issues, run Zero Audit 3 for the required second consecutive zero. If it finds actionable issues, implement them before full `pnpm test`/`pnpm build`.

### Loop 9 - Zero Audit 2 Findings and Follow-up Implementation

Zero Audit 2 agents completed:

- Deep Explorer: found that today-workspace open-issue fairness could allow lower-severity billing issues to displace higher-severity report issues, and that the report share page still exposed patient shortcuts/API fetches from `can_view_patient`-denied payloads.
- Refactor/Similarity: found optional permission fields and local billing validation-layer typing that should use the shared contracts.
- Strict Reviewer: confirmed the share-page `can_view_patient` shortcut/API gap.
- Test Auditor: reported no additional test-only blockers before the follow-up fixes.
- Medical Safety: found that print rendering was gated by send permission but did not record an export/print audit before rendering printable clinical content.
- Privacy Compliance: reported no additional privacy blockers after the already-redacted webhook/report-output changes.

Implemented:

- Added `POST /api/care-reports/[id]/print-audit`, reusing the existing care-report access checks and export-audit service with `format: 'print'`.
- Changed the print page to record the print audit before rendering `PrintLayout` or calling `window.print`; audit failure now shows an alert and suppresses printable report content.
- Gated the interprofessional share page's patient-detail shortcut, patient share action, and patient support fetches by `permissions.can_view_patient`.
- Tightened `CareReportActionPermissions` to required booleans so fixtures and consumers cannot silently omit new permission fields.
- Reused shared `BillingValidationLayers` in billing candidate UI typing.
- Changed today-workspace open-issue fair merging so lower-severity items cannot displace higher-severity blockers; cross-source fairness now applies only among items at the visible cutoff severity.

Focused validation:

- `pnpm exec vitest run 'src/app/api/care-reports/[id]/print-audit/route.test.ts' 'src/app/(dashboard)/reports/[id]/print/page.test.tsx' 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx' 'src/app/api/care-reports/today-workspace/route.test.ts' 'src/server/services/export-audit.test.ts' 'src/app/(dashboard)/billing/candidates/billing-candidates-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 6 files / 40 tests.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm exec vitest run 'src/app/api/care-reports/[id]/pdf/route.test.ts' 'src/app/api/care-reports/[id]/print-audit/route.test.ts' 'src/app/(dashboard)/reports/[id]/print/page.test.tsx' 'src/app/api/care-reports/today-workspace/route.test.ts' 'src/app/(dashboard)/billing/candidates/billing-candidates-content.test.tsx' 'src/app/api/admin/webhooks/route.test.ts' 'src/server/services/outbound-webhook.test.ts' 'src/server/services/export-audit.test.ts' 'src/app/(dashboard)/reports/[id]/page.test.tsx' 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx' 'src/app/api/care-reports/[id]/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 11 files / 96 tests.

Next loop:

- Run the next re-audit over the current diff. Because Zero Audit 2 produced actionable findings, the consecutive zero-actionable counter is reset to 0. Two clean audits are still required before full `pnpm test`/`pnpm build` and final reporting.

### Loop 10 - Zero Audit 3 Findings and Follow-up Implementation

Zero Audit 3 agents completed:

- Deep Explorer and Strict Review: found remaining report-output and share-page permission leakage around send-denied and patient-view-denied roles.
- Refactor/Similarity: found duplicate billing validation-layer contracts, duplicate prescription cycle status labels, and admin-webhook compatibility error helpers that should use shared modules.
- Test Auditor: found missing regressions for direct validation-layer parsing, print-audit POST/loading behavior, invalid cockpit timestamps, and patient timeline conference/operation-history inputs.
- Medical Safety and Privacy: found that report detail still fetched or returned send-support contact metadata for users who could view but not send reports, and that malformed legacy webhook URLs could still echo secrets.

Implemented:

- Added shared `src/types/billing-validation-layers.ts` and reused it from billing validation helpers, billing candidate UI, and billing evidence service code.
- Reused `CYCLE_STATUS_LABELS` from the prescription cycle workspace in patient timeline event construction instead of keeping a local duplicate.
- Added shared API compatibility error helpers in `src/lib/api/response.ts` and reused them from `/api/admin/webhooks`.
- Changed webhook URL display redaction so malformed stored URLs return `[invalid webhook URL]` instead of echoing raw text.
- Changed care-report detail GET so send-denied roles do not trigger prescriber/contact/channel/delivery-rule helper lookups, and delivery record recipient contact is redacted for those roles.
- Changed the report detail UI so external professional suggestions and the patient care-team source panel are disabled for send-denied roles.
- Changed the interprofessional share page so users without report-output permission see only the permission warning, without preview, replies, output actions, communication fetches, or care-team/contact refetches.
- Changed today-workspace billing candidate issue discovery to union a bounded recent scan with bounded blocked-state JSON-path queries so older blocked billing candidates are not missed solely because they are outside the recent cap.
- Changed patient detail route timeline inputs to pass real conference notes and bounded operation history into the canonical timeline builder.
- Hardened dashboard cockpit time formatting so invalid timestamps render a safe placeholder instead of `NaN:NaN`.

Focused validation:

- `pnpm exec vitest run 'src/app/api/care-reports/[id]/route.test.ts' 'src/app/(dashboard)/reports/[id]/page.test.tsx' 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx' 'src/app/api/care-reports/today-workspace/route.test.ts' 'src/app/api/patients/[id]/route.test.ts' 'src/lib/billing/validation-layers.test.ts' 'src/app/(dashboard)/dashboard/dashboard-cockpit.test.tsx' 'src/app/(dashboard)/reports/[id]/print/page.test.tsx' 'src/app/api/admin/webhooks/route.test.ts' 'src/server/services/outbound-webhook.test.ts' 'src/server/services/patient-detail.test.ts' 'src/server/services/export-audit.test.ts' 'src/app/(dashboard)/billing/candidates/billing-candidates-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 13 files / 175 tests.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- Touched-file ESLint for the Loop 10 source/test files: initially failed on unused type imports in `billing-evidence/core.ts`, then passed after removing them.
- `pnpm typecheck`: passed.

Next loop:

- Run Zero Audit 4. Because Zero Audit 3 produced actionable findings, the consecutive zero-actionable counter is still 0. Two clean audits are still required before full `pnpm test`/`pnpm build` and final reporting.

### Loop 11 - Zero Audit 4 Findings and Follow-up Implementation

Zero Audit 4 agents completed:

- Product Discovery/Test: found a real patient timeline gap where patient-level conference notes were skipped when the patient had no cases.
- Refactor/Similarity: found duplicate patient timeline query filters, hardcoded billing validation-layer JSON paths, and duplicated report-send recipient validation.
- Strict Review/Privacy: found high-priority billing/payment metadata leakage through patient detail and timeline APIs for roles without `canManageBilling`, plus external professional suggestion API access still using `canReport`.
- Medical Safety: reported no additional medical-safety blockers after the prior print/report-output fixes.

Implemented:

- Added shared `src/server/services/patient-detail-timeline-query.ts` for patient-level conference-note scoping and patient timeline operation-history filters.
- Changed both `GET /api/patients/[id]` and `getPatientTimelineData()` to always include patient-level `conferenceNote(patient_id, case_id=null)` records even when the patient has no assigned cases.
- Changed patient detail route and timeline service so billing refs, billing evidence, billing blockers, billing candidates, billing payment-profile audit history, billing collection audit history, and billing invoice/receipt export history are read only when `canManageBilling` is true.
- Changed `/api/external-professionals/suggestions` from `canReport` to `canSendCareReport`, aligning direct API access with report output/delivery-support UI boundaries.
- Changed report detail UI so direct `送付` remains available with `can_send=true`, while `他職種共有` and the share composer require both `can_send` and `can_create_external_share`.
- Added shared `src/lib/reports/care-report-send-validation.ts` and reused it from the send API route and report detail send form, removing duplicated recipient required/email/role validation.
- Changed today-workspace blocked billing candidate JSON-path filters to build from `BILLING_VALIDATION_LAYER_KEYS` instead of hardcoded layer names.
- Added regression coverage for no-case patient-level conference notes, non-billing-role patient timeline redaction, external professional suggestion send permission, report external-share partial permission, share follow-up task partial permission, malformed facility-batch patient ids, and shared send/timeline query helpers.

Focused validation:

- `pnpm exec vitest run 'src/app/api/patients/[id]/route.test.ts' src/server/services/patient-detail.test.ts src/server/services/patient-detail-timeline-query.test.ts src/app/api/external-professionals/suggestions/route.test.ts src/app/api/care-reports/today-workspace/route.test.ts src/lib/reports/care-report-send-validation.test.ts 'src/app/api/care-reports/[id]/send/route.test.ts' 'src/app/(dashboard)/reports/[id]/page.test.tsx' 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 9 files / 157 tests.
- Touched-file ESLint for the Loop 11 source/test files: passed.
- `git diff --check`: passed.
- `pnpm typecheck`: passed.

Blocked or deferred from Zero Audit 4:

- Admin webhook transaction rollback integration test remains blocked by lack of real Prisma transaction/DB fixture in this unit-test pass.
- Browser proof for print audit/report share/dashboard freshness remains blocked until authenticated browser runtime and seeded data are available.
- Production cardinality/index proof for today-workspace JSON-path billing scans remains blocked without seeded/live DB and migration/index decisions.

Next loop:

- Run Zero Audit 5 over the current diff. Because Zero Audit 4 produced actionable findings, the consecutive zero-actionable counter is still 0. Two clean audits are still required before full `pnpm test`/`pnpm build` and final reporting.

### Loop 12 - Zero Audit 5 Findings and Follow-up Implementation

Zero Audit 5 agents completed:

- Deep Explorer/Strict Review/Privacy: found remaining care-report output leakage through communication-request APIs, stored report PDF URLs, report-purpose file APIs, print content prefetch, and webhook delivery persistence/Data Explorer surfaces.
- Refactor/Similarity: found `inferCareReportTargetRole()` living in a Prisma-dependent module and billing validation-layer snapshot typing exported under the full-layer name.
- Test Auditor: requested direct permission, audit-failure, webhook redaction, file-handle redaction, and route-catalog coverage.
- Medical Safety: prioritized audited print output and care-report communication/request response boundaries.

Implemented:

- Added care-report-specific `canSendCareReport` gating to communication-request list/create/detail/update/responses/resolve-followup/export flows while preserving existing non-care-report `canReport` behavior and assignment checks.
- Redacted `pdf_url` from care-report list/detail responses for roles without report-output permission.
- Changed report-purpose stored file download/complete access to require `canSendCareReport`, and report-purpose presigned upload access to require `canAuthorReport`.
- Changed print audit POST to return the printable report only after export audit persistence succeeds; changed the print page to use the audit response as its only report-content data source.
- Redacted persisted webhook delivery URLs and denied `WebhookDelivery.url`/`payload` from Data Explorer projections.
- Moved pure care-report target-role inference into client-safe `src/lib/reports/care-report-target-role.ts` and reused it from server routes and delivery-rule code.
- Corrected billing validation-layer reexports so full `BillingValidationLayers` and partial `BillingValidationLayerSnapshot` have distinct names at call sites.
- Updated route catalog metadata for care-report PDF output to `canSendCareReport`.

Focused validation:

- `pnpm exec vitest run src/app/api/communication-requests/route.test.ts 'src/app/api/communication-requests/[id]/route.test.ts' 'src/app/api/communication-requests/[id]/responses/route.test.ts' 'src/app/api/communication-requests/[id]/resolve-followup/route.test.ts' src/app/api/communication-requests/export/route.test.ts 'src/app/api/care-reports/[id]/route.test.ts' src/app/api/care-reports/route.test.ts 'src/app/api/care-reports/[id]/print-audit/route.test.ts' 'src/app/(dashboard)/reports/[id]/print/page.test.tsx' src/app/api/files/presigned-upload/route.test.ts src/server/services/file-storage.test.ts src/server/services/outbound-webhook.test.ts src/server/services/data-explorer.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/reports/care-report-target-role.test.ts src/lib/billing/validation-layers.test.ts --reporter=dot --testTimeout=30000`: passed, 16 files / 256 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: initially failed on print-page test and communication responses route formatting, then passed after targeted Prettier.
- `git diff --check`: passed.

Blocked or deferred from Zero Audit 5:

- Patient detail/timeline query fan-out still has larger consolidation potential, but the high-risk privacy and report-output boundaries from the audit were prioritized first; it should be re-checked by the next audit before deciding whether a safe in-session extraction remains.
- Admin webhook rollback integration and authenticated browser proof remain blocked by the same missing real Prisma/browser fixtures noted in Loop 11.

Next loop:

- Run Zero Audit 6 over the current diff. Because Zero Audit 5 produced actionable findings, the consecutive zero-actionable counter is still 0. Two clean audits are still required before full `pnpm test`/`pnpm build` and final reporting.

Goal started: 2026-06-18 JST

Objective: Preserve existing CareViaX behavior while improving runtime speed, response performance, resource efficiency, exception tolerance, async safety, and stability until actionable candidates are exhausted and two consecutive Zero Candidate Audits pass.

## Session Constraints

- Active goal tool could not be replaced because a previous unfinished goal is still registered in the thread.
- Latest user instruction supersedes the earlier objective for this turn.
- Worktree started dirty with pre-existing refactor/validation changes from the interrupted previous turn. These changes are preserved and treated as baseline state for this performance/reliability goal.
- Vercel CLI is not installed; current task is not Vercel-specific.

## Loop 0 - Baseline

### Required Context Checked

- `AGENTS.md`
- `README.md`
- `package.json`
- `.github/workflows/ci.yml`
- `eslint.config.mjs`
- `vitest.config.ts`
- `tsconfig.json`
- `next.config.ts`
- `.codex/ralph-state.md`
- local Next.js 16 route handler and upgrade docs under `node_modules/next/dist/docs/`

### Initial Subagents

- Performance Agent: `019eda3c-c3fb-7520-8b9c-bbb28844b2fa`
- Reliability Agent: `019eda3c-e610-7693-9a52-83363217a4a0`
- Duplication Agent: `019eda3d-0804-7223-b12c-e2f2c7c158fe`
- Frontend Rendering Agent: `019eda3d-282e-71d3-ba04-d9236f1b2906`
- Backend/Data Agent: `019eda3d-4907-7783-941e-aaef06c860a4`
- Async Safety Agent: `019eda3d-6901-73a1-abeb-a9b8b24682ac`
- Test & Benchmark Agent: `019eda3d-8b64-7d93-99a8-9fa889229e82`

### Initial Existing Diff

Pre-existing dirty files at goal start include API validation/date/channel contract changes, PHOS domain error relocation, patient-status audit minimization, route-catalog metadata, and related tests from the interrupted previous turn. These are not reverted.

### Validation Commands Identified

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm date-slices:check`
- `pnpm eventbridge-schedules:check`
- `pnpm phos:deploy-template:validate:artifact`
- E2E and DB-gated checks exist but require local Postgres/server setup or longer browser runs.

### Baseline Results

- `pnpm format:check`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed with 976 files passed / 1 skipped and 7590 tests passed / 1 skipped.
- `pnpm build`: passed with Next.js 16.2.9 webpack build and 272 app routes.
- `perf:smoke`: script exists and is tested, but no local app server/authenticated target was running for a meaningful baseline beyond static inspection.

### Candidate Inventory

Initial subagent results received.

Short-term Actionable:

- Handoff board first GET can race on `org_id + shift_date` create.
- Google route optimization should degrade on non-OK upstream responses instead of surfacing 500.
- Offline evidence photo sync can create duplicate file assets/uploads if upload completion succeeds but visit-record patch fails.
- Report send UI should pass `Idempotency-Key` so existing server ledger is used.
- Typeahead/search inputs should debounce before React Query keys and network calls.
- `communication-events` route needs route-level channel contract tests.
- Date-key and PHOS error compatibility tests should pin broad shared contracts.

Mid-term Actionable:

- `billing-evidence/analytics`, `reject-reason-stats`, and staff/operations metrics should move raw-row aggregation toward DB-side aggregation.
- `staff-workload` should avoid fetching every open task when only top-N per staff is needed.
- `drug-masters` and `medication-cycles` should move offset cursors toward keyset cursors.
- PHOS handler domain-error conversion and Dynamo transaction executor duplication should be consolidated.

Long-term Actionable if still safe in-session:

- Common client action id/idempotency helper across report/visit/billing/dispense mutations.
- Performance smoke non-blocking CI/manual workflow wiring.
- Static guards for date-key regex and legacy PHOS backend imports.

### Blocked Items

- Production-like DB `EXPLAIN (ANALYZE, BUFFERS)` and latency/cardinality proof need live data or a seeded benchmark dataset.
- DDL/index additions need migration planning and explicit schema change review.
- External Google/SES/S3/IAM/quota failure drills need credentials and external service approval.
- Large patient-detail BFF redesign needs product/API/privacy decisions and browser waterfall evidence.
- Exact external email exactly-once semantics need provider/outbox design beyond local DB request ledgers.

### Next Loop Target

Loop 1-4 first pass: fix handoff-board create race, Google Routes non-OK degradation, offline evidence replay duplication, report-send idempotency header, and high-churn typeahead requests with focused tests.

## Loop 1 - Duplicate I/O and Request Stabilization, Pass 1

### Found Candidates

- `GET /api/handoff-board` performed find-then-create without race recovery.
- Report detail send UI did not pass the existing server `Idempotency-Key` contract.
- Typeahead inputs in prescription intake and drug-master operations generated query keys from raw input on every keystroke.

### Implemented

- Added a shared handoff board include object and reused `isPrismaUniqueConstraintError` so concurrent missing-board creates re-read the race winner instead of returning 500.
- Added `Idempotency-Key` headers for single and bulk care-report send mutations.
- Added `useDebouncedValue` and moved drug suggestion, prescription patient search, prescription prescriber-institution search, drug-master search, and formulary template search query keys to debounced values.

### Duplicate I/O Reduced

- Reduced rapid per-character patient, prescriber institution, drug-master, and formulary-template requests to the settled 250 ms search value.
- Removed duplicate local debounce logic from `DrugSuggest` by adopting the shared hook.

### Tests and Validation

- `pnpm exec vitest run src/components/features/pharmacy/drug-suggest.test.tsx 'src/app/(dashboard)/reports/[id]/page.test.tsx' src/lib/offline/evidence-drafts.test.ts`: passed, 3 files / 12 tests.
- `pnpm exec vitest run src/app/api/handoff-board/route.test.ts src/server/services/google-routes.test.ts src/lib/offline/evidence-drafts.test.ts src/components/features/pharmacy/drug-suggest.test.tsx 'src/app/(dashboard)/reports/[id]/page.test.tsx'`: passed, 5 files / 27 tests.
- `pnpm typecheck`: initially failed on unvalidated `fileAssetId` typing in offline evidence sync, then passed after explicit string validation.

## Loop 3 - Rendering Optimization, Pass 1

### Found Candidates

- Typeahead-backed React Query keys changed on each keystroke in multiple UI surfaces.

### Implemented

- Centralized debounce behavior in `src/lib/hooks/use-debounced-value.ts`.
- Kept visible input values immediate while delaying only query keys and network parameters.

### Duplicate Rendering / Recalculation Reduced

- Avoided creating distinct React Query subscriptions for each transient search character in prescription intake, drug suggestion, drug-master list, and template search.

### Tests and Validation

- `src/components/features/pharmacy/drug-suggest.test.tsx` continues to verify debounce timing through the shared hook.
- `pnpm typecheck`: passed after Loop 4 boundary fix.

## Loop 4 - Async Safety, Pass 1

### Found Candidates

- Google Routes non-timeout fetch failures and non-OK responses threw through route planning.
- Offline evidence sync could complete upload/asset creation and then fail visit-record attachment, causing retry to upload the same PHI payload again.

### Implemented

- Normalized Google Routes non-OK and fetch failures to `status: 'unavailable'` using existing `unavailableGoogleRoutePlan`.
- Persisted completed offline evidence `fileAssetId` and `uploadedVisitRecordId` before visit-record PATCH so retries resume attachment without re-uploading.
- Added explicit string validation for completed file asset ids before saving or attaching.

### Duplicate I/O / Side Effects Reduced

- Prevented repeated file upload and file-asset creation after upload completion but before attachment success.
- Converted upstream route-planning failures from exception paths into typed unavailable results.

### Tests and Validation

- Added `src/lib/offline/evidence-drafts.test.ts` for upload-resume and failed-attachment retry metadata.
- Added Google Routes tests for HTTP 429 and fetch failure degradation.
- Added handoff-board race recovery test.
- Added report send idempotency-header test.
- Targeted test set passed: 5 files / 27 tests.

### Blocked Items

- None for this pass.

### Next Loop Target

Loop 2/5/8 pass 1: inspect DB/API aggregation and error-handling consolidation candidates, prioritizing safe high-impact changes with focused tests.

## Loop 4 - Async Safety, Pass 2

### Found Candidates

- The shared realtime SSE stream invoked each event/status listener directly. A throwing consumer listener could abort dispatch for later listeners and push the shared stream toward reconnect/error handling even though the network stream itself was healthy.

### Implemented

- Wrapped event and status listener callbacks in `src/lib/realtime/shared-event-stream.ts` with exception isolation and centralized realtime listener logging.
- Covered event listener and status listener failures in `src/lib/realtime/shared-event-stream.test.ts`, including the non-reconnect expectation for a healthy shared stream.

### Stability Impact

- One broken subscriber can no longer stop other subscribers from receiving realtime events or status transitions for the same shared SSE connection.

### Tests and Validation

- `pnpm exec vitest run src/lib/realtime/shared-event-stream.test.ts`: passed, 1 file / 4 tests.

## Loop 6 - Cache and State Management, Pass 1

### Found Candidates

- `PresenceAvatars` duplicated the presence heartbeat effect even though `usePresenceHeartbeat` already owns the same POST/interval/cleanup responsibility.
- Re-scan found `useCollaborativeForm` still building the same best-effort `/api/presence` POST request shape for active-field updates.
- Re-scan found `VisitRecordForm` still owning direct `online`/`offline` event listeners even though `useNetworkOnline` is the existing shared browser network-state subscription hook.

### Implemented

- Replaced the local `PresenceAvatars` timer/ref/fetch effect with the existing `usePresenceHeartbeat` hook.
- Updated `src/components/features/collaboration/presence-avatars.test.tsx` to verify the shared heartbeat hook receives the correct entity and enabled state.
- Extracted `postPresenceUpdate` from `usePresenceHeartbeat` and migrated `useCollaborativeForm` active-field focus/blur updates to the shared sender.
- Added `src/lib/hooks/use-presence-heartbeat.test.ts` for shared request shape and best-effort network failure behavior.
- Replaced `VisitRecordForm`'s direct `window.addEventListener('online'/'offline')` effect with `useNetworkOnline` plus the existing offline-store `syncOnlineStatus` update.

### Duplicate State / Timer Logic Reduced

- Removed one local interval implementation and one duplicate best-effort presence POST path from the component layer.
- Removed the second hand-built presence POST request payload from collaborative form focus/blur handling while preserving immediate active-field updates.
- Removed one more component-owned browser online/offline listener pair from the visit-record form.

### Tests and Validation

- `pnpm exec vitest run src/components/features/collaboration/presence-avatars.test.tsx src/lib/hooks/use-collaborative-form.test.tsx`: passed, 2 files / 26 tests.
- `pnpm exec vitest run src/lib/hooks/use-presence-heartbeat.test.ts src/lib/hooks/use-collaborative-form.test.tsx src/components/features/collaboration/presence-avatars.test.tsx`: passed, 3 files / 28 tests.
- `pnpm exec vitest run 'src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx'`: passed, 1 file / 8 tests.
- Targeted ESLint over the presence hook/collaborative form/presence avatars files: passed.
- Targeted ESLint over the visit-record form/network hook files: passed.

## Loop 9 - Measurement and Validation, Pass 1

### Found Candidates

- Full `pnpm lint` and `pnpm format:check` picked up local/generated design-sync artifacts (`.ds-sync`, `.design-sync`, `ds-bundle`) even though they are not tracked source files.

### Implemented

- Added local/generated design-sync directories to ESLint global ignores.
- Added the same local/generated prefixes to `tools/scripts/check-format-changed-files.mjs` so format validation matches the repository source boundary.

### Validation Results

- Targeted ESLint over changed source/test files: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- Final `pnpm test`: passed, 981 files / 1 skipped and 7660 tests / 1 skipped.
- Final `pnpm build`: passed, Next.js 16.2.9 webpack build and 272 generated app routes.
- `git diff --check`: passed.

### Re-scan Result

- `/api/presence` POST request construction is now centralized in `postPresenceUpdate`; remaining hits are the shared helper and its callers/tests.
- Shared realtime SSE listener dispatch now catches per-listener exceptions for both event and status callbacks.
- No new tracked-source duplicate timer/request implementation was found in the current collaboration/realtime slice.

## Maintainability Re-audit - Collaboration/Realtime Slice

### Subagents

- Architecture Agent (`019edafa-6aea-7b21-ab32-6ba6e422504c`)
- Refactor/Duplication Agent (`019edafa-7416-7b00-b91e-021d1be854db`)
- Test & Behavior Agent (`019edafa-79fc-72a1-b280-4498cc83cc7f`)
- Strict Review Agent (`019edafa-80ba-7ca3-8f6a-21ebe6a1d48f`)

### Found Candidates

- `PresenceUser` was owned by the UI component `presence-avatars.tsx` while lib hooks imported it.
- Presence response parsing / query key / fetch logic was duplicated in presence avatars, collaborative form, and patient collaboration.
- Collaborator color hashing was duplicated in avatars, field lock indicators, and Yjs cursor overlay.
- `postPresenceUpdate` lived in a hook file despite being a presence API client helper.
- `.design-sync/**` was incorrectly excluded from lint/format checks even though `.design-sync` inputs are tracked source files.
- Realtime listener logging emitted raw `Error` objects.
- Missing regression tests for heartbeat timers, active-field focus/blur POST, visit-record network status sync, and shared presence parsing.

### Implemented

- Added `src/lib/collaboration/presence.ts` as the owner for `PresenceUser`, presence response parsing, query key/URL construction, fetch, POST, and collaborator color selection.
- Migrated `PresenceAvatars`, `useCollaborativeForm`, patient collaboration content/shared helpers, `FieldLockIndicator`, and `CursorOverlay` to the lib-owned presence contract.
- Removed UI-to-lib type dependency on `presence-avatars.tsx`.
- Sanitized realtime listener exception logging to `{ name, message }` instead of raw error object.
- Re-scoped `.design-sync` validation ignores to generated subpaths only and formatted tracked `.design-sync` inputs.
- Added `src/lib/collaboration/presence.test.ts` and expanded heartbeat/collaborative form/visit-record/realtime tests.

### Duplicate Implementations Reduced

- Presence user parsing and malformed-row filtering now has one implementation.
- Presence query key / URL / fetch construction now has one implementation.
- Presence POST request construction now has one implementation under `lib/collaboration`.
- Collaborator color hashing now has one implementation.
- `VisitRecordForm` remains on the shared network-state hook instead of owning online/offline listeners.

### Tests and Validation

- `pnpm exec vitest run src/lib/collaboration/presence.test.ts src/lib/hooks/use-presence-heartbeat.test.ts src/lib/hooks/use-collaborative-form.test.tsx src/components/features/collaboration/presence-avatars.test.tsx 'src/app/(dashboard)/patients/[id]/collaboration/collaboration-content.test.tsx' 'src/app/(dashboard)/patients/[id]/collaboration/collaboration.shared.test.ts' 'src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx' src/lib/realtime/shared-event-stream.test.ts`: passed, 8 files / 58 tests.
- Targeted ESLint over touched source/test/config files and `.design-sync/previews/Button.tsx`: passed.
- `pnpm exec prettier --check .design-sync/previews/Button.tsx .design-sync/config.json .design-sync/NOTES.md`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `pnpm test`: passed, 982 files / 1 skipped and 7668 tests / 1 skipped.
- `pnpm build`: passed, Next.js 16.2.9 webpack build and 272 generated app routes.

---

# New Goal (2026-06-18 JST) — Maintainability Refactoring

Objective: Preserve existing CareViaX behavior while maximizing maintainability, readability, separation-of-concerns, type-safety, and testability. Loop until actionable candidates are exhausted and two consecutive Zero Candidate Audits pass. This supersedes the earlier performance objective for this turn; the prior performance work (Loops 0-4 above) and the pre-existing dirty worktree are preserved as baseline state.

Execution mode: ultracode (xhigh + Workflow orchestration). Main loop owns strategy/decision/integration/validation/report; read-only subagents own investigation/analysis/candidate extraction.

## Loop 0 (Maintainability) - Baseline

### Required Context Checked

- `AGENTS.md` (Ralph-loop rules, whole-repo scope, no-silence/no-weaken-types rules)
- `CLAUDE.md` (stack pinned 2026-03-25, UI/UX SSOT, RLS tenancy model)
- `package.json` scripts (validation commands)
- existing `CODEX_GOAL_PROGRESS.md` (prior performance goal state)

### Validation Commands Identified

- `pnpm lint` (eslint .)
- `pnpm typecheck` (next typegen && tsc --noEmit && tsc -p tsconfig.sw.json)
- `pnpm test` (vitest run)
- `pnpm build` (next build --webpack)
- `pnpm format:check`
- `pnpm date-slices:check`, `pnpm eventbridge-schedules:check`
- E2E / DB-gated checks require local Postgres (:5433) + running server — out of fast-loop scope.

### Repo Signals (audit input)

- Source file counts: app 1212, lib 397, server 317, components 240, phos 229, types 23.
- Largest non-test source files (refactor candidates): drug-master-content.tsx (4161), card-workspace.tsx (4053), schedule-proposals-content.tsx (3302), prescription-intake-form.tsx (2963), api/patients/[id]/route.ts (2729), server/jobs/daily.ts (2489), visit-record-form.tsx (2451), patient-form.tsx (2280), shifts-content.tsx (2255), billing-evidence/core.ts (2241), and ~16 more >1300 lines.

### Baseline Run

- Prior performance-goal baseline (same dirty worktree, earlier this session) recorded: lint/typecheck/test/build all passed.
- Re-confirm (task `b9wcup1sa`): `typecheck` exit 0, `test` exit 0, but `lint` exit 1 — one NEW pre-existing failure surfaced in the worktree.

### Baseline Fix (pre-existing failure, in-session actionable)

- `src/lib/hooks/use-debounced-value.ts:10` failed `react-hooks/set-state-in-effect` (synchronous `setState` inside the effect for the `delayMs<=0` branch). This file was added by the prior performance Loop 3; the failure was pre-existing, not introduced by this goal.
- Root-cause fix (no rule suppression, behavior preserved): the `delayMs<=0` branch now derives the live value during render (`return delayMs <= 0 ? value : debouncedValue`) instead of calling `setState` in the effect. All callers pass a positive constant delay, so the returned value is identical; the only removed behavior is the redundant cascading re-render.
- Added regression test `src/lib/hooks/use-debounced-value.test.ts` (4 cases: immediate initial value, debounce window timing, rapid-change coalescing, zero/negative-delay live passthrough).
- Re-validation: `pnpm exec eslint` on both files clean; `pnpm lint` full run exit 0; targeted vitest (hook + drug-suggest) 7/7 passed. Baseline now fully green (lint/typecheck/test).

### Initial Audit (read-only, parallel)

- Workflow `careviax-maintainability-audit` launched (task `wyzhr46my`, run `wf_5d2ad2d6-80e`).
- Dimensions: Architecture, Duplication, Type&Contract, Behavior&Test, DeadCode, Dependency → Synthesis (deduped, prioritized candidate inventory + recommended first batch).

### Status

- Awaiting audit synthesis + baseline re-confirm before deciding the first implementation batch (per "wait for all subagents before deciding" rule).

### Next Loop Target

- On audit return: lock candidate inventory, implement `recommendedFirstBatch` (behavior-preserving, test-backed), then re-audit. Do not stop until two consecutive Zero Candidate Audits.

## Audit Result (read-only, task `wyzhr46my`, 7 agents)

Synthesis produced 12 candidates (10 actionable, 2 blocked). recommendedFirstBatch = C01-C08. Full inventory saved to `/tmp/cvx-audit-plan.json` + `/tmp/cvx-audit-dimensions.json`. The synthesis correctly dropped the use-debounced-value finding (test now exists from Loop 0).

Actionable: C01 dead modules, C02 dead exports, C03 type-safety (Window aug + report-edit-form), C04 billing test pins, C05 tracker/claim test pins, C06 dup consolidation (status labels/yen/date/audit), C07 move visit-schedule-conflicts to lib + planner test pins, C08 db barrel normalization, C09 split daily.ts/billing core.ts, C10 extract oversized routes/component into existing services.
Blocked: C11 (diverged user-visible label strings — product/UX sign-off), C12 (repo-wide follow-ups: withAuthContext×112, apiFetch×447, optimistic-lock×43, lib→server inversions, phantom deps, FHIR adapter — each needs contract/product/install decision).

## Loop 7 (Maintainability) - Dead Code, Pass 1 [C01, C02]

### C01 — Deleted 7 whole dead modules (verified 0 importers via grep, full repo incl. tools/prisma)

- `src/lib/utils/session.ts`, `src/lib/api/query-keys.ts`, `src/lib/api/hooks.ts`, `src/lib/stores/patient-list-store.ts`, `src/lib/i18n/labels.ts`, `src/lib/push-subscription.ts`, `src/lib/auth/index.ts` (dead barrel, exact `@/lib/auth` specifier = 0 importers).
- Removed now-empty `src/lib/i18n/`.

### C02 — Removed dead exports from live modules (verified 0 external refs per symbol)

- `app-env.ts`: removed `isProduction/isStaging/isDevelopment/isDebug/perEnv`; de-exported `AppEnv` type (0 external refs, still used by `APP_ENV` annotation); kept `APP_ENV`. (Confirmed the 2 `isProduction` hits were a local const in a tools script, not this export.)
- `cloudwatch.ts`: removed `putCount`/`putLatency`; kept `putMetrics` + re-exported `StandardUnit`/`MetricDatum` (consumed by `performance.ts` + test).
- `encryption.ts`: removed `encryptIfPresent`/`decryptIfPresent`; kept `encrypt`/`decrypt`.
- `sensitive.ts`: removed `maskAddress`/`maskPersonName`; kept the live mask helpers.
- `use-media-query.ts`: removed `useIsTablet`/`useIsDesktop`; kept `useMediaQuery`/`useIsMobile` (mock-consumed).
- `jahis-qr.ts`: removed dead `decodeShiftJIS` and the unreachable `buildJahisQRText_placeholder_removed` stub.

### Validation

- `pnpm typecheck` (full: next typegen + tsc + tsc sw): exit 0.
- `pnpm exec eslint` on all 6 changed files: exit 0.
- `pnpm exec vitest run` cloudwatch + jahis-qr tests: 5/5 passed.

### Next Loop Target

- C03 type-safety (Window augmentation + report-edit-form union), then C04/C05 characterization tests (pin behavior before C09/C10 structural splits), then C06 dup consolidation, C07 file move, C08 db barrel.

## Loop 4 (Maintainability) - Type Safety, Pass 1 [C03]

### Implemented

- Added `src/types/phos-demo-hooks.d.ts` — ambient `interface Window` augmentation declaring the 6 dev/demo seed hooks (`__phosSeedPresenceDemo`, `__phosSeedEvidenceDemo`, `__phosSeedVisitModeDemo`, `__phosSeedVoiceMemoDemo`, `__phosSeedOfflineSyncDemo(mode?)`, `__phosSeedPeriodReviewDemo`).
- Replaced `const target = window as unknown as Record<string, unknown>` with `const target = window` at all 6 attach sites (collaboration, evidence-gallery, visit-record-form, voice-memo, offline-sync, prescription-intake-form). Behavior identical (same property set/deleted on window); names now type-checked.
- `report-edit-form.tsx`: retyped `pendingFields` state from `Record<string, unknown>` to `Partial<PhysicianFields & CareManagerFields>` (the two field shapes share only `self_management: string`, so the partial intersection is sound). Removed two `as unknown as Record<string, unknown>` onChange casts and the `pendingFields as PhysicianFields`/`as CareManagerFields` reads in `buildUpdatedContent`. All `f.x ?? base.x` accesses unchanged → byte-identical payload.

### Validation

- `pnpm typecheck`: exit 0.
- `pnpm exec eslint` on all 8 changed files: exit 0.
- `pnpm exec vitest run src/components/features/reports/`: 4 files / 6 tests passed (incl. report-edit-form.test.tsx).

### Next Loop Target

- C04 + C05 characterization tests via parallel workflow (5 disjoint test files), then C06/C07/C08.

## Loop 6 (Maintainability) - Test容易性, Pass 1 [C04, C05] — DONE (60 tests added)

- Parallel workflow `wtwb40t1y` (5 lanes, each edits only its own test file + verifies via `vitest run <file>`) — all 5 GREEN:
  1. NEW `billing-evidence/candidate-regeneration.test.ts` (status resolution + optimistic-lock persist branches).
  2. EXTEND `billing-evidence/core.test.ts` (workflow-state read/write round-trip, buildValidationLayers, japanMonthRangeForBillingMonth JST boundaries).
  3. EXTEND `billing-evidence/duplicate-interaction.test.ts` (generateHomeDuplicateInteractionCandidates orchestration).
  4. EXTEND `patient-status-tracker.test.ts` (NOTIFICATION_TRIGGERS matrix: business/high/normal/no-trigger/no-change).
  5. EXTEND `claimCandidateLifecycle.test.ts` (reason_code VALIDATION_ERROR + reason_note trim/omit).
- Results: candidate-regeneration +16, core +30, duplicate-interaction +6, patient-status-tracker +4, claimCandidateLifecycle +4 = 60 tests. Lanes correctly followed SOURCE over hypotheses (e.g. validation layers live nested under `source_snapshot.validation_layers`; `isRegenerationLocked` short-circuits reviewed records before any updateMany).
- Post-integration `pnpm typecheck` initially failed (exit 2): candidate-regeneration.test.ts `buildSnapshot` returned `Record<string, unknown>` (not assignable to `Prisma.JsonValue`). vitest had not caught it (no type pass). Fixed: typed `buildSnapshot(workflow: Prisma.JsonObject): Prisma.JsonObject` — no rule suppression, runtime unchanged (16/16 still green).
- LESSON: delegated test lanes verify via vitest only (no tsc), so the orchestrator MUST run full `pnpm typecheck` after integrating delegated tests.

## Loop 9 (Maintainability) - Validation gate after C01-C07 + C04/C05

- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0 (after the buildSnapshot fix).
- `pnpm test`: exit 0 — 980 files passed / 1 skipped, 7657 tests passed / 1 skipped (baseline was 7590; +67 from the 60 characterization tests + the Loop 0 use-debounced-value test + others).

## Loop 1/8 (Maintainability) - Structure/Boundary, Pass 1 [C07] — source done, validation pending

### Implemented (C07: client→server layer violation fix)

- `git mv src/server/services/visit-schedule-conflicts.ts → src/lib/schedules/visit-schedule-conflicts.ts`. The module is pure (only imports a type from `@/lib/validations/visit-schedule`, no prisma/db/server-only), and its sole importer is the client component `conflict-resolution-content.tsx`. Moving it to the leaf `lib/` layer removes the only client→server _value_ import in the repo.
- Updated `conflict-resolution-content.tsx` import path + the doc comment to `@/lib/schedules/visit-schedule-conflicts`. No other importers existed.
- Deferred (Low/short): pinning extra schedule-day-planner pure builders in its existing test — to be picked up in a later test pass.

### Validation

- Confirmed green in the Loop 9 gate above (lint/typecheck/test all exit 0) — the moved module resolves at its new `@/lib/schedules` path and all consumers pass.

## Loop 2 (Maintainability) - Duplication, Pass 1 [C06]

### C06a — Status-label maps consolidated onto canonical `@/lib/constants/status-labels`

- `management-plan-panel.tsx`: deleted byte-identical inline `caseStatusLabel`; now `import { CASE_STATUS_LABELS as caseStatusLabel }`.
- `cases-tab.tsx`: deleted byte-identical inline `caseStatusLabel` AND `caseStatusVariant`; now alias-imports `CASE_STATUS_LABELS`/`CASE_STATUS_VARIANTS`. Call sites unchanged.
- Verified both inline maps were byte-identical to the canonical (6 keys, same Japanese strings/variants) before replacing — zero render change.

### C06b — Canonical yen formatter

- Created `src/lib/ui/currency-format.ts` exporting `formatYen(value, fallback = '—')`.
- 4 local formatters now delegate (logic centralized, fallback preserved per call site, call sites unchanged): `patient-home-operations.ts#formatCurrency` ('未記録'), `visit-record-form.tsx#formatVisitBillingAmount` ('未記録'), `pca-pumps-content.tsx#yen` ('—'), `pdf-documents.tsx#formatPdfCurrency` ('—').
- NOT migrated (intentional): `card-workspace.tsx:1866` (uses `collectedAmount ?` truthy + `Number()` coercion → differs from `== null` for 0) and `billing-candidates-content.tsx:565` (one branch of a nested ternary). Converging would change 0/empty handling or hurt readability — not byte-identical.

### C06c — Date formatter consolidated

- `patient-history-summary.tsx`: deleted local `formatDate` (`format(parseISO(value),'yyyy/MM/dd',{locale:ja})`), now `import { formatDateLabel as formatDate }`. Identical output for valid dates; more robust (no throw) on malformed input. Removed now-unused `date-fns`/`ja` imports.

### C06d — Raw auditLog.create → createAuditLogEntry (partial, deliberate)

- MIGRATED: `patient-status-tracker.ts:256` — its `db: DbClient = typeof prisma | Prisma.TransactionClient` satisfies the helper's `AuditLogWriter`. Byte-equivalent (helper adds `ip_address/user_agent: undefined` → Prisma omits; the lane-4 test uses `objectContaining` and still passes 6/6).
- INTENTIONAL NON-CONSOLIDATION: `export-audit.ts:36` (`db: AuditClient`) and `billing-evidence/core.ts:2216` (`tx: CloseBillingCandidatesTx`) use hand-rolled narrow DI/test-seam client types whose `auditLog.create` is NOT structurally assignable to `Prisma.TransactionClient['auditLog'].create`. Routing them through the Prisma-shaped `createAuditLogEntry` would require loosening the shared helper's contract (used by 84 sites) or casting — a type weakening not justified by this Low-priority shape dedup. Recorded per the "don't blur responsibility / don't weaken types" rule. Could be revisited if the helper is intentionally widened to a structural writer type.

### Validation

- `pnpm exec eslint` on all C06 changed files: exit 0.
- `pnpm typecheck`: exit 0 (run twice — after C06a/b/c and after C06d).
- `pnpm exec vitest run patient-status-tracker.test.ts`: 6/6 (audit assertions intact post-migration).

### Next Loop Target

- C08 (db barrel normalization: 13 `@/lib/db` consumers → `@/lib/db/client`/`@/lib/db/rls`, delete `src/lib/db/index.ts`), then C09 (split daily.ts + billing core.ts), then C10 (extract oversized routes/component).

## Loop 8 (Maintainability) - Dependency/Boundary, Pass 1 [C08]

### Implemented — single canonical Prisma entry point

- All 13 barrel consumers rewritten `import { prisma } from '@/lib/db'` → `from '@/lib/db/client'` (all 13 imported only `prisma`; none used `withOrgContext` via the barrel). Files: audit-logs/export route, dashboard/page, and 11 server/jobs + report-reminders.
- Deleted `src/lib/db/index.ts` (the dual entry point). `@/lib/db/client` (prisma, 303 callers) and `@/lib/db/rls` (withOrgContext, 186 callers) are now the sole canonical entries.
- DOWNSTREAM (not in the audit's "13 import lines" estimate): 10 test files did `vi.mock('@/lib/db', ...)`. With sources no longer importing the barrel, those mocks were dead. Updated all 10 to `vi.mock('@/lib/db/client', ...)` (each only mocked `prisma`, which `@/lib/db/client` exports; `getPrismaClient` has no external importers, so the `{ prisma }` factory is sufficient).

### Validation

- `pnpm typecheck`: exit 0.
- `pnpm exec vitest run` on the 10 affected job/audit test files: 10 files / 59 tests passed.
- Full-suite gate: see Loop 9 (Pass 2) below.

## Loop 9 (Maintainability) - Validation gate Pass 2 (after C06+C07+C08) + regression fix

- `pnpm lint`: exit 0. `pnpm typecheck`: exit 0.
- `pnpm test` (full): 1 failed initially — `src/__tests__/audit-log-conventions-static.test.ts` ("reviewed allowlist"). Root cause: C06d migrated patient-status-tracker's raw `auditLog.create` to `createAuditLogEntry`, so its file dropped out of the raw-audit-write allowlist (6→5). This is the intended improvement; synced the static allowlist by removing `patient-status-tracker.ts` (remaining raw writers: audit-entry.ts [the helper], security-events.ts, billing-evidence/core.ts, export-audit.ts, visit-brief.ts). Re-ran: 1/1 green.
- NOTE: the full-suite gate caught a regression that per-file validation missed (static convention test) — full `pnpm test` is required at each loop boundary, not just targeted tests.
- Net test count after fix: 7657 pass / 1 skip (1 prior failure resolved).

## Loop 1 (Maintainability) - Structure, Pass 2 [C09a] — daily.ts split DONE

- Split the 2489-line `src/server/jobs/daily.ts` god-module into `src/server/jobs/daily/` (cohesive domain modules: shared, prescriptions, pca-pumps, visits, followups, preparation, billing, conferences, reports, emergency, visit-support, compliance-expiry, patient-status, cleanup, orchestrator). `daily.ts` is now a thin barrel preserving the IDENTICAL public surface (31 symbols). Function bodies moved verbatim from `git HEAD` (no logic/signature/string change).
- Verified: `pnpm typecheck` exit 0; `pnpm exec vitest run daily.test.ts` 31/31; full pre-push gate (lint+typecheck+test) green — 980 files / 7657 tests pass, 1 skip.
- Note: a concurrent session was racing on the same split; the agent rebuilt `daily/` atomically from `git HEAD` and re-verified. Final state stable.

### Pre-push validation (for the commit requested by the user)

- `pnpm lint` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (7657 pass / 1 skip). Tree is green and safe to commit/push.

### Next Loop Target

- C09b (split `billing-evidence/core.ts` 2241 into siblings via barrel) + C10 (extract oversized route/component logic into existing services) remain — to continue after this commit/push. (`patients/[id]` route → patient-detail; `care-reports/[id]/send` → idempotency/delivery; `visit-preparations` → detail service; drug-master-content → hook). Both are larger structural moves backed by the C04/C05 characterization pins; to be executed with per-step typecheck + targeted tests.

## 20260618-2332 JST - Realtime/Presence Maintainability + Performance Loop

### Implemented

- Consolidated presence read policy into `usePresenceUsers`, backed by `presence-api-client` and pure `presence-contract`; migrated `PresenceAvatars`, `useCollaborativeForm`, and patient collaboration content away from duplicated query/SSE/fallback polling logic.
- Extracted `useRealtimeInvalidation` and simplified `useRealtimeQuery` to reuse it; migrated notifications, handoff board, admin realtime, and prescriptions infinite-query invalidation to the shared realtime invalidation contract where appropriate.
- Changed presence SSE handling from full `/api/presence` refetch on every `presence_update` to cache patching via `readPresenceUpdateEvent` + `mergePresenceUserUpdate`; disconnected/failure fallback polling remains.
- Debounced shared stream reconnects when presence target sets change in a burst, reducing org-wide SSE abort/reconnect churn from rapid presence mount/unmount.
- Fixed prescriptions workspace realtime event contract to invalidate on actual backend `workflow_refresh` broadcasts instead of the non-emitted `prescription_intake_created` event.
- Narrowed handoff realtime task invalidation from broad `['tasks']` prefix to `['tasks','handoff-confirmation',orgId]` while leaving explicit mutation refresh behavior unchanged.
- Split pure UI presence helpers/types (`presence-contract`) from transport helpers (`presence-api-client`); added static regression coverage so visual collaboration atoms do not import the API transport layer.

### Subagent Review Results Addressed

- Test Auditor High: denied collaboration token now has test coverage proving presence stream disabled, `presenceData` empty, no post-focus presence POST, and no extra presence GET after denial.
- Test Auditor Medium: added missing-org disabled coverage for prescriptions, notifications, admin realtime, and handoff.
- Test Auditor Medium: strengthened notifications/admin cache merge tests for duplicate handling, timestamp ordering, and caps.
- Performance Auditor Medium: removed N x M presence GET refetch behavior by patching cache from presence payloads.
- Performance Auditor Medium: batched presence target reconnect aborts.
- Performance Auditor Low: narrowed handoff realtime task invalidation.
- Strict Reviewer P1: fixed prescriptions realtime event mismatch.
- Strict Reviewer P3: separated pure presence contract from API transport.

### Validation So Far

- Focused realtime/presence suites passed after each slice, latest: 10 files / 70 tests passed.
- Targeted ESLint over touched realtime/presence/prescriptions files: exit 0.
- `pnpm typecheck`: exit 0.
- Final gates after subagent follow-ups: `pnpm format:check` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0; `pnpm date-slices:check` exit 0; `pnpm eventbridge-schedules:check` exit 0; `pnpm test` exit 0 with 985 files passed / 1 skipped and 7689 tests passed / 1 skipped; `pnpm build` exit 0 for 272 app routes; `git diff --check` exit 0.

### Rescan Result

- `rg` rescan found direct `useRealtimeEvents` only inside `use-realtime-invalidation`; presence fetch/query helpers only inside `presence-api-client` and `usePresenceUsers`; visual collaboration atoms now import only `presence-contract`.
- Remaining actionable candidates move outside this slice: larger `useCollaborativeForm` CRDT/provider decomposition and offline draft hook commonality need separate characterization before structural changes.

## 20260618-2343 JST - Collaborative Form Responsibility Split

### Implemented

- Extracted room-token client contract into `src/lib/collaboration/room-token-client.ts`:
  - token response parser
  - Retry-After parser
  - bounded retry delay calculation
  - `/api/collaboration/room-token` fetch classifier (`ok`, `access-denied`, `transient-error`)
- Added `src/lib/collaboration/room-token-client.test.ts` for malformed payloads, Retry-After seconds/date parsing, capped backoff, success request shape, denied responses, transient 429, malformed JSON, and expired tokens.
- Extracted Yjs provider/document/awareness lifecycle from `useCollaborativeForm` into `src/lib/hooks/use-yjs-collaboration-room.ts`.
- Reduced `useCollaborativeForm.ts` to the integration responsibilities it owns: presence data access, access-denied state, active-field presence posting, and `registerCollaborative` wiring.

### Validation

- Focused `pnpm exec vitest run src/lib/collaboration/room-token-client.test.ts src/lib/hooks/use-collaborative-form.test.tsx`: exit 0, 2 files / 30 tests passed.
- Targeted ESLint over `room-token-client`, `use-yjs-collaboration-room`, `use-collaborative-form`, and related tests: exit 0.
- `pnpm typecheck`: exit 0.
- `wc -l`: `use-collaborative-form.ts` now 140 lines; extracted `use-yjs-collaboration-room.ts` 373 lines and `room-token-client.ts` 119 lines.

### Final Validation

- `pnpm format:check`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm date-slices:check`: exit 0.
- `pnpm eventbridge-schedules:check`: exit 0.
- `pnpm test`: exit 0, 986 files passed / 1 skipped and 7694 tests passed / 1 skipped.
- `pnpm build`: exit 0, 272 app routes generated.
- `git diff --check`: exit 0.

### Rescan Result

- `rg` rescan shows room-token parsing/fetch/backoff now lives in `room-token-client`; `useCollaborativeForm` no longer owns direct provider creation and delegates Yjs provider/document/renewal lifecycle to `useYjsCollaborationRoom`.
- No direct realtime/presence duplicate implementation resurfaced in the touched collaboration paths.
- Next highest-value executable candidate remains offline draft hook commonality; it needs characterization before any extraction to avoid merging distinct offline persistence semantics.

## 20260619-0004 JST - Offline Draft/Sync Performance + Reliability Loop

### Subagent Findings Integrated

- Refactor Agent: identified duplicated encrypted draft load/save/clear shape, duplicated legacy SOAP plaintext purge, autosave lifecycle commonality, and online sync listener duplication.
- Performance Agent: prioritized the hot-path issue where visit record form polling called full `refreshSyncState()`, forcing sync queue detail decryption/JSON parsing every 5 seconds.
- Concurrency Agent: identified stale queue success deleting newer visit drafts and non-atomic draft upsert patterns.
- Test Agent: identified missing direct voice memo storage tests, missing v8 offline DB migration coverage, and missing prescription/SOAP draft scope/update/clear tests.

### Implemented

- Split offline store refresh into lightweight `refreshSyncCount()` and detailed `refreshSyncState()`; migrated visit record form's 5-second polling to count-only refresh while leaving `/offline-sync` on detailed refresh.
- Added `offline-store` tests proving count-only refresh does not call `listSyncQueueItems()` and therefore avoids queue payload decrypt/parse work.
- Guarded sync queue success cleanup with a current-item check; if a queue row was changed or replaced while an older POST was in flight, the old success no longer deletes the refreshed queue item or scoped visit draft.
- Wrapped SOAP and prescription draft save upsert paths in Dexie transactions without changing snapshot or scope semantics.
- Consolidated duplicated legacy plaintext SOAP field purge into `src/lib/offline/soap-draft-legacy.ts`, reused by both DB migration and SOAP draft save updates.
- Changed evidence draft summary/sync candidate reads to use the new `retryCount` index path, avoiding unindexed all-table scans for retry-limited sync work.
- Added Dexie v9 schema to index evidence draft `retryCount`; v8 data is preserved through migration.
- Limited `/offline-sync` patient-name resolution to schedule IDs present in the current pending queue instead of decrypting every `visitBriefCache` row, and added error handling for initial refresh failures.
- Added direct storage tests for voice memo drafts and expanded offline DB migration/draft hook regression tests.

### Validation

- `pnpm exec vitest run src/lib/stores/offline-store.test.ts src/lib/stores/sync-engine.test.ts src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx src/lib/offline/voice-memo-drafts.test.ts src/lib/stores/offline-db.test.ts src/app/(dashboard)/offline-sync/offline-sync.shared.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`: exit 0, 8 files / 54 tests passed before evidence index follow-up.
- `pnpm exec vitest run src/lib/offline/evidence-drafts.test.ts src/lib/offline/evidence-drafts.shared.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/stores/sync-engine.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx`: exit 0, 8 files / 47 tests passed after evidence index follow-up.
- Targeted ESLint over touched offline sync/draft files: exit 0.
- `pnpm typecheck`: exit 0.

### Rescan Result

- `refreshSyncCount()` is now used by visit record polling; detailed `refreshSyncState()` remains for `/offline-sync` and post-mutation refreshes.
- Legacy SOAP plaintext purge has a single implementation.
- Evidence draft sync now uses `retryCount` index; boolean `synced` index was avoided after focused test exposed IndexedDB `DataError` for boolean key range usage.
- Remaining actionable candidates: sync queue claim/lease for cross-tab replay, PHOS queue dedupe races, autosave hash-skip/common timer hook, and additional evidence sync failure/retry tests. Blocked/deferred: voice memo server sync/STT and full dashboard/PHOS queue engine unification require product/external-service design decisions.

## 20260619-0123 JST - Offline Sync Post-Review Hardening + Full Gate

### Post-Review Findings Addressed

- Strict Review High: production imports of new SOAP legacy purge helper and new offline tests are now represented in the working tree and included in validation scope; no clean-checkout missing-module issue remains as long as these new files are included with the change set.
- Strict Review High/Medium: `deleteSyncedQueueItem()` is now a transaction-scoped compare-and-delete operation. It compares payload/scope/entity/createdAt plus `retryCount`, `lastError`, `conflict_state`, and `conflict_payload`, and returns `deleted`, `missing`, or `stale` instead of silently no-oping.
- Test Auditor High: normal sync and conflict overwrite paths now both verify stale queue rows are not deleted and stale overwrite is reported as a failure message instead of success.
- Strict Review Low: Dexie v9 evidence migration now normalizes malformed legacy evidence rows with missing/non-finite `retryCount` to `0` and missing/non-boolean `synced` to `false`, preserving uploaded file metadata.
- Test Auditor Medium/Low: added count-refresh timestamp/failure immutability coverage, retry-index filtering coverage, and a fake-indexeddb voice memo transaction rollback test.

### Implemented

- Changed sync completion cleanup to run inside `offlineDb.transaction('rw', syncQueue, visitDrafts, ...)`.
- Changed `processSyncQueue()` so stale successful responses are not counted as synced.
- Changed `overwriteVisitRecordConflict()` so stale completion returns `{ ok: false }` with a refresh/retry message.
- Added `readDateTime()` to make completion identity tolerant of Date/string/number stored timestamps without weakening type contracts.
- Added v9 Dexie `.upgrade()` normalization for evidence draft retry/synced fields.
- Added `voice-memo-drafts.integration.test.ts` to prove old voice memo drafts survive replacement add failure.

### Validation

- Focused post-review tests: `pnpm exec vitest run src/lib/stores/sync-engine.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/offline/evidence-drafts.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/offline/voice-memo-drafts.integration.test.ts --reporter=dot --testTimeout=30000` passed with 6 files / 32 tests.
- Broader offline target tests: `pnpm exec vitest run src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx src/app/(dashboard)/offline-sync/offline-sync.shared.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx src/lib/stores/sync-engine.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/offline/evidence-drafts.test.ts src/lib/offline/evidence-drafts.shared.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/offline/voice-memo-drafts.integration.test.ts --reporter=dot --testTimeout=30000` passed with 11 files / 73 tests.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed with 989 files passed / 1 skipped and 7719 tests passed / 1 skipped.
- `pnpm build`: passed, 272 app routes generated.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `git diff --check`: passed.

### Rescan Result

- `rg` confirms visit-record polling uses `refreshSyncCount()` while detailed queue decryption remains scoped to `/offline-sync` and explicit post-mutation refreshes.
- `rg` confirms evidence summary/sync candidate reads use the `retryCount` index path and no boolean `synced` index query remains.
- `rg` confirms SOAP legacy plaintext purge has one implementation in `src/lib/offline/soap-draft-legacy.ts`.
- Post-review actionable items in the current offline slice are implemented and validated. A fresh read-only performance/reliability subagent (`019edb8b-32f8-7520-8357-8b1a870c6585`) is running to identify any remaining actionable candidate before the next loop.

### Remaining Candidates

- Actionable candidates still under consideration for the next loop: durable cross-tab sync queue lease/claim, PHOS offline action/evidence dedupe races, autosave hash-skip/common timer hook, and deeper evidence upload partial-complete recovery tests.
- Blocked/deferred: voice memo server sync/STT requires external STT/product/PHI retention decisions; full PHOS/dashboard queue engine unification requires broader product/runtime contract decisions.

## 20260619-0140 JST - Offline Sync Short Follow-Up Loop

### Re-Audit Findings Addressed

- Performance re-audit High: `syncConfigKey()` now builds its active-run key from canonical default-merged endpoints, so `{ endpoints: {} }` and `{ visit_record: '/api/visit-records' }` share the same single-flight run.
- Performance re-audit High: sync queue rows are now checked again before POST/overwrite. If the row changed or disappeared after the initial queue read, the stale request is not sent.
- Performance re-audit Medium: visit record polling now catches `refreshSyncCount()` failures and logs one warning instead of producing repeated unhandled rejections every 5 seconds.
- Performance re-audit Medium: visit record evidence badge now calls `listEvidenceDraftSummariesForSchedule(id)`, using the `scheduleId` index instead of reading all unsynced evidence summaries for one visit.

### Implemented

- Added `resolveSyncEndpoints(config)` and reused it for both `syncConfigKey()` and processing.
- Added `verifyQueueItemCurrent()` and used it before normal sync POST and conflict overwrite POST.
- Added schedule-scoped evidence summary helper while preserving the existing all-summary helper for screens that need all drafts.
- Added visit-record form regression tests for schedule-scoped evidence summary and safe sync-count refresh failure handling.
- Added sync-engine regression coverage proving implicit and explicit default endpoint configs coalesce to one fetch.

### Validation

- Focused tests: `pnpm exec vitest run src/lib/stores/sync-engine.test.ts src/lib/offline/evidence-drafts.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx --reporter=dot --testTimeout=30000` passed with 3 files / 30 tests.
- Broader offline target tests: `pnpm exec vitest run src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx src/app/(dashboard)/offline-sync/offline-sync.shared.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx src/lib/stores/sync-engine.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/offline/evidence-drafts.test.ts src/lib/offline/evidence-drafts.shared.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/offline/voice-memo-drafts.integration.test.ts --reporter=dot --testTimeout=30000` passed with 11 files / 76 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.
- `pnpm test`: passed with 989 files passed / 1 skipped and 7722 tests passed / 1 skipped.
- `pnpm build`: passed, 272 app routes generated.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.

### Remaining Candidates

- Actionable but larger next-loop items: durable cross-tab sync/evidence leases, queue/server idempotency key contract, singleton draft duplicate collapse migration, skipped evidence backoff, and autosave hash-skip/common timer hook.
- Blocked/deferred: voice memo server sync/STT and full PHOS/dashboard queue engine unification require product/external-service/runtime decisions.

## 20260619-0546 JST - Adjacent Feature Zero Audit 6 Follow-Up

### Re-Audit Findings Addressed

- Product/Review/Test/Medical/Privacy agents found new actionable items, so the consecutive zero-actionable counter remains `0`.
- Added `/api/care-reports/:id/print-audit` to the rate-limit catalog and API route catalog.
- Hardened print-audit by reloading a confirmed report after audit persistence and returning only the print payload from that audited lookup.
- Scoped the print page audit query by org and per-mount run id so direct print views do not reuse stale cached clinical output.
- Hid print output links until reports are pharmacist-confirmed, matching the direct print-audit route requirement.
- Moved report-purpose presigned upload authorization before file constraint validation and aligned it with `canSendCareReport`, matching stored report file completion/download permissions.
- Added communication request CSV export audit logging and `Cache-Control: no-store`; export now fails closed if audit persistence fails.
- Normalized care-report communication request creation from the linked report scope and rejects missing, inaccessible, or mismatched linked report context.
- Changed report detail `can_view_related_requests` to require `canSendCareReport`, matching care-report communication request access.
- Extracted shared communication-request helpers for care-report visibility, writable patient scope, and care-report scope normalization.
- Reused the shared care-report target-role helpers in the report detail page instead of local role inference.
- Added shared visible external-access grant where construction and reused it from patient detail route/service.

### Files Changed In This Follow-Up

- `src/lib/api/rate-limit.ts`, `src/lib/api/rate-limit.test.ts`, `src/lib/api/route-catalog.ts`, `src/app/api/meta/route-catalog/route.test.ts`
- `src/app/api/care-reports/[id]/print-audit/route.ts`, `src/app/api/care-reports/[id]/print-audit/route.test.ts`
- `src/app/(dashboard)/reports/[id]/print/page.tsx`, `src/app/(dashboard)/reports/[id]/print/page.test.tsx`
- `src/app/(dashboard)/reports/[id]/page.tsx`, `src/app/(dashboard)/reports/[id]/page.test.tsx`
- `src/app/api/files/presigned-upload/route.ts`, `src/app/api/files/presigned-upload/route.test.ts`
- `src/app/api/communication-requests/route.ts`, `src/app/api/communication-requests/route.test.ts`
- `src/app/api/communication-requests/[id]/route.ts`, `src/app/api/communication-requests/[id]/responses/route.ts`, `src/app/api/communication-requests/[id]/resolve-followup/route.ts`
- `src/app/api/communication-requests/export/route.ts`, `src/app/api/communication-requests/export/route.test.ts`
- `src/app/api/care-reports/[id]/route.ts`, `src/app/api/care-reports/[id]/route.test.ts`
- `src/server/services/communication-request-access.ts`
- `src/server/services/external-access.ts`, `src/server/services/external-access.test.ts`, `src/server/services/patient-detail.ts`, `src/app/api/patients/[id]/route.ts`

### Validation

- Focused Vitest: `pnpm exec vitest run ...` passed with 16 files / 324 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Blocked: communication-request assignment-scope export/list tests for staff-assignment-only cases need a role/fixture contract that is not currently available without broader product/role-model work.
- Next action: run Zero Audit 7 with Discovery/Similarity/Duplication/Test/Review/Medical/Privacy coverage. If it finds actionables, implement and validate them; if it finds none, count clean audit `1/2` and run one more audit before final full `pnpm test` and `pnpm build`.

## 20260619-0618 JST - Adjacent Feature Zero Audit 7 Follow-Up

### Re-Audit Findings Addressed

- Product/API/Duplication/Test/Medical/Privacy agents found new actionable items, so the consecutive zero-actionable counter remains `0`.
- Hardened direct communication request response creation:
  - requires `expected_updated_at`
  - rejects stale request versions with 409 before side effects
  - requires strict ISO datetime `responded_at`
  - guards status claim with `updated_at`
  - reuses shared idempotent response upsert logic across direct response, request close, and resolve-followup paths
- Standardized stale communication-request list cursors to `VALIDATION_ERROR` instead of leaking Prisma `P2025`.
- Hardened communication request CSV export:
  - uses care-report communication access helper
  - prefixes spreadsheet-formula/control-character cells
  - records structured export metadata with request IDs, patient ID hashes, counts, truncation flags, and snapshot id
- Hardened care-report output/update surfaces:
  - report PATCH requires `expected_updated_at` and uses guarded `updateMany`
  - report detail edit and draft-confirm UI pass the current report version token
  - print-audit records audit after the final confirmed report reload, includes `report_updated_at`, and returns `no-store`
  - PDF audit failure is locked so a failed audit does not return `pdfResponse`
  - report file download denial for trainee role is covered before signed URL creation
- Hardened visit-to-report generation:
  - `/api/care-reports/generate-from-visit` now requires `expected_visit_record_updated_at`
  - `generateReportsFromVisit` rejects stale visit versions before loading report inputs and rechecks the visit row inside the write transaction
  - report workspace BFF returns `visit_record_updated_at`
  - report workspace and visit detail generation buttons pass the visit version token
- Removed adjacent inconsistencies:
  - interprofessional share follow-up task type now uses canonical `report_response_followup`
  - print hub save-copy controls are visible only for `first_visit_documents`, the only print type with persisted-copy/history support
  - Data Explorer hides `WebhookRegistration.url` as well as secret
  - external-access patient branches reuse shared visible-grant where construction
  - API conventions now document clinical output/export audit, no-store, fail-closed, metadata, and CSV formula-neutralization rules

### Files Changed In This Follow-Up

- `src/server/services/communication-response-upsert.ts`, `src/server/services/communication-response-upsert.test.ts`
- `src/app/api/communication-requests/[id]/responses/route.ts`, `src/app/api/communication-requests/[id]/responses/route.test.ts`
- `src/app/api/communication-requests/[id]/route.ts`, `src/app/api/communication-requests/[id]/resolve-followup/route.ts`
- `src/app/api/communication-requests/route.ts`, `src/app/api/communication-requests/route.test.ts`
- `src/app/api/communication-requests/export/route.ts`, `src/app/api/communication-requests/export/route.test.ts`
- `src/app/api/care-reports/[id]/route.ts`, `src/app/api/care-reports/[id]/route.test.ts`
- `src/app/api/care-reports/[id]/print-audit/route.ts`, `src/app/api/care-reports/[id]/print-audit/route.test.ts`
- `src/app/api/care-reports/[id]/pdf/route.test.ts`, `src/server/services/file-storage.test.ts`
- `src/app/api/care-reports/generate-from-visit/route.ts`, `src/app/api/care-reports/generate-from-visit/route.test.ts`
- `src/server/services/report-generator.ts`, `src/server/services/report-generator.test.ts`
- `src/app/api/care-reports/today-workspace/route.ts`, `src/app/api/care-reports/today-workspace/route.test.ts`, `src/types/reports-today-workspace.ts`
- `src/app/(dashboard)/reports/[id]/page.tsx`, `src/app/(dashboard)/reports/[id]/page.test.tsx`
- `src/components/features/reports/report-edit-form.tsx`, `src/components/features/reports/report-edit-form.test.tsx`
- `src/app/(dashboard)/reports/[id]/share/interprofessional-share.helpers.ts`, `src/app/(dashboard)/reports/[id]/share/interprofessional-share.helpers.test.ts`, `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx`
- `src/app/(dashboard)/reports/print/print-hub-content.tsx`, `src/app/(dashboard)/reports/print/print-hub-content.test.tsx`
- `src/app/(dashboard)/reports/report-share-workspace.tsx`, `src/app/(dashboard)/reports/report-share-workspace.test.tsx`
- `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx`
- `src/server/services/data-explorer.ts`, `src/server/services/data-explorer.test.ts`
- `src/app/api/external-access/route.ts`
- `src/app/api/__tests__/workflow-full-cycle.test.ts`
- `docs/api-conventions.md`

### Validation

- Focused Zero Audit 7 suite: `pnpm vitest run ...` passed with 16 files / 236 tests after fixing test expectations.
- Generate-from-visit OCC suite: `pnpm vitest run ...` passed with 5 files / 58 tests.
- Combined focused regression suite: `pnpm vitest run ...` passed with 21 files / 294 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- Initial `pnpm format:check` failed on `src/components/features/reports/report-edit-form.tsx`; Prettier was applied to that file.
- Final `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Blocked/deferred: generic persisted print-copy support for non-first-visit print types requires artifact/storage/product policy; replacing share-page direct task creation with full request resolve/close workflow requires product decision on whether viewing a reply should close the communication request.
- Next action: run Zero Audit 8 with Discovery/Similarity/Duplication/Test/Review/Medical/Privacy coverage. If it finds actionables, implement and validate them; if it finds none, count clean audit `1/2` and run one more audit before final full `pnpm test` and `pnpm build`.

## 20260619-0802 JST - Adjacent Feature Zero Audit 8 Follow-Up

### Re-Audit Findings Addressed

- Zero Audit 8 produced new actionable items, so the consecutive zero-actionable counter remains `0`.
- Hardened visit-to-care-report draft regeneration:
  - existing draft reports now require a report version token instead of being silently reused through bulk auto-generation
  - generate-from-visit returns refreshed `status` and `updated_at`
  - visit detail hides the automatic generation option when any draft exists, preserving the per-type version-token flow
- Hardened care-report output boundaries:
  - report list keyword body search is restricted to report output roles before content lookup
  - report detail no longer selects or returns `content` for roles without report output/send permission
  - PDF content types reuse shared `AudienceReportContent` instead of a local duplicate type
- Hardened external access and communication privacy/audit surfaces:
  - external-access grant creation records masked audit metadata without token or OTP values
  - communication response recording records audit metadata with response hash/length only, never raw body
  - report reminders expose masked recipient contacts in analytics and task metadata
- Hardened communication request export:
  - default profile is external/redacted
  - internal export requires output permission plus a narrowing status or request type filter
  - internal and external exports both enforce the 1000-row synchronous cap before CSV/audit output
- Hardened route/API catalog and retry behavior:
  - high-risk communication/external-access routes were added to the catalog
  - route-catalog admin gate is now covered by tests
  - duplicate response retries against already-responded communication requests no longer touch the parent request row or advance `updated_at`

### Files Changed In This Follow-Up

- `src/app/api/care-reports/[id]/route.ts`, `src/app/api/care-reports/[id]/route.test.ts`
- `src/app/api/care-reports/route.ts`, `src/app/api/care-reports/route.test.ts`
- `src/app/api/care-reports/generate-from-visit/route.ts`, `src/app/api/care-reports/generate-from-visit/route.test.ts`
- `src/server/services/report-generator.ts`, `src/server/services/report-generator.test.ts`
- `src/server/services/pdf-documents.tsx`, `src/server/services/report-templates.ts`, `src/types/care-report-content.ts`
- `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx`
- `src/app/(dashboard)/visits/[id]/visit-record-report-generation.ts`, `src/app/(dashboard)/visits/[id]/visit-record-report-generation.test.ts`
- `src/app/api/external-access/route.ts`, `src/app/api/external-access/route.test.ts`
- `src/app/api/communication-requests/[id]/responses/route.ts`, `src/app/api/communication-requests/[id]/responses/route.test.ts`
- `src/app/api/communication-requests/[id]/route.ts`, `src/app/api/communication-requests/[id]/route.test.ts`
- `src/app/api/communication-requests/export/route.ts`, `src/app/api/communication-requests/export/route.test.ts`
- `src/server/services/report-reminders.ts`, `src/server/services/report-reminders.test.ts`
- `src/lib/api/route-catalog.ts`, `src/app/api/meta/route-catalog/route.test.ts`

### Validation

- First Zero Audit 8 focused suite: `pnpm exec vitest run ...` passed with 8 files / 119 tests.
- First Zero Audit 8 gates: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `git diff --check`, full `pnpm test`, and `pnpm build` passed after formatting fixes.
- Re-audit follow-up focused suite: `pnpm exec vitest run 'src/app/api/care-reports/[id]/route.test.ts' 'src/app/api/external-access/route.test.ts' 'src/app/api/communication-requests/export/route.test.ts' 'src/app/api/meta/route-catalog/route.test.ts' 'src/app/api/communication-requests/[id]/responses/route.test.ts' 'src/app/api/communication-requests/[id]/route.test.ts' 'src/app/(dashboard)/visits/[id]/visit-record-report-generation.test.ts' --reporter=dot --testTimeout=30000` passed with 7 files / 103 tests.
- Re-audit follow-up gates: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` passed.
- Full regression: `pnpm test -- --reporter=dot --testTimeout=30000` passed with 997 files passed / 1 skipped and 7861 tests passed / 1 skipped.
- Production build: `pnpm build` passed for 272 app routes.

### Remaining / Next Loop

- Blocked/deferred: generic persisted print-copy support for non-first-visit print types requires artifact/storage/product policy; replacing share-page direct task creation with full request resolve/close workflow requires a product decision; staff-assignment-only export/list fixture coverage requires a role/fixture contract; supporting auto-generation across multiple existing draft report types would require a typed per-report version-token request contract.
- Next action: run Zero Audit 9 with fresh Product/Similarity/Architecture/UX/API/Duplication/Test/Medical/Privacy coverage. If no new actionable findings are found, record clean audit `1/2`; otherwise implement and revalidate.

## 20260619-0854 JST - Adjacent Feature Zero Audit 9 Follow-Up

### Re-Audit Findings Addressed

- Zero Audit 9 produced new actionable items, so the consecutive zero-actionable counter remains `0`.
- Hardened external access response caching:
  - `/api/external-access/[token]/self-report` now wraps validation, rate-limit, grant-validation/not-found, idempotency-conflict, replay, and success responses with the existing `withSensitiveNoStore` helper.
  - `/api/external-access` stale cursor validation responses now use the same no-store helper; GET success/empty paths are covered by tests.
- Aligned standalone report print audit semantics with the print hub:
  - preview rendering sends `{ intent: 'preview_rendered' }`
  - auto-print and manual print send a fresh `{ intent: 'print_requested' }` audit before invoking `window.print()`
  - the intentional second print-audit report read is documented as stale-output fail-closed protection.
- Hardened billing export privacy/audit semantics:
  - CSV and claims XML responses use `private, no-store, max-age=0` and `Pragma: no-cache`
  - claims XML exports are audited as `format: 'claims-xml'`, not `csv`
  - billing export audit no longer stores raw `patient_id` filters and records a short patient filter hash instead
  - claims XML generation failures no longer write successful export audits.
- Hardened CSV/export consistency:
  - communication external CSV tests now require `external_row_id` hash rows and raw request IDs to be absent
  - audit-log export tests now lock no-store headers and spreadsheet formula-prefix neutralization
  - shared CSV helper now quotes CR-containing minimal cells, preventing row-boundary drift
  - patient and prescription CSV exports now have route-level formula-prefix tests
  - pharmacy stock export now stringifies Decimal drug prices before CSV cell formatting.
- Added client/API contract coverage:
  - `generateCareReportFromVisit` now has direct tests for org header, snake_case payload, version tokens, explicit report regeneration, JSON error messages, and non-JSON fallback errors
  - communication response duplicate retry tests now assert no duplicate audit event is written
  - route catalog now has a pure uniqueness/shape/self-route test
  - rate-limit canonical paths now use `:token` for external-access token routes, matching the route catalog and CSRF redaction.
- Hardened care-report detail patient-boundary coverage:
  - `can_view_patient=false` detail responses now assert `patient_summary:null`, `visit_summary:null`, and no patient/visit summary queries.

### Files Changed In This Follow-Up

- `src/app/api/external-access/[token]/self-report/route.ts`, `src/app/api/external-access/[token]/self-report/route.test.ts`
- `src/app/api/external-access/route.ts`, `src/app/api/external-access/route.test.ts`
- `src/app/(dashboard)/reports/[id]/print/page.tsx`, `src/app/(dashboard)/reports/[id]/print/page.test.tsx`
- `src/app/api/care-reports/[id]/print-audit/route.ts`
- `src/app/api/care-reports/[id]/route.test.ts`
- `src/app/api/communication-requests/export/route.test.ts`
- `src/app/api/communication-requests/[id]/responses/route.test.ts`
- `src/lib/reports/generate-from-visit-client.test.ts`
- `src/app/api/billing-candidates/export/route.ts`, `src/app/api/billing-candidates/export/route.test.ts`
- `src/server/services/export-audit.ts`, `src/server/services/export-audit.test.ts`
- `src/app/api/audit-logs/export/route.test.ts`
- `src/lib/api/rate-limit.ts`, `src/lib/api/rate-limit.test.ts`
- `src/proxy.test.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/lib/csv/safe-csv.ts`, `src/lib/csv/safe-csv.test.ts`
- `src/app/api/patients/export/route.test.ts`
- `src/app/api/patients/[id]/prescriptions/export/route.test.ts`
- `src/app/api/pharmacy-drug-stocks/export/route.ts`

### Validation

- Focused Zero Audit 9 suite: `pnpm exec vitest run ...` passed with 18 files / 235 tests.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: initially failed on `Decimal` values passed to the CSV helper from pharmacy stock export, then passed after explicit stringification.

### Remaining / Next Loop

- Not implemented intentionally: removing the second `print-audit` report read. It protects against stale report status/content between initial access validation and output, so this follow-up documented the intent instead of weakening the fail-closed behavior.
- Blocked/deferred remain unchanged: generic persisted print-copy support for non-first-visit print types requires artifact/storage/product policy; replacing share-page direct task creation with full request resolve/close workflow requires a product decision; staff-assignment-only export/list fixture coverage requires a role/fixture contract; supporting auto-generation across multiple existing draft report types requires a typed per-report version-token request contract.
- Next action: run Zero Audit 10 with fresh Discovery/Similarity/Duplication/Test/Review/Medical/Privacy/API-contract coverage. If no new actionable findings are found, record clean audit `1/2`; otherwise implement and revalidate.

## 20260619-0922 JST - Current Editing Scope Close-Out

### User Stop Condition

- The latest user instruction changed the stop condition to: finish the current editing scope, then stop.
- No new broad candidate search was started after this instruction. Existing in-flight fixes were completed and validated.

### Fixes Completed In This Scope

- Billing and pharmacy CSV/export routes now consistently apply sensitive no-store headers on success and failure paths covered by this slice.
- Billing claims XML audit semantics now preserve `claims-xml`, fail closed on audit failure before external generation, and avoid raw patient filter metadata.
- Communication request export now separates read/export failures from audit failures and keeps no-store behavior covered.
- Care-report print audit now uses `recordCareReportPrintAudit` with action-specific `care_report_print_previewed` and `care_report_print_requested` events instead of overloading generic export audit events.
- External access list UI/API now use masked contact display for listed grants, and OTP delivery fallback audit coverage avoids raw token/OTP leakage.
- Public external-access token routes now share OTP preparation/grant validation helpers while preserving no-store responses and existing route contracts.
- Print hub retry behavior now avoids duplicate preview audit calls from automatic refetches.
- Route catalog/rate-limit tests now lock high-risk route alignment, including billing/audit and external token routes.
- Pharmacy stock template CSV output now reuses the safe CSV row helper, keeps no-store headers, and encodes download filenames safely.

### Validation

- Focused current-scope suite: `pnpm vitest run src/app/api/billing-candidates/export/route.test.ts src/app/api/pharmacy-drug-stocks/export/route.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/app/api/communication-requests/export/route.test.ts 'src/app/api/care-reports/[id]/print-audit/route.test.ts' src/server/services/export-audit.test.ts 'src/app/api/care-reports/[id]/route.test.ts' src/app/api/external-access/route.test.ts 'src/app/(dashboard)/reports/print/print-hub-content.test.tsx' 'src/app/api/communication-requests/[id]/responses/route.test.ts' src/lib/api/rate-limit.test.ts src/app/api/pharmacy-drug-stocks/template/route.test.ts src/lib/csv/safe-csv.test.ts 'src/app/api/external-access/[token]/route.test.ts' 'src/app/api/external-access/[token]/self-report/route.test.ts'` passed with 16 files / 200 tests.
- `pnpm format:check`: initially found Prettier drift in 6 current-scope files, then passed after targeted formatting.
- `pnpm lint`: passed.
- `pnpm typecheck`: initially failed on a route-catalog test literal type, then passed after preserving literal path types with `as const`.
- `git diff --check`: passed.

### Remaining / Stop Decision

- Current editing scope is complete and validated.
- Broader original-goal follow-up remains intentionally stopped per the latest user instruction.
- Existing blocked/deferred items remain unchanged: generic persisted print-copy support for non-first-visit print types, share reply close/resolve semantics, staff-assignment-only fixture coverage, and multi-draft generation version-token contract all require product/storage/fixture/API-contract decisions.

## 20260619-1015 JST - Adjacent Feature Zero Audit 10 Follow-Up

### Re-Audit Findings Addressed

- Zero Audit 10 produced new actionable items, so the consecutive zero-actionable counter remains `0`.
- Hardened sensitive export cache behavior:
  - communication-request CSV export now wraps success, validation, forbidden, audit failure, row-cap, and read-failure responses with `withSensitiveNoStore`
  - patient list, patient prescription, and pharmacy-stock CSV exports now use the canonical sensitive no-store headers on covered success/error paths
- Reduced raw identifier and PII leakage:
  - patient export masks phone, insurance numbers, and address for visit-only roles such as `pharmacist_trainee`
  - patient prescription export filenames no longer include patient names
  - pharmacy-stock export filenames are URL encoded and include `filename*` to avoid CRLF/header injection
  - empty billing export 409 details now expose `patient_filter` rather than raw `patient_id`
  - external-access POST responses omit raw `granted_to_contact` and return only masked contact metadata
- Hardened external-access audit/scope semantics:
  - successful public external-access payload views now require an explicit audit event with masked contact, public scope keys, IP, and user agent before returning data
  - self-report POST now requires a `care_reports` scope; medication-only/allergy-only grants fail closed
  - SMS fallback audit failure revokes the just-created grant before returning a 500, preventing an active grant with incomplete delivery/audit semantics
- Hardened communication response behavior:
  - response list/detail ordering now uses `responded_at desc, id desc`
  - response content is capped at 4000 characters across direct response POST, PATCH inline response, and follow-up resolution inline response
  - stale retries that match an existing response intent can replay the existing response instead of surfacing false 409 conflicts, without duplicate write/audit side effects
- Expanded operational route coverage:
  - route catalog and meta-route tests now include patient prescription export and pharmacy-stock export/template routes.

### Files Changed In This Follow-Up

- `src/lib/validations/communication-request.ts`
- `src/app/api/communication-requests/export/route.ts`, `src/app/api/communication-requests/export/route.test.ts`
- `src/app/api/communication-requests/[id]/responses/route.ts`, `src/app/api/communication-requests/[id]/responses/route.test.ts`
- `src/app/api/communication-requests/[id]/route.ts`, `src/app/api/communication-requests/[id]/route.test.ts`
- `src/app/api/communication-requests/[id]/resolve-followup/route.ts`
- `src/app/api/pharmacy-drug-stocks/export/route.ts`, `src/app/api/pharmacy-drug-stocks/export/route.test.ts`
- `src/app/api/patients/export/route.ts`, `src/app/api/patients/export/route.test.ts`
- `src/app/api/patients/[id]/prescriptions/export/route.ts`, `src/app/api/patients/[id]/prescriptions/export/route.test.ts`
- `src/app/api/billing-candidates/export/route.ts`, `src/app/api/billing-candidates/export/route.test.ts`
- `src/lib/api/route-catalog.ts`, `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/app/api/external-access/route.ts`, `src/app/api/external-access/route.test.ts`
- `src/app/api/external-access/[token]/route.ts`, `src/app/api/external-access/[token]/route.test.ts`
- `src/app/api/external-access/[token]/self-report/route.ts`, `src/app/api/external-access/[token]/self-report/route.test.ts`
- `src/server/services/external-access.ts`, `src/server/services/external-access.test.ts`

### Validation

- Focused Zero Audit 10 suite: `pnpm vitest run src/app/api/communication-requests/export/route.test.ts 'src/app/api/communication-requests/[id]/responses/route.test.ts' 'src/app/api/communication-requests/[id]/route.test.ts' src/app/api/pharmacy-drug-stocks/export/route.test.ts src/app/api/patients/export/route.test.ts 'src/app/api/patients/[id]/prescriptions/export/route.test.ts' src/app/api/billing-candidates/export/route.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/app/api/external-access/route.test.ts 'src/app/api/external-access/[token]/route.test.ts' 'src/app/api/external-access/[token]/self-report/route.test.ts' src/server/services/external-access.test.ts` passed with 13 files / 191 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- Targeted touched-file ESLint: passed.

### Remaining / Next Loop

- Deferred from this slice because they need broader schema/product/clinical/tax decisions or a separate plan: clinical report generation/send outcome gating; billing evidence `confirmed` vs actually delivered report semantics; claims XML `siteId` resolution and success-audit split; malformed PDF fallback redaction/fail-closed coverage; patient-detail service-level contact redaction coverage; care-report send access helper deduplication; invoice/receipt positive-amount gates.
- Next action: take the next safe Zero Audit 10 item as a separate slice, or plan the claims XML/site-resolution and clinical outcome-gating changes before implementation.

## 20260619-1024 JST - Billing Evidence Delivery Semantics Slice

### Completed

- Split billing evidence delivery predicates so `CareReport.status='confirmed'` is no longer external delivery evidence.
- Preserved legacy compatibility for `sent` reports with no backfilled `DeliveryRecord`.
- Preserved successful delivery record semantics for `DeliveryRecord.status='sent'` and `DeliveryRecord.status='confirmed'`.
- Added regressions proving:
  - confirmed-only reports with no delivery record keep `claimable=false`
  - failed delivery records keep `report_delivery_incomplete=true`
  - legacy sent reports without delivery rows remain claimable

### Files Changed

- `src/server/services/billing-evidence/core.ts`
- `src/server/services/billing-evidence/core.test.ts`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run src/server/services/billing-evidence/core.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 65 tests.
- `pnpm exec vitest run src/server/services/billing-evidence/core.test.ts 'src/app/api/care-reports/[id]/send/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 108 tests.
- `pnpm exec eslint --max-warnings=0 src/server/services/billing-evidence/core.ts src/server/services/billing-evidence/core.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/server/services/billing-evidence/core.ts src/server/services/billing-evidence/core.test.ts`: passed.

### Remaining / Next Loop

- Still separate from this slice: `response_waiting` delivery policy, clinical report generation/send outcome gating, claims XML `siteId` resolution and success-audit split, malformed PDF fallback coverage, patient-detail contact redaction coverage, care-report send access helper deduplication, and invoice/receipt positive-amount gates.
- Next action: pick the next safe Zero Audit 10 item, likely claims XML site attribution/success audit after defining the authoritative site source, or a narrow PDF/contact redaction coverage slice.

## 20260619-1040 JST - Claims XML Site Attribution / Audit Split Slice

### Completed

- Added a shared claims export site resolver that reads candidate `source_snapshot.site_id` or nested `billing_site.site_id`.
- Billing evidence generation now persists visit schedule `site_id` into `calculation_context`, generated candidate `source_snapshot.site_id`, and `source_snapshot.billing_site`.
- Manual billing claims XML export now fails closed before audit/adapter when candidate site attribution is missing or spans multiple pharmacy sites.
- Manual billing claims XML export now passes the resolved `siteId` to the adapter and records separate attempt/success export audit metadata.
- Billing close auto-transmit now fails closed before adapter on missing/multiple sites, records an attempt audit before the adapter, records success audit after adapter success, preserves close success on adapter failure with attempt evidence, and skips the adapter when attempt audit cannot be recorded.
- Verifier re-check found no actionable findings after the attempt/success close-audit follow-up.

### Files Changed

- `src/server/services/claims-export-site.ts`
- `src/app/api/billing-candidates/export/route.ts`
- `src/app/api/billing-candidates/export/route.test.ts`
- `src/app/api/billing-candidates/close/route.ts`
- `src/app/api/billing-candidates/close/route.test.ts`
- `src/server/services/billing-evidence/core.ts`
- `src/server/services/billing-evidence/core.test.ts`
- `src/server/services/billing-evidence.test.ts`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run src/app/api/billing-candidates/export/route.test.ts src/app/api/billing-candidates/close/route.test.ts src/server/services/billing-evidence/core.test.ts src/server/services/billing-evidence.test.ts --reporter=dot --testTimeout=30000`: passed, 4 files / 125 tests.
- `pnpm exec vitest run src/app/api/billing-candidates/close/route.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 21 tests.
- `pnpm exec eslint --max-warnings=0 src/server/services/claims-export-site.ts src/app/api/billing-candidates/export/route.ts src/app/api/billing-candidates/export/route.test.ts src/app/api/billing-candidates/close/route.ts src/app/api/billing-candidates/close/route.test.ts src/server/services/billing-evidence/core.ts src/server/services/billing-evidence/core.test.ts src/server/services/billing-evidence.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/server/services/claims-export-site.ts src/app/api/billing-candidates/export/route.ts src/app/api/billing-candidates/export/route.test.ts src/app/api/billing-candidates/close/route.ts src/app/api/billing-candidates/close/route.test.ts src/server/services/billing-evidence/core.ts src/server/services/billing-evidence/core.test.ts src/server/services/billing-evidence.test.ts`: passed.

### Remaining / Next Loop

- Still separate from this slice: `response_waiting` delivery policy, clinical report generation/send outcome gating, malformed PDF fallback coverage, patient-detail contact redaction coverage, care-report send access helper deduplication, and invoice/receipt positive-amount gates.
- Next action: pick the next low-policy-risk item, likely malformed PDF/contact-redaction coverage or invoice/receipt positive-amount gates.

## 20260619-1045 JST - Billing PDF Positive Amount Gate Slice

### Completed

- Receipt PDF generation now requires `collection.collected_amount > 0` in addition to issued status and a receipt number.
- Invoice PDF generation now requires `collection.billed_amount > 0` in addition to issued invoice status.
- Non-positive receipt/invoice amount snapshots fail before PDF rendering and before export audit.
- Added regressions proving issued receipt/invoice snapshots with zero amounts throw `BILLING_DOCUMENT_NOT_ISSUED` and do not call the PDF renderer.
- Verifier found no must-fix findings. It noted collection route URL-save alignment as non-blocking because the actual PDF route/service now rejects render/audit for non-positive amounts.

### Files Changed

- `src/server/services/pdf-billing-document-record.ts`
- `src/server/services/pdf-documents.test.tsx`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run src/server/services/pdf-documents.test.tsx 'src/app/api/billing-candidates/[id]/documents/pdf/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 17 tests.
- `pnpm exec vitest run src/server/services/pdf-documents.test.tsx 'src/app/api/billing-candidates/[id]/documents/pdf/route.test.ts' 'src/app/api/billing-candidates/[id]/collection/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 3 files / 37 tests.
- `pnpm exec eslint --max-warnings=0 src/server/services/pdf-billing-document-record.ts src/server/services/pdf-documents.test.tsx 'src/app/api/billing-candidates/[id]/documents/pdf/route.test.ts' 'src/app/api/billing-candidates/[id]/collection/route.test.ts'`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/server/services/pdf-billing-document-record.ts src/server/services/pdf-documents.test.tsx 'src/app/api/billing-candidates/[id]/documents/pdf/route.test.ts' 'src/app/api/billing-candidates/[id]/collection/route.test.ts'`: passed.

### Remaining / Next Loop

- Still separate from this slice: `response_waiting` delivery policy, clinical report generation/send outcome gating, malformed PDF fallback coverage, patient-detail contact redaction coverage, and care-report send access helper deduplication.
- Next action: pick the next low-policy-risk item, likely malformed PDF fallback coverage or patient-detail contact redaction coverage.

## 20260619-1049 JST - Malformed Care-Report PDF Fallback Coverage Slice

### Completed

- Added a route-level regression for malformed/generic care-report PDF build failures.
- The route now has direct coverage proving `EXTERNAL_PDF_RENDER_FAILED` returns a generic response, does not leak malformed report details or PHI-like content from the thrown error, does not return a partial PDF response, and does not record a successful export audit.
- Re-read the attached v0.2 specification and recorded the user's clarification: when the v0.2 spec is a higher-version contract than existing code, existing code should be updated to fully align with the spec instead of preserving the older behavior.

### Files Changed

- `src/app/api/care-reports/[id]/pdf/route.test.ts`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run 'src/app/api/care-reports/[id]/pdf/route.test.ts' src/server/services/pdf-documents.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 20 tests.
- `pnpm exec eslint --max-warnings=0 'src/app/api/care-reports/[id]/pdf/route.test.ts' src/server/services/pdf-documents.test.tsx`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- 'src/app/api/care-reports/[id]/pdf/route.test.ts' src/server/services/pdf-documents.test.tsx`: passed.

### Remaining / Next Loop

- Continue with v0.2 as the upper-version SSOT. Live-map the Phase 1 checklist against current code and update older behavior to match the spec, especially patient share cases, consent blocking, partner edit denial, visit request/record workflow, contract effective-version billing, paid/free monthly outputs, and audit logging.
- Still separate from this slice: `response_waiting` delivery policy, clinical report generation/send outcome gating, patient-detail contact redaction coverage, and care-report send access helper deduplication.

## 20260619-1059 JST - External Sharing Consent Gate / Notification PHI Slice

### Completed

- Reconfirmed v0.2 as the upper-version SSOT and ran read-only mapping through code/spec/privacy/DB/planning subagents.
- Added an active `external_sharing` consent gate to external-access grant creation. Missing, revoked, or expired consent now returns 409 before token, OTP, grant, audit, or SMS side effects.
- Preserved existing external access scope validation, patient access checks, archived-patient guard, hidden case boundary behavior, no-store responses, and audit safety.
- Changed generic notification dispatch so persisted in-app notifications and realtime in-app updates keep detailed operational content, but SMS, LINE, and Web Push receive only fixed PHI-free text: `PH-OS通知 / アプリで詳細を確認してください`.
- Added regressions for SMS, LINE, and Web Push proving patient names, drug names, and diagnosis-like terms do not leave through external notification payloads.

### Files Changed

- `src/app/api/external-access/route.ts`
- `src/app/api/external-access/route.test.ts`
- `src/server/services/notifications.ts`
- `src/server/services/notifications.test.ts`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run src/app/api/external-access/route.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 32 tests.
- `pnpm exec vitest run src/server/services/notifications.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 14 tests.
- `pnpm exec vitest run src/app/api/external-access/route.test.ts src/server/services/notifications.test.ts --reporter=dot --testTimeout=30000`: passed, 2 files / 46 tests.
- `pnpm exec eslint --max-warnings=0 src/app/api/external-access/route.ts src/app/api/external-access/route.test.ts src/server/services/notifications.ts src/server/services/notifications.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed after targeted Prettier on notification files.
- `git diff --check -- src/app/api/external-access/route.ts src/app/api/external-access/route.test.ts src/server/services/notifications.ts src/server/services/notifications.test.ts .codex/ralph-state.md CODEX_GOAL_PROGRESS.md`: passed.

### Remaining / Next Loop

- Implement v0.2 Phase 1 foundation as new append-only pharmacy-partnership/patient-share-case tables and isolated APIs, instead of treating `ExternalAccessGrant`, ordinary `VisitRecord`, or ordinary `BillingCandidate` as substitutes.
- Planned foundation includes `PartnerPharmacy`, `PharmacyPartnership`, `PatientShareCase`, `PatientShareConsent`, `PatientLink`, correction requests, partner visit record submission, RLS/check constraints, and focused service/API tests.

## 20260619-1113 JST - Pharmacy Partnership / Patient Share Foundation Schema Slice

### Completed

- Added the user's new repo rule to `AGENTS.md`: higher-version specification documents override older existing-code behavior and require updating existing code to align.
- Added v0.2 foundation Prisma models for partner pharmacies, pharmacy partnerships, patient share cases, share-case consents, patient links, correction requests, partner visit requests/records, claim cooperation notes, pharmacy contracts/versions/fee rules, visit billing candidates, invoices/items, and contract documents.
- Added tenant-safe `(id, org_id)` relation keys on `Patient`, `CareCase`, `ConsentRecord`, and `VisitRecord` so the new cross-domain records can keep DB-level org boundaries.
- Added migration SQL generated from Prisma datamodel diff, then appended `app_enforced_org_id()` RLS + `FORCE ROW LEVEL SECURITY` and audit triggers for all new org-scoped partnership/share/contract/billing tables.
- Updated `prisma/rls-policies.sql` with the same new table RLS policy block.
- Added focused service guards for AC-001/AC-002/AC-003/AC-004 style behavior: active consent required for share activation, accepted patient link and both approvals required, other-pharmacy data edits denied, submitted records locked, base pharmacy notified on new submission, and only completed+confirmed+consented+contract-effective visits become billable.
- Added regressions for same-day `@db.Date` consent/contract validity so date-only expirations remain valid through the whole day.

### Files Changed

- `AGENTS.md`
- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/schema/organization.prisma`
- `prisma/schema/patient.prisma`
- `prisma/schema/visit.prisma`
- `prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql`
- `prisma/rls-policies.sql`
- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/ && pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm exec prisma generate --schema=prisma/schema/`: passed.
- `pnpm exec vitest run src/server/services/pharmacy-partnerships.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 8 tests.
- `pnpm exec eslint --max-warnings=0 src/server/services/pharmacy-partnerships.ts src/server/services/pharmacy-partnerships.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed after targeted Prettier on `AGENTS.md`.
- `git diff --check -- AGENTS.md prisma/schema/organization.prisma prisma/schema/patient.prisma prisma/schema/visit.prisma prisma/schema/pharmacy-partnership.prisma prisma/rls-policies.sql prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql src/server/services/pharmacy-partnerships.ts src/server/services/pharmacy-partnerships.test.ts`: passed.
- `pnpm exec prisma migrate diff --from-migrations=prisma/migrations --to-schema=prisma/schema --exit-code`: blocked by repo config requiring `datasource.shadowDatabaseUrl`; no DB migration was applied.

### Remaining / Next Loop

- Implement isolated API routes/tests for the new foundation: partner pharmacy registration/list, pharmacy partnership creation/list, patient share case creation/activation, patient link accept/decline, correction request creation, partner visit request/record submit/confirm/return, and billing candidate generation.
- Update route catalog/rate-limit coverage for those routes when APIs are added.
- Later slices still need UI surfaces, physician report draft generation from partner records, monthly paid/free PDF outputs, invoice snapshot immutability, and audit/search views.

## 20260619-1128 JST - Foundation API Slice: Partner Pharmacies / Partnerships / Patient Share Cases

### Completed

- Added `/api/partner-pharmacies` GET/POST with bounded cursor pagination, org-scoped RLS context, partner pharmacy creation, and compact transaction audit.
- Added `/api/pharmacy-partnerships` GET/POST with base-site and partner-pharmacy validation, archived-partner rejection, effective date validation, RLS context, and transaction audit.
- Added `/api/patient-share-cases` GET/POST with partnership/patient/case validation, mismatched-patient case rejection, pending `PatientLink` creation, patient matching snapshot creation, and PHI-minimized audit metadata.
- Added `/api/patient-share-cases/[id]/activate` POST that enforces the existing v0.2 service guard at the request boundary: active consent, accepted patient link, base approval, and partner approval are required before status changes to `active`.
- Registered the new high-risk/operational endpoints in route catalog and rate-limit canonical templates, including the dynamic activation route.
- Added focused route and catalog/rate-limit regressions, including no-side-effect checks for invalid payloads, archived partners, mismatched patient cases, missing consent, and patient-name/address audit exclusion.

### Files Changed

- `src/app/api/partner-pharmacies/route.ts`
- `src/app/api/partner-pharmacies/route.test.ts`
- `src/app/api/pharmacy-partnerships/route.ts`
- `src/app/api/pharmacy-partnerships/route.test.ts`
- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run src/app/api/partner-pharmacies/route.test.ts src/app/api/pharmacy-partnerships/route.test.ts src/app/api/patient-share-cases/route.test.ts 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts --reporter=dot --testTimeout=30000`: passed, 7 files / 46 tests.
- `pnpm exec eslint --max-warnings=0 ...`: passed for all new/changed API, catalog, and rate-limit files.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed after targeted Prettier on `src/app/api/patient-share-cases/[id]/activate/route.ts`.
- `git diff --check -- src/app/api/partner-pharmacies src/app/api/pharmacy-partnerships src/app/api/patient-share-cases src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.

### Remaining / Next Loop

- Next smallest Phase 1 slice: patient link accept/decline APIs and correction request creation, because they complete the activation prerequisite path and AC-002 correction workflow before partner visit records depend on it.
- Still pending after that: partner visit request/record submit/confirm/return, billing candidate generation, UI surfaces, physician report draft generation from partner records, monthly paid/free PDF outputs, invoice snapshot immutability, and audit/search views.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1148 JST - Patient Link / Correction Request Safety Slice

### Completed

- Added `canManagePatientSharing` and moved patient-sharing lifecycle mutations away from broad `canVisit`; owner/admin/pharmacist are allowed, trainee/clerk/driver/external viewer are denied.
- Added `/api/patient-share-cases/[id]/patient-link` PATCH for base approval, partner acceptance, and decline with pending-only state transitions, terminal transition rejection, base approval required before partner acceptance, and atomic `PatientLink` + `PatientShareCase` approval SSOT updates.
- Hardened `/api/patient-share-cases/[id]/activate` so activation rejects inactive/ended partnerships, archived partner pharmacies, out-of-window share cases/partnerships, and approval drift between `PatientShareCase` and `PatientLink`.
- Added `/api/patient-share-cases/[id]/correction-requests` GET/POST with target type and field-path allowlists, target ownership derived server-side, same-share-case target validation, no direct cross-owner writes, and PHI-minimized route audit metadata.
- Minimized `canVisit` list responses: patient-share lists no longer expose patient-link snapshots/decline reasons, and correction-request lists no longer expose `reason`, `response_note`, or `proposed_value`.
- Expanded DB-trigger audit redaction: patient link snapshots/decline reason, correction `reason`/`proposed_value`/`response_note`, and future partner visit request/record/claim note clinical free text/snapshots are summarized instead of copied into `AuditLog`.
- Registered the new mutation/read endpoints in route catalog and rate-limit canonicalization, with regression tests.

### Files Changed

- `src/lib/auth/permissions.ts`
- `src/lib/auth/__tests__/permissions.test.ts`
- `src/app/api/partner-pharmacies/route.ts`
- `src/app/api/pharmacy-partnerships/route.ts`
- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.test.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.test.ts`
- `src/app/api/patient-share-cases/[id]/correction-requests/route.ts`
- `src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/app/api/medication-cycles/[id]/transition/route.ts`
- `src/tools/pharmacy-partnership-db-contract.test.ts`
- `prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql`
- `.codex/ralph-state.md`
- `CODEX_GOAL_PROGRESS.md`

### Validation

- `pnpm exec vitest run ... --reporter=dot --testTimeout=30000`: passed, 11 files / 67 tests.
- `pnpm exec eslint --max-warnings=0 ...`: passed for all new/changed patient-sharing, auth, catalog, rate-limit, and DB-contract files.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- ...`: passed for the current slice.

### Remaining / Next Loop

- Next slice: partner visit request + partner visit record draft/submit APIs, with base confirmation/return workflow following.
- Still pending after that: billing candidate generation, UI surfaces, physician report draft generation from partner records, monthly paid/free PDF outputs, invoice snapshot immutability, and audit/search views.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1218 JST - Partner Visit Request / Partner Record Workflow Slice

### Completed

- Added `/api/pharmacy-visit-requests` GET/POST for active patient-share cases, including active partnership/partner pharmacy gates, desired-date window checks, contract/version/fee-rule estimate snapshots, and PHI-minimized responses.
- Added `/api/pharmacy-visit-requests/[id]/decision` POST for accept/decline with requested-only guarded transitions, active share/partnership predicates, decline-reason length audit, and no raw decline reason in audit.
- Added `/api/partner-visit-records` GET/POST for accepted visit requests, source visit-record ownership validation, one active draft/returned record per request, submitted/confirmed edit lockout, and PHI-minimized responses/audits.
- Added `/api/partner-visit-records/[id]/submit` POST so partner records move `draft/returned -> submitted`, persist PHI-free in-app notification to the base requester, and do not mark the request completed or generate claim support before base confirmation.
- Added `/api/partner-visit-records/[id]/review` POST so the base pharmacy can confirm or return submitted partner records; confirm now completes the visit request and generates the claim cooperation note, while return leaves the request accepted and stores only reason length in audit.
- Hardened patient-link identity safety discovered by medical review: partner acceptance now requires partner name/birth-date snapshot proof against the base snapshot, mismatch requires explicit override reason, and activation rejects missing identity proof.
- Hardened activation to require `partner_pharmacy.status === active`, not merely non-archived.
- Registered visit request and partner visit record endpoints in route catalog, meta route catalog tests, and rate-limit canonicalization.

### Files Changed

- `src/app/api/pharmacy-visit-requests/route.ts`
- `src/app/api/pharmacy-visit-requests/route.test.ts`
- `src/app/api/pharmacy-visit-requests/[id]/decision/route.ts`
- `src/app/api/pharmacy-visit-requests/[id]/decision/route.test.ts`
- `src/app/api/partner-visit-records/route.ts`
- `src/app/api/partner-visit-records/route.test.ts`
- `src/app/api/partner-visit-records/[id]/submit/route.ts`
- `src/app/api/partner-visit-records/[id]/submit/route.test.ts`
- `src/app/api/partner-visit-records/[id]/review/route.ts`
- `src/app/api/partner-visit-records/[id]/review/route.test.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.test.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run ... --reporter=dot --testTimeout=30000`: passed, 14 files / 80 tests.
- `pnpm exec eslint --max-warnings=0 ...`: passed for the new/changed visit request, partner record, patient-link, activation, catalog, and rate-limit files.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/app/api/pharmacy-visit-requests src/app/api/partner-visit-records src/app/api/patient-share-cases src/lib/api/route-catalog.ts src/lib/api/rate-limit.ts src/app/api/meta/route-catalog/route.test.ts`: passed.

### Review Follow-up Closed

- Medical safety reviewer flagged early request completion/claim-note creation on submit; fixed by moving request completion and claim note upsert to base confirm only.
- Medical safety reviewer flagged weak patient identity proof; fixed by requiring partner identity snapshot proof and activation proof checks.
- Medical safety reviewer flagged inactive partner activation; fixed by requiring active partner pharmacy on activation.
- Medical safety reviewer flagged stale transition predicates; added guarded active lifecycle predicates to visit-request decision, partner-record submit, and partner-record review updates.

### Remaining / Next Loop

- Next slice: billing candidate generation from confirmed partner visit records using active consent and effective contract version, plus tests that returned/submitted-only records are excluded.
- Still pending after that: UI surfaces, physician report draft generation from partner records, monthly paid/free PDF outputs, invoice snapshot immutability, contract master registration API, and audit/search views.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1228 JST - Visit Billing Candidate Generation Slice

### Completed

- Added `/api/visit-billing-candidates` GET/POST behind `canManageBilling`.
- POST generates monthly visit billing candidates only from partner visit records that are `confirmed`, have `confirmed_at`, belong to completed visit requests, and whose `visit_at` falls inside the strict billing month.
- Candidate generation now requires active patient-share consent at visit date and an effective active contract version; missing contract/consent or ineffective contract versions produce excluded candidates instead of billable candidates.
- Fee snapshots are persisted without PHI. Fixed-per-visit and free fee rules become billable candidates; unresolved amount models now become excluded candidates with `amount_unresolved`.
- Candidate generation uses org-scoped upsert by partner visit record and writes one compact PHI-free batch audit with scanned/generated/billable/excluded counts.
- GET supports bounded cursor pagination and filters by billing month, billing status, share case, and partner pharmacy, returning only operational partner-record/contract summaries.
- Registered the route in API catalog, meta route catalog tests, and rate-limit canonicalization.

### Files Changed

- `src/app/api/visit-billing-candidates/route.ts`
- `src/app/api/visit-billing-candidates/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/app/api/visit-billing-candidates/route.test.ts src/server/services/pharmacy-partnerships.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 5 files / 50 tests.
- `pnpm exec eslint src/app/api/visit-billing-candidates/route.ts src/app/api/visit-billing-candidates/route.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/app/api/visit-billing-candidates src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.

### Remaining / Next Loop

- Next slice: contract master registration/update API or UI surfaces for partner pharmacy/share case/visit/billing operations.
- Still pending after that: physician report draft generation from partner records, monthly paid/free PDF outputs, invoice snapshot immutability, and audit/search views.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1238 JST - Pharmacy Contract Master API Slice

### Completed

- Added `/api/pharmacy-contracts` GET/POST for org-scoped pharmacy contract master listing and registration.
- POST creates a contract, initial contract version, and one active fee rule in a single transaction so visit requests and billing candidate generation have a durable active contract/version/fee-rule source.
- Active contract creation now requires base and partner approval records, an active pharmacy partnership, an active partner pharmacy, and no overlapping active contract period for the same partnership.
- Added `/api/pharmacy-contracts/[id]/versions` POST to add a new contract version and fee rule instead of mutating old versions, preserving version history for visit-date pricing.
- Active contract-version creation now requires both approval records, an active parent contract/partnership/partner pharmacy, and no overlapping active version period.
- Fee rule validation rejects fixed-per-visit and per-visit-with-addon models without a positive unit price. Free contracts remain allowed with zero/null amount.
- Contract and version audit events are compact: IDs, status, date windows, billing model, unit price, tax metadata, approval flags, and reason length only; raw legal terms snapshots are not written to audit changes.
- Registered pharmacy contract routes in route catalog, meta route catalog tests, high-risk route alignment tests, and rate-limit canonicalization.

### Files Changed

- `src/app/api/pharmacy-contracts/route.ts`
- `src/app/api/pharmacy-contracts/route.test.ts`
- `src/app/api/pharmacy-contracts/[id]/versions/route.ts`
- `src/app/api/pharmacy-contracts/[id]/versions/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/app/api/pharmacy-contracts/route.test.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.test.ts' src/app/api/pharmacy-visit-requests/route.test.ts src/app/api/visit-billing-candidates/route.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 7 files / 52 tests.
- `pnpm exec eslint src/app/api/pharmacy-contracts/route.ts src/app/api/pharmacy-contracts/route.test.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.ts' 'src/app/api/pharmacy-contracts/[id]/versions/route.test.ts' src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.
- `pnpm typecheck`: initially failed because the Zod `fee_rule` default omitted `tax_category`; fixed by adding `tax_pending`, then passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/app/api/pharmacy-contracts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.

### Remaining / Next Loop

- Next slice: monthly performance aggregation / invoice and free-report draft generation, or a minimal UI shell to operate the new partner pharmacy/share case/visit/contract workflows.
- Still pending after that: physician report draft generation from partner records, monthly paid/free PDF outputs, invoice snapshot immutability, and audit/search views.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1242 JST - Visit Billing Monthly Summary Slice

### Completed

- Added `/api/visit-billing-candidates/summary` GET behind `canManageBilling`.
- The route requires strict `billing_month=YYYY-MM-01` and supports optional `share_case_id` / `partner_pharmacy_id` filters.
- Summary returns PHI-free monthly operational counts: total partner visit records, confirmed records, unconfirmed records, generated candidates, billable candidates, excluded candidates, invoiced candidates, free candidates, paid candidates, planned invoice amount, and pending candidate generation count.
- Free vs paid counts are derived from `VisitBillingCandidate.amount_snapshot.billing_model`, so free cooperation visits are visible before invoice/free-report generation.
- Registered the summary route in route catalog, meta route catalog tests, high-risk route alignment tests, and rate-limit templates.

### Files Changed

- `src/app/api/visit-billing-candidates/summary/route.ts`
- `src/app/api/visit-billing-candidates/summary/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/app/api/visit-billing-candidates/summary/route.test.ts src/app/api/visit-billing-candidates/route.test.ts src/app/api/pharmacy-contracts/route.test.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.test.ts' src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 7 files / 52 tests.
- `pnpm exec eslint src/app/api/visit-billing-candidates/summary/route.ts src/app/api/visit-billing-candidates/summary/route.test.ts src/app/api/visit-billing-candidates/route.ts src/app/api/visit-billing-candidates/route.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/app/api/visit-billing-candidates/summary src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.

### Remaining / Next Loop

- Next slice: invoice/free-report draft generation from billable visit billing candidates with snapshot immutability.
- Still pending after that: monthly paid/free PDF outputs, physician report draft generation from partner records, UI surfaces, and audit/search views.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1259 JST - Pharmacy Invoice / Free Report Draft Slice

### Completed

- Treated the attached v0.2 specification as the higher-version SSOT where it conflicts with older existing code, per the latest user instruction.
- Added `PharmacyInvoiceDocumentKind` with `invoice` and `free_cooperation_report`, plus `PharmacyInvoice.document_kind`.
- Added active-document uniqueness for `org_id + contract_id + billing_month + document_kind` so only one active draft/issued/sent/received/scheduled/paid document exists per contract-month-kind.
- Added item-level uniqueness for `org_id + visit_billing_candidate_id` so a billing candidate cannot be inserted into multiple invoice items.
- Added redacted DB audit triggers for `VisitBillingCandidate`, `PharmacyInvoice`, and `PharmacyInvoiceItem`, preventing raw amount snapshots, invoice snapshots, item descriptions, and linkable visit/candidate IDs from being copied wholesale into `AuditLog.changes`.
- Added `createPharmacyInvoiceDraft` service. It splits paid invoice vs free cooperation report by frozen `VisitBillingCandidate.amount_snapshot.billing_model`, copies amount/tax data into invoice item scalars/snapshots, computes totals from item snapshots, and never re-reads live fee rules for created items.
- Added `/api/pharmacy-invoices` POST behind `canManageBilling`, with strict `billing_month=YYYY-MM-01`, `contract_id`, and explicit `document_kind`.
- Re-running the same contract/month/document-kind returns the existing active draft idempotently instead of duplicating items.
- Created invoice/free report responses use `private, no-store, max-age=0` and omit raw snapshots.
- Hardened `/api/visit-billing-candidates` regeneration so `confirmed`, `invoiced`, `voided`, or invoice-item-linked candidates are not overwritten by later candidate generation.
- Hardened visit billing candidate list/generation responses with `withSensitiveNoStore`; GET now returns fixed `amount_summary` instead of raw `amount_snapshot`, and POST caps returned candidate IDs with a truncation flag.
- Registered `/api/pharmacy-invoices` in route catalog, meta route catalog tests, high-risk route alignment, and rate-limit templates.

### Files Changed

- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql`
- `src/server/services/pharmacy-invoices.ts`
- `src/server/services/pharmacy-invoices.test.ts`
- `src/app/api/pharmacy-invoices/route.ts`
- `src/app/api/pharmacy-invoices/route.test.ts`
- `src/app/api/visit-billing-candidates/route.ts`
- `src/app/api/visit-billing-candidates/route.test.ts`
- `src/tools/pharmacy-partnership-db-contract.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/ && pnpm exec prisma validate --schema=prisma/schema/ && pnpm exec prisma generate --schema=prisma/schema/`: passed.
- `pnpm exec vitest run src/server/services/pharmacy-invoices.test.ts src/app/api/pharmacy-invoices/route.test.ts src/app/api/visit-billing-candidates/route.test.ts src/tools/pharmacy-partnership-db-contract.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 7 files / 55 tests.
- `pnpm exec eslint src/server/services/pharmacy-invoices.ts src/server/services/pharmacy-invoices.test.ts src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/app/api/visit-billing-candidates/route.ts src/app/api/visit-billing-candidates/route.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/tools/pharmacy-partnership-db-contract.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- prisma/schema/pharmacy-partnership.prisma prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql src/tools/pharmacy-partnership-db-contract.test.ts src/server/services/pharmacy-invoices.ts src/server/services/pharmacy-invoices.test.ts src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/app/api/visit-billing-candidates/route.ts src/app/api/visit-billing-candidates/route.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts`: passed.

### Remaining / Next Loop

- Next slice: monthly paid/free PDF output for pharmacy invoices/free cooperation reports with fail-closed export audit, output purpose, no-store, and PHI-minimized patient display policy.
- Still pending after that: physician report draft generation from partner records, UI surfaces, invoice search/audit views, and broader end-to-end operator flow.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1308 JST - Pharmacy Invoice / Free Report PDF Export Slice

### Completed

- Added a dedicated pharmacy invoice/free cooperation report PDF builder that reads `PharmacyInvoice` and `PharmacyInvoiceItem` immutable scalar fields instead of live contract fee rules.
- PDF output covers both `invoice` and `free_cooperation_report` document kinds, including billing month, issuer/recipient snapshot names, patient display mode, totals, and item rows.
- PDF content intentionally excludes patient names, patient addresses, raw partner visit record content, attachments, and raw item/invoice snapshots.
- Added `GET /api/pharmacy-invoices/[id]/pdf?purpose=...` behind `canManageBilling`.
- `purpose` is required and capped at 200 characters so export reason is explicit before rendering/audit side effects.
- Export audit is fail-closed: the route renders, records `recordDataExportAudit`, and only then returns the PDF response. If audit fails, no PDF body is returned.
- PDF success and error responses are wrapped with `private, no-store, max-age=0`.
- Added safe errors for missing pharmacy invoices and voided/cancelled invoice documents.
- Registered `/api/pharmacy-invoices/:id/pdf` in route catalog, high-risk catalog alignment, meta route catalog tests, rate-limit templates, PDF route smoke tests, and protected GET route matrix.

### Files Changed

- `src/server/services/pdf-pharmacy-invoice.tsx`
- `src/server/services/pdf-pharmacy-invoice.test.tsx`
- `src/server/services/pdf-errors.ts`
- `src/app/api/pharmacy-invoices/[id]/pdf/route.ts`
- `src/app/api/pharmacy-invoices/[id]/pdf/route.test.ts`
- `src/app/api/__tests__/pdf-routes.test.ts`
- `src/app/api/__tests__/protected-get-routes.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/server/services/pdf-pharmacy-invoice.test.tsx 'src/app/api/pharmacy-invoices/[id]/pdf/route.test.ts' src/app/api/__tests__/pdf-routes.test.ts src/app/api/__tests__/protected-get-routes.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 7 files / 187 tests.
- `pnpm exec eslint src/server/services/pdf-pharmacy-invoice.tsx src/server/services/pdf-pharmacy-invoice.test.tsx 'src/app/api/pharmacy-invoices/[id]/pdf/route.ts' 'src/app/api/pharmacy-invoices/[id]/pdf/route.test.ts' src/app/api/__tests__/pdf-routes.test.ts src/app/api/__tests__/protected-get-routes.test.ts src/server/services/pdf-errors.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/server/services/pdf-pharmacy-invoice.tsx src/server/services/pdf-pharmacy-invoice.test.tsx 'src/app/api/pharmacy-invoices/[id]/pdf/route.ts' 'src/app/api/pharmacy-invoices/[id]/pdf/route.test.ts' src/app/api/__tests__/pdf-routes.test.ts src/app/api/__tests__/protected-get-routes.test.ts src/server/services/pdf-errors.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts`: passed.

### Remaining / Next Loop

- Next slice: physician report draft generation from confirmed partner records, or minimal UI surfaces to operate partner pharmacy/share case/visit/billing workflows.
- Still pending after that: invoice search/audit views, full operator UI flow, and broader end-to-end verification.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1324 JST - Partner Visit Physician Report Draft Slice

### Completed

- Added `CareReport.partner_visit_record_id` with a composite relation back to `PartnerVisitRecord`.
- Added DB uniqueness for `org_id + partner_visit_record_id + report_type`, preventing duplicate physician report drafts from the same confirmed partner visit record.
- Added migration contract coverage for the new CareReport column, unique index, and composite FK.
- Added `createPartnerVisitPhysicianReportDraft` service for confirmed partner visit records.
- The service returns an existing physician draft idempotently and handles concurrent DB unique conflicts by re-reading the existing draft.
- Generated report content uses the existing `PhysicianReportContent` shape so the report edit/view surfaces can consume it.
- Draft content is populated from known partner visit record keys only; unknown raw JSON and attachments are not copied wholesale.
- Manual audit records only IDs, status, content keys, and attachment count, not clinical free text or patient names.
- Added `/api/partner-visit-records/:id/physician-report-draft` POST behind `canAuthorReport`, with `Serializable` transaction and `private, no-store, max-age=0` responses.
- Registered the new endpoint in route catalog, meta route catalog tests, high-risk route alignment, and rate-limit templates.

### Files Changed

- `prisma/schema/communication.prisma`
- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql`
- `src/server/services/partner-visit-report-drafts.ts`
- `src/server/services/partner-visit-report-drafts.test.ts`
- `src/app/api/partner-visit-records/[id]/physician-report-draft/route.ts`
- `src/app/api/partner-visit-records/[id]/physician-report-draft/route.test.ts`
- `src/tools/pharmacy-partnership-db-contract.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/ && pnpm exec prisma validate --schema=prisma/schema/ && pnpm exec prisma generate --schema=prisma/schema/`: passed.
- `pnpm exec vitest run src/server/services/partner-visit-report-drafts.test.ts 'src/app/api/partner-visit-records/[id]/physician-report-draft/route.test.ts' src/tools/pharmacy-partnership-db-contract.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 6 files / 51 tests.
- `pnpm exec eslint src/server/services/partner-visit-report-drafts.ts src/server/services/partner-visit-report-drafts.test.ts 'src/app/api/partner-visit-records/[id]/physician-report-draft/route.ts' 'src/app/api/partner-visit-records/[id]/physician-report-draft/route.test.ts' src/tools/pharmacy-partnership-db-contract.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- prisma/schema/communication.prisma prisma/schema/pharmacy-partnership.prisma prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql src/server/services/partner-visit-report-drafts.ts src/server/services/partner-visit-report-drafts.test.ts 'src/app/api/partner-visit-records/[id]/physician-report-draft/route.ts' 'src/app/api/partner-visit-records/[id]/physician-report-draft/route.test.ts' src/tools/pharmacy-partnership-db-contract.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs UI surfaces for the pharmacy-partnership workflow, invoice search/audit views, and broader end-to-end operator verification.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: build minimal operator UI surfaces for partner pharmacy/share case/visit/billing/report operations, unless invoice search/audit is prioritized first.

## 20260619-1336 JST - Partner Cooperation Monthly Billing UI Slice

### Completed

- Added `/billing/partner-cooperation` as the minimal monthly operator surface for v0.2 pharmacy-partnership billing.
- The page shows monthly cooperation summary KPIs, active contract selection, billing candidate rows, candidate generation, invoice draft creation, free cooperation report draft creation, and a PDF output link with explicit purpose.
- Candidate rows intentionally omit patient names, visit body, physician instructions, attachments, and raw clinical JSON; the UI only shows visit date, partner pharmacy, status, billing model, amount, and non-PHI evidence/blocker text.
- Linked the new surface from the existing billing check page and monthly billing candidates page.
- Added route labels and breadcrumb segment labels for `/billing/partner-cooperation`.
- Added jsdom/React Query tests that mock the API boundary and verify summary display, PHI-minimized rows, candidate generation POST body, invoice draft POST body, and PDF link exposure.
- Removed an initial React effect-based contract auto-selection and replaced it with a derived effective contract ID to satisfy React hook linting and avoid cascading renders.
- Added a month-input guard so cleared/invalid month values do not trigger malformed API requests.

### Files Changed

- `src/app/(dashboard)/billing/partner-cooperation/page.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `src/app/(dashboard)/billing/billing-check-content.tsx`
- `src/app/(dashboard)/billing/candidates/page.tsx`
- `src/lib/navigation/route-labels.ts`
- `src/lib/navigation/route-labels.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/billing/partner-cooperation/page.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/candidates/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' 'src/app/(dashboard)/billing/billing-check-content.test.tsx' src/lib/navigation/route-labels.test.ts --reporter=dot --testTimeout=30000`: passed, 3 files / 13 tests.
- `pnpm exec eslint 'src/app/(dashboard)/billing/partner-cooperation/page.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/candidates/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed after replacing effect-driven selection with derived state.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- 'src/app/(dashboard)/billing/partner-cooperation/page.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/candidates/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs operator UI surfaces for partner pharmacy registration, partnership creation, patient share case activation/link/correction, partner visit request/record review, and physician report draft creation.
- Invoice search/audit views and broader operator end-to-end verification remain pending.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add a compact workflow UI for share cases and partner visit records so the already implemented API state machine can be operated without ad hoc API calls.

## 20260619-1346 JST - Pharmacy Cooperation Workflow UI Slice

### Completed

- Added `/workflow/pharmacy-cooperation` as the compact operator surface for v0.2 patient share cases, pharmacy visit requests, partner visit records, and physician report draft handoff.
- Added workflow shortcuts from `/workflow` and breadcrumb labels for `/workflow/pharmacy-cooperation`.
- The page shows high-level work counts for inactive share cases, requested visits, and submitted records.
- Added safe tables for patient share cases, visit requests, and partner visit records using existing minimized API responses.
- Added row actions for share case activation, visit request accept/decline, partner record submit, partner record confirm, partner record return, and confirmed-record physician report draft creation.
- Kept the UI PHI-minimized by not rendering patient names, addresses, request body, physician instructions, home notes, record content, attachments, or raw snapshots.
- Added jsdom/React Query tests for minimized rendering, activation/accept POST bodies, return POST body, and report draft result link.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `src/app/(dashboard)/workflow/page.tsx`
- `src/lib/navigation/route-labels.ts`
- `src/lib/navigation/route-labels.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/(dashboard)/workflow/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx' src/lib/navigation/route-labels.test.ts --reporter=dot --testTimeout=30000`: passed, 3 files / 7 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/(dashboard)/workflow/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- 'src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/(dashboard)/workflow/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs UI surfaces or guided actions for partner pharmacy registration, pharmacy partnership creation, patient-link accept/decline, correction request creation, and partner visit record content entry.
- Invoice search/audit views and broader operator end-to-end verification remain pending.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add a small admin/workflow surface for partner pharmacy + partnership + contract registration, or add invoice search/audit if billing review is prioritized.

## 20260619-1351 JST - Pharmacy Partnership Activation API Slice

### Completed

- Added `/api/pharmacy-partnerships/:id/activate` POST so draft/suspended pharmacy partnerships can be moved to `active`.
- Activation now requires both base-pharmacy and partner-pharmacy approval records.
- Activation rejects missing IDs, invalid bodies, inactive partner pharmacies, ended partnerships, future effective start dates, and expired effective end dates.
- Already-active partnerships return safely without another update or audit entry.
- Successful activation updates approval fields and writes compact audit metadata without raw contact snapshots.
- Registered the route in route catalog, meta route catalog coverage, high-risk route alignment, and rate-limit templates.

### Files Changed

- `src/app/api/pharmacy-partnerships/[id]/activate/route.ts`
- `src/app/api/pharmacy-partnerships/[id]/activate/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/api/pharmacy-partnerships/[id]/activate/route.ts' 'src/app/api/pharmacy-partnerships/[id]/activate/route.test.ts' src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm exec vitest run 'src/app/api/pharmacy-partnerships/[id]/activate/route.test.ts' src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 4 files / 42 tests.
- `pnpm exec eslint 'src/app/api/pharmacy-partnerships/[id]/activate/route.ts' 'src/app/api/pharmacy-partnerships/[id]/activate/route.test.ts' src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- 'src/app/api/pharmacy-partnerships/[id]/activate/route.ts' 'src/app/api/pharmacy-partnerships/[id]/activate/route.test.ts' src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs UI surfaces or guided actions for partner pharmacy registration, partnership creation/activation, contract registration, patient-link accept/decline, correction request creation, and partner visit record content entry.
- Invoice search/audit views and broader operator end-to-end verification remain pending.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: resume the setup UI now that pharmacy partnership activation has a concrete API path.

## 20260619-1358 JST - Pharmacy Cooperation Setup UI Slice

### Completed

- Added `/admin/pharmacy-cooperation` for v0.2 setup of partner pharmacies, pharmacy partnerships, partnership activation, and pharmacy contracts.
- Added a workflow shortcut from `/workflow/pharmacy-cooperation` to the setup page.
- Added navigation labels for the new admin route and admin-specific breadcrumb segment handling.
- The setup page fetches pharmacy sites, partner pharmacies, pharmacy partnerships, and pharmacy contracts.
- Added forms for partner pharmacy registration, draft partnership creation, partnership activation with both approvals, and active/draft contract creation with fee rule input.
- Added compact setup summary cards and tables for current partnerships and contracts.
- Kept the surface master-data-only; no patient names, clinical notes, visit record content, or raw snapshots are rendered.
- Added jsdom/React Query tests covering minimized rendering, partner pharmacy POST body, partnership POST body, partnership activation POST body, and contract POST body.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/page.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx`
- `src/lib/navigation/route-labels.ts`
- `src/lib/navigation/route-labels.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-cooperation/page.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' src/lib/navigation/route-labels.test.ts --reporter=dot --testTimeout=30000`: passed, 3 files / 9 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacy-cooperation/page.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed after changing the initial date memo to an inline function.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/pharmacy-cooperation/page.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/page.tsx' src/lib/navigation/route-labels.ts src/lib/navigation/route-labels.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs guided UI/actions for patient-link accept/decline, correction request creation, and partner visit record content entry.
- Invoice search/audit views and broader operator end-to-end verification remain pending.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add patient-share-case/patient-link/correction UI, or add invoice search/audit if billing review is prioritized.

## 20260619-1402 JST - Pharmacy Invoice List API Slice

### Completed

- Added `/api/pharmacy-invoices` GET for safe pharmacy invoice/free cooperation report listing.
- Supports bounded pagination plus `billing_month`, `document_kind`, `status`, and `contract_id` filters.
- Returns only operational fields: document kind, invoice number, billing month, totals, status timestamps, item count, and base/partner pharmacy names.
- Does not return raw invoice snapshots, issuer/recipient snapshots, item snapshots, or invoice item rows.
- Wrapped success and validation errors with `private, no-store, max-age=0`.
- Updated route catalog metadata so `/api/pharmacy-invoices` is registered as `GET, POST`.

### Files Changed

- `src/app/api/pharmacy-invoices/route.ts`
- `src/app/api/pharmacy-invoices/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm exec vitest run src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts --reporter=dot --testTimeout=30000`: passed, 4 files / 44 tests.
- `pnpm exec eslint src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.ts src/app/api/meta/route-catalog/route.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs an invoice search/audit UI that consumes this GET API.
- Patient-link accept/decline UI, correction request UI, partner visit record content entry, and broader operator end-to-end verification remain pending.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add the invoice search/audit UI now that a safe list API exists.

## 20260619-1405 JST - Partner Cooperation Invoice History UI Slice

### Completed

- Extended `/billing/partner-cooperation` with a monthly output history section.
- The page now fetches `/api/pharmacy-invoices?billing_month=...&limit=20` alongside summary, contracts, and billing candidates.
- Shows invoice/free-report document kind, invoice number or ID, base/partner pharmacy names, total, item count, status, and PDF link with explicit purpose.
- Invalidates invoice history after candidate generation and invoice/free-report draft creation.
- Updated UI test stubs and assertions for invoice history rendering and PDF link exposure.
- Shortened the candidate section copy so the UI does not list hidden clinical content categories.

### Files Changed

- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts --reporter=dot --testTimeout=30000`: passed, 4 files / 15 tests.
- `pnpm exec eslint 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check -- 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' src/app/api/pharmacy-invoices/route.ts src/app/api/pharmacy-invoices/route.test.ts src/lib/api/route-catalog.ts src/app/api/meta/route-catalog/route.test.ts`: passed.

### Remaining / Next Loop

- Phase 1 still needs patient-link accept/decline UI, correction request UI, partner visit record content entry, and broader operator end-to-end verification.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add patient-share-case/patient-link/correction UI, then fill partner visit record content entry if still missing.

## 20260619-1415 JST - Patient Link and Correction Request UI Slice

### Completed

- Extended `/workflow/pharmacy-cooperation` so patient share case rows can perform base approval, partner acceptance with identity proof input, and decline with a required reason.
- Added guarded share activation behavior: the UI only enables `共有開始` when the patient link is already accepted.
- Added a correction request panel that selects a share case, lists safe correction request metadata, and creates correction/addition requests through `/api/patient-share-cases/:id/correction-requests`.
- Kept list rendering PHI-minimized: patient names, raw reasons, proposed values, snapshots, and clinical record bodies are not rendered from API responses.
- Updated UI tests to assert patient-link PATCH payloads, correction request POST payloads, safe correction listing, and existing visit/record/report actions.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/api/patient-share-cases/[id]/patient-link/route.test.ts' 'src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 3 files / 15 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --no-index --check /dev/null <target file>` for the two untracked workflow UI files: no whitespace diagnostics; command exits 1 because no-index file differences exist.

### Remaining / Next Loop

- Phase 1 still needs partner visit record content entry and broader operator end-to-end verification.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add partner visit record content entry to the pharmacy cooperation workflow, then run broader workflow verification.

## 20260619-1420 JST - Partner Visit Record Draft Entry UI Slice

### Completed

- Added a draft entry panel to `/workflow/pharmacy-cooperation` for accepted/completed pharmacy visit requests.
- The panel saves partner visit record drafts through `POST /api/partner-visit-records`, including pharmacist metadata, visit datetime, source visit record ID, and structured record content keys.
- Existing submit/confirm/return/report actions remain in the same section after the draft entry panel.
- Updated UI tests to assert the generated partner visit record POST payload and keep the existing PHI-minimized rendering checks.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 6 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/api/patient-share-cases/[id]/patient-link/route.test.ts' 'src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts' src/app/api/partner-visit-records/route.test.ts --reporter=dot --testTimeout=30000`: passed, 4 files / 19 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --no-index --check /dev/null <target file>` for the two untracked workflow UI files: no whitespace diagnostics; command exits 1 because no-index file differences exist.

### Remaining / Next Loop

- Phase 1 now needs broader operator end-to-end verification across setup, workflow, billing, and report draft paths.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: run broader targeted workflow/API test coverage and inspect remaining v0.2 gaps before deciding whether Phase 1 can close.

## 20260619-1435 JST - Patient Share Consent API/UI Slice

### Completed

- Added patient share consent registration and revocation APIs for `P1-06` and `P1-07`.
- Added consent attachment validation for existing consent records and completed file assets scoped to the base patient/org.
- Made consent revoke idempotent and tied an active share case to `revoked` when the consent is revoked.
- Registered the new routes in route catalog/rate limit metadata and covered them in catalog tests.
- Extended `/workflow/pharmacy-cooperation` with a PHI-minimized consent panel for registering consent scope/attachments and revoking existing consent.

### Files Changed

- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.test.ts`
- `src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.test.ts`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 3 files / 12 tests.
- Earlier focused consent API/catalog suite passed with 6 files / 49 tests.
- Earlier targeted consent API/catalog ESLint passed.
- Earlier `pnpm typecheck` passed after the consent API slice.

### Remaining / Next Loop

- Phase 1 still needs broader operator end-to-end verification and remaining P1 audit-log gap inspection, especially `P1-27` viewing log coverage.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Current user request supersedes the loop temporarily: group and commit all current changes before continuing implementation.

## 20260619-1447 JST - Share Case Read Audit and Revoked Share Read Guard Slice

### Completed

- Re-read the v0.2 specification and ran parallel read-only reviews against Phase 1.
- Added `patient_share_cases_viewed` audit logging to `GET /api/patient-share-cases`.
- Added a `view_context` query parameter so `/workflow/pharmacy-cooperation` records the target screen as `pharmacy_cooperation_workflow`.
- Kept the view audit PHI-minimized: IDs, role, target screen, filter flags, site IDs, partner pharmacy IDs, and counts only.
- Added a shared `buildActivePatientShareCaseReadWhere` helper for active share case read predicates.
- Applied the active share case + active partnership + unrevoked active consent predicate to `GET /api/pharmacy-visit-requests` and `GET /api/partner-visit-records`.
- Updated focused tests to assert the read audit and revoked-consent visibility guard without exposing patient names, clinical instructions, visit bodies, or medication text.

### Files Changed

- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `src/app/api/pharmacy-visit-requests/route.ts`
- `src/app/api/pharmacy-visit-requests/route.test.ts`
- `src/app/api/partner-visit-records/route.ts`
- `src/app/api/partner-visit-records/route.test.ts`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `src/server/services/patient-share-access.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/patient-share-access.ts src/app/api/pharmacy-visit-requests/route.ts src/app/api/pharmacy-visit-requests/route.test.ts src/app/api/partner-visit-records/route.ts src/app/api/partner-visit-records/route.test.ts`: passed.
- `pnpm exec vitest run src/app/api/patient-share-cases/route.test.ts 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' src/app/api/pharmacy-visit-requests/route.test.ts src/app/api/partner-visit-records/route.test.ts --reporter=dot --testTimeout=30000`: passed, 4 files / 17 tests.
- `pnpm exec eslint src/server/services/patient-share-access.ts src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' src/app/api/pharmacy-visit-requests/route.ts src/app/api/pharmacy-visit-requests/route.test.ts src/app/api/partner-visit-records/route.ts src/app/api/partner-visit-records/route.test.ts`: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- Phase 1 still needs file/attachment download audit for P1-06/P1-28, actor pharmacy/site context in read audits, share-scope update/audit, patient-share-case creation UI, visit request creation UI, and stronger management-plan version evidence.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.
- Next slice: add audited file/attachment download or add the visit request creation panel; privacy reviewers ranked download audit and revoked-share read guards as the highest risks.

## 20260619-1501 JST - File Download Audit and Consent Attachment Slice

### Completed

- Re-read the v0.2 specification and reviewed `P1-06`, `P1-28`, and `FR-019` against the current file download routes.
- Added fail-closed file download audit before `/api/files/[id]/download` returns a redirect.
- Added fail-closed file download audit before `/api/files/[id]/presigned-download` returns either JSON or redirect mode.
- Added `file_download` audit action support via `recordDataExportAudit` with `format: "file"` for searchability.
- Added a dedicated `recordFileDownloadAudit` helper that records only PHI-minimized identifiers and file metadata: file purpose, MIME type, size, expiry seconds, route surface, and response mode.
- Added consent attachment audit context resolution for `PatientShareConsent.file_asset_id`, recording only share-consent/share-case IDs and boolean flags, not consent person, patient name, filename, storage key, or presigned URL.
- Fixed patient-share consent attachment validation to accept the file-storage completion status `uploaded` instead of the non-canonical `completed`.
- Added `@@index([org_id, file_asset_id])` and migration SQL for efficient consent-attachment audit context lookup.

### Files Changed

- `src/app/api/files/[id]/download/route.ts`
- `src/app/api/files/[id]/download/route.test.ts`
- `src/app/api/files/[id]/presigned-download/route.ts`
- `src/app/api/files/[id]/presigned-download/route.test.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.test.ts`
- `src/server/services/file-download-audit.ts`
- `src/server/services/file-download-audit.test.ts`
- `src/server/services/export-audit.ts`
- `src/server/services/export-audit.test.ts`
- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619150500_add_patient_share_consent_file_asset_index/migration.sql`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write ...`: TypeScript route/helper/test files passed; Prisma schema needs `prisma format` rather than Prettier.
- `pnpm exec prisma format`: passed.
- `pnpm exec vitest run 'src/app/api/files/[id]/download/route.test.ts' 'src/app/api/files/[id]/presigned-download/route.test.ts' src/server/services/file-download-audit.test.ts src/server/services/export-audit.test.ts 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' src/__tests__/audit-log-conventions-static.test.ts --reporter=dot --testTimeout=30000`: passed, 6 files / 29 tests.
- `pnpm exec eslint ...`: passed for touched API/helper/test files.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Legacy `ConsentRecord.document_url` can still expose an existing consent document URL outside the audited FileAsset download path; next security/privacy slice should either migrate it to FileAsset or suppress raw URL responses with a safe audited access path.
- Phase 1 still needs actor pharmacy/site context completion in remaining read audits, share-scope update/audit, patient-share-case creation UI, visit request creation UI, and stronger management-plan version evidence.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1740 JST - Audit Log Search Vocabulary and PatientShareConsent DB Redaction Slice

### Completed

- Re-read the v0.2 specification around `FR-019`, `SC-011`, `AC-009`, `P1-27`, and `P1-28`, plus the Next.js route handler and PH-OS UI/UX guidance before changing the audit-log UI/API slice.
- Added shared audit-log filter option vocabulary for consent records, patient-share cases, patient-share consents, patient links, file downloads, care-report print/output actions, and DB-triggered snake_case targets.
- Updated the admin audit-log page to use the shared filter vocabulary so administrators can search newly added consent/share/file-download events from the UI and export the same filtered set.
- Added UI/API/export regression coverage for canonical v0.2 audit action names, including the singular `patient_share_consent_registered` and `patient_share_consent_revoked` mutation events.
- Added a forward migration replacing `PatientShareConsent` DB-triggered audit rows with `ph_os_write_patient_share_consent_audit_log`, redacting raw `consent_person`, `scope`, linked file/consent IDs, and exact consent/validity/revocation dates into counts and flags.
- Extended the audit trigger contract so `audit_log_patient_share_consent` must use the dedicated redacted trigger function.

### Files Changed

- `src/app/(dashboard)/admin/audit-logs/audit-logs-content.tsx`
- `src/app/(dashboard)/admin/audit-logs/audit-logs-content.test.tsx`
- `src/lib/audit-logs/filter-options.ts`
- `src/lib/audit-logs/filter-options.test.ts`
- `src/app/api/audit-logs/route.test.ts`
- `src/app/api/audit-logs/export/route.test.ts`
- `prisma/migrations/20260619173403_redact_patient_share_consent_audit/migration.sql`
- `src/tools/pharmacy-partnership-db-contract.test.ts`
- `tools/scripts/audit-trigger-contract.ts`
- `tools/scripts/audit-trigger-contract.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write ... migration.sql`: failed because this repo has no SQL parser configured for Prettier.
- `pnpm exec prettier --write ...` over touched TS/TSX files: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/audit-logs/audit-logs-content.test.tsx' src/lib/audit-logs/filter-options.test.ts src/app/api/audit-logs/route.test.ts src/app/api/audit-logs/export/route.test.ts src/tools/pharmacy-partnership-db-contract.test.ts tools/scripts/audit-trigger-contract.test.ts src/server/services/file-download-audit.test.ts src/server/services/consent-record-audit.test.ts 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 10 files / 64 tests.
- `pnpm exec eslint ...`: passed for touched UI/API/helper/tool/test files.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Consent document download audit still cannot directly resolve a `ConsentRecord` context because `ConsentRecord` stores only `document_url`; a stronger file-id linkage or resolver remains needed.
- ConsentRecord expiry/document update UI remains absent; only the API PATCH path is covered.
- Phase 1 still needs actor pharmacy/site context completion in remaining read audits, share-scope update/audit, patient-share-case creation UI, visit request creation UI, and stronger management-plan version evidence.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1752 JST - Pharmacy Visit Request Creation UI Slice

### Completed

- Re-read the v0.2 specification requirements for `FR-008`, `AC-005`, `P1-14`, and `P1-15` against the current pharmacy cooperation workflow.
- Added a visit-request creation panel to `/workflow/pharmacy-cooperation` using active patient share cases only.
- The creation payload now captures urgency, visit type, desired start/end datetime, request reason, physician instruction, carry items, and patient home notes through the existing `/api/pharmacy-visit-requests` endpoint.
- The UI blocks incomplete requests and rejects a desired end datetime that is not after the desired start datetime before issuing the POST.
- The visit request list now shows the active contract id/version, estimated amount, billing model, unit price, and estimate status returned by the API.
- Added UI regression coverage proving the POST body is trimmed/normalized, carry items are line-normalized, org headers are sent, and raw request reason / physician instruction / home-note text is not rendered back into the list.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' src/app/api/pharmacy-visit-requests/route.test.ts --reporter=dot --testTimeout=30000`: passed, 2 files / 11 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' src/app/api/pharmacy-visit-requests/route.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Phase 1 still needs patient-share-case creation UI, share-scope update/audit, actor pharmacy/site context completion in remaining read audits, and stronger management-plan version evidence.
- Browser-level workflow proof for the pharmacy cooperation screen remains pending after the current component/API regression coverage.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1523 JST - Legacy Consent Document Upload Hardening Slice

### Completed

- Re-read the v0.2 specification and reviewed `FR-004`, `FR-019`, `P1-06`, `P1-27`, and `P1-28` against the legacy `ConsentRecord` UI/API path.
- Replaced the patient consent UI raw `document_url` input with a FileAsset upload flow using `/api/files/presigned-upload`, direct PUT, `/api/files/complete`, then `document_file_id`.
- Added an audited document column to the consent list so safe internal document URLs render through `/api/files/.../presigned-download?download=1`; legacy raw URLs render only as redacted metadata.
- Added collection `GET/POST /api/consent-records` patient/case assignment checks aligned with the `[id]` routes.
- Tightened consent document normalization so absolute external URLs are rejected even when their path looks like `/api/files/.../presigned-download`.
- Tightened consent document FileAsset validation to require `purpose = consent-document`, uploaded status, allowed PDF/image MIME, and exact patient binding.
- Applied the same consent document FileAsset purpose/MIME/patient checks to `PatientShareConsent.file_asset_id`.
- Redacted raw legacy `document_url` from `POST /api/consent-records/[id]/revoke` responses.

### Files Changed

- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx`
- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx`
- `src/app/api/consent-records/route.ts`
- `src/app/api/consent-records/route.test.ts`
- `src/app/api/consent-records/[id]/route.ts`
- `src/app/api/consent-records/[id]/route.test.ts`
- `src/app/api/consent-records/[id]/revoke/route.ts`
- `src/app/api/consent-records/[id]/revoke/route.test.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.test.ts`
- `src/app/api/files/presigned-upload/route.test.ts`
- `src/server/services/file-storage.test.ts`
- `src/server/services/consent-record-documents.ts`
- `src/server/services/consent-record-documents.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write ...`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' src/app/api/consent-records/route.test.ts 'src/app/api/consent-records/[id]/route.test.ts' 'src/app/api/consent-records/[id]/revoke/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' src/app/api/files/presigned-upload/route.test.ts src/server/services/file-storage.test.ts src/server/services/consent-record-documents.test.ts --reporter=dot --testTimeout=30000`: passed, 8 files / 130 tests.
- `pnpm exec eslint ...`: passed for touched UI/API/service/test files.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- `ConsentRecord` list/detail/create/update still need explicit minimized audit events for `P1-27` and `FR-019`; revoke already has mutation audit and file downloads are audited.
- Patient-share consent list/create should still be reviewed for share-case participant/read scope beyond org ownership, without breaking draft consent registration before activation.
- Phase 1 still needs actor pharmacy/site context completion in remaining read audits, share-scope update/audit, patient-share-case creation UI, visit request creation UI, and stronger management-plan version evidence.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1542 JST - ConsentRecord Minimized Audit Slice

### Completed

- Re-read the v0.2 specification around `FR-019`, `P1-27`, and `P1-28`, plus the Next.js route handler guide before API edits.
- Wired `GET /api/consent-records` to record `consent_records_viewed` after patient assignment scope checks and before returning consent rows.
- Wired `GET /api/consent-records/[id]` to record `consent_record_viewed` after detail scope checks and before returning the record.
- Wired `POST /api/consent-records` to record `consent_record_created` inside the same org transaction as row creation.
- Wired `PATCH /api/consent-records/[id]` to record `consent_record_updated` inside the update transaction, using the pre-update row and changed field list.
- Added unit coverage for `src/server/services/consent-record-audit.ts` to prove raw legacy URLs, internal file URLs, and exact expiry dates do not reach `createAuditLogEntry`.
- Added a new migration that replaces the `ConsentRecord` DB trigger with `ph_os_write_consent_record_audit_log`, redacting `document_url` and date values into compact flags.
- Updated the audit trigger contract so `ConsentRecord` must use the dedicated redacted trigger function instead of the generic row snapshot trigger.

### Files Changed

- `src/app/api/consent-records/route.ts`
- `src/app/api/consent-records/route.test.ts`
- `src/app/api/consent-records/[id]/route.ts`
- `src/app/api/consent-records/[id]/route.test.ts`
- `src/server/services/consent-record-audit.test.ts`
- `prisma/migrations/20260619153500_redact_consent_record_audit_document_url/migration.sql`
- `src/tools/consent-record-db-contract.test.ts`
- `tools/scripts/audit-trigger-contract.ts`
- `tools/scripts/audit-trigger-contract.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write ...`: passed.
- `pnpm exec vitest run src/server/services/consent-record-audit.test.ts src/app/api/consent-records/route.test.ts 'src/app/api/consent-records/[id]/route.test.ts' 'src/app/api/consent-records/[id]/revoke/route.test.ts' tools/scripts/audit-trigger-contract.test.ts src/tools/consent-record-db-contract.test.ts src/__tests__/audit-log-conventions-static.test.ts src/app/api/__tests__/api-conventions-static.test.ts --reporter=dot --testTimeout=30000`: passed, 8 files / 50 tests.
- `pnpm exec eslint ...`: passed for touched API/helper/tool/test files.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- `GET /api/patient-share-cases/[id]/consents` still needs a minimized list-view audit for the shared-case consent screen.
- The patient consent UI is still querying `is_active=false`, so active consent records created through the UI may not appear in the list; this needs a UI fix and test.
- Consent document file-download audit still resolves `PatientShareConsent.file_asset_id` context but cannot directly resolve a `ConsentRecord` because `ConsentRecord` stores only `document_url`.
- Audit log search UI still lacks first-class filters for `consent_record`, `PatientShareConsent`, and `file_download` actions.
- ConsentRecord expiry/document update UI remains absent; only the API PATCH path is covered.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1723 JST - Shared Consent Read Audit and Active Consent UI Slice

### Completed

- Re-read the PH-OS UI/UX SSOT and the Next.js route handler guide before changing UI/API code.
- Fixed the patient consent UI list query so it loads active `ConsentRecord` rows by default instead of hardcoding `is_active=false`.
- Added UI regression coverage proving active consent records appear in the table and the frontend no longer calls the inactive-only endpoint.
- Added minimized `patient_share_consents_viewed` audit logging to `GET /api/patient-share-cases/[id]/consents`.
- Kept shared-consent list audit metadata compact: target screen, role, share case id, consent ids, counts, pagination flags; no raw consent person text, free text, or file identifiers are logged.
- Added route regression tests for successful shared-consent list audit, audit fail-closed behavior, and no audit on missing share cases.

### Files Changed

- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx`
- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx`
- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write ...`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' src/server/services/consent-record-audit.test.ts src/app/api/consent-records/route.test.ts 'src/app/api/consent-records/[id]/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 5 files / 36 tests.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' src/app/api/consent-records/route.test.ts 'src/app/api/consent-records/[id]/route.test.ts' 'src/app/api/consent-records/[id]/revoke/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.test.ts' src/server/services/consent-record-audit.test.ts src/server/services/consent-record-documents.test.ts src/app/api/files/presigned-upload/route.test.ts src/server/services/file-storage.test.ts tools/scripts/audit-trigger-contract.test.ts src/tools/consent-record-db-contract.test.ts src/__tests__/audit-log-conventions-static.test.ts src/app/api/__tests__/api-conventions-static.test.ts --reporter=dot --testTimeout=30000`: passed, 14 files / 151 tests.
- `pnpm exec eslint ...`: passed for touched UI/API/helper/tool/test files.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Consent document download audit still cannot directly resolve a `ConsentRecord` context because `ConsentRecord` stores only `document_url`; a stronger file-id linkage or resolver remains needed.
- Audit log search UI still lacks first-class filters for `consent_record`, `PatientShareConsent`, and `file_download` actions.
- ConsentRecord expiry/document update UI remains absent; only the API PATCH path is covered.
- Phase 1 still needs actor pharmacy/site context completion in remaining read audits, share-scope update/audit, patient-share-case creation UI, visit request creation UI, and stronger management-plan version evidence.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1813 JST - Patient Share Case Creation From Patient Card Slice

### Completed

- Re-read the v0.2 share-case specification around patient master creation, share scope, consent blocking, and management-plan version selection, then treated the higher-version workflow as SSOT over older workflow-only behavior.
- Added a patient-card `薬局間共有ケース` panel immediately after `在宅運用管理` and before the first-visit document panel in both active-workspace and empty-workspace patient card paths.
- Let operators create a draft patient share case from the patient master with active partnership selection, optional care case, optional approved management-plan version, date window, and canonical share-scope toggles.
- Kept creation as draft-only; the patient card does not call activation and directs consent/link/start checks back to the pharmacy-cooperation workflow.
- Kept the panel PHI-minimized: it does not render patient name, phone, address, management-plan title, raw snapshots, or free-text patient content.
- Hardened `GET/POST /api/patient-share-cases` with `private, no-store` sensitive responses, canonical `share_scope` allowlisting, `scope_keys` response projection, and active partnership / active partner-pharmacy creation guards.
- Tightened create audit metadata to log only enabled canonical share-scope keys and compact IDs/dates, dropping unknown share-scope keys and raw JSON from responses and audit assertions.

### Files Changed

- `src/app/(dashboard)/patients/[id]/card-workspace.tsx`
- `src/app/(dashboard)/patients/[id]/card-workspace.test.tsx`
- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/card-workspace.tsx' 'src/app/(dashboard)/patients/[id]/card-workspace.test.tsx' src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts`: passed.
- `pnpm exec vitest run src/app/api/patient-share-cases/route.test.ts 'src/app/(dashboard)/patients/[id]/card-workspace.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 35 tests.
- `pnpm exec eslint src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts 'src/app/(dashboard)/patients/[id]/card-workspace.tsx' 'src/app/(dashboard)/patients/[id]/card-workspace.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Phase 1 still needs share-scope update/audit for existing share cases and actor pharmacy/site context completion in remaining read audits.
- Browser-level workflow proof across patient card creation, workflow consent/link/activation, visit request, partner record, billing, and report draft paths remains pending.
- Consent document download audit still cannot directly resolve a `ConsentRecord` context because `ConsentRecord` stores only `document_url`.
- ConsentRecord expiry/document update UI remains absent; only the API PATCH path is covered.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1821 JST - Patient Share Scope Update Audit Slice

### Completed

- Added `PATCH /api/patient-share-cases/:id` for existing patient share-case scope updates, keeping the response PHI-minimized and no-store.
- Moved canonical patient share-scope keys/defaults/normalization into `src/server/services/patient-share-scope.ts` and reused it from the collection route and new detail route.
- Kept unknown or non-boolean scope keys out of persisted `PatientShareCase.share_scope`, responses, and audits.
- Added fail-closed active-share protection: active share cases can only move to a scope covered by an active, unrevoked patient-share consent.
- Added compact `patient_share_case_scope_updated` audit metadata with previous/current enabled scope keys and counts only.
- Registered the new PATCH route in the operational route catalog and rate-limit canonicalization templates.

### Files Changed

- `src/app/api/patient-share-cases/[id]/route.ts`
- `src/app/api/patient-share-cases/[id]/route.test.ts`
- `src/app/api/patient-share-cases/route.ts`
- `src/server/services/patient-share-scope.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/patient-share-scope.ts 'src/app/api/patient-share-cases/[id]/route.ts' 'src/app/api/patient-share-cases/[id]/route.test.ts' src/app/api/patient-share-cases/route.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm exec vitest run 'src/app/api/patient-share-cases/[id]/route.test.ts' src/app/api/patient-share-cases/route.test.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts --reporter=dot --testTimeout=30000`: passed, 5 files / 53 tests.
- `pnpm exec eslint src/server/services/patient-share-scope.ts 'src/app/api/patient-share-cases/[id]/route.ts' 'src/app/api/patient-share-cases/[id]/route.test.ts' src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Phase 1 still needs actor pharmacy/site context completion in remaining read audits.
- Browser-level workflow proof across patient card creation, consent/link/activation, visit request, partner record, billing, and report draft paths remains pending.
- Consent document download audit still cannot directly resolve a `ConsentRecord` context because `ConsentRecord` stores only `document_url`.
- ConsentRecord expiry/document update UI remains absent; only the API PATCH path is covered.
- Migration application remains unattempted; prior `prisma migrate diff --from-migrations` is still blocked by missing `datasource.shadowDatabaseUrl` in `prisma.config.ts`.

## 20260619-1845 JST - Audit Actor Pharmacy/Site Context Slice

### Completed

- Re-checked the v0.2 audit contract for `actor_user_id`, `actor_pharmacy_id`, patient linkage, and shared-case read events against the current PH-OS `AuditLog` model.
- Added structured `AuditLog.actor_pharmacy_id`, `AuditLog.actor_site_id`, and `AuditLog.patient_id` columns plus an append-only migration with backfill and index coverage.
- Documented and implemented `actor_pharmacy_id` as the current PH-OS tenant pharmacy (`org_id`) while keeping `actor_site_id` as a nullable validated `PharmacySite` context.
- Propagated `defaultSiteId` through NextAuth JWT/session and resolved `AuthContext.actorSiteId` only after verifying the site belongs to the org and the actor has site or universal membership.
- Added RLS session settings for `app.current_actor_pharmacy_id` and `app.current_actor_site_id`, and updated the generic DB audit trigger to persist these actor fields plus row-level `patient_id` when available.
- Updated app audit helpers, data export audit, file-download audit, audit-log filters, audit-log API, and audit-log CSV export to write/search/export actor pharmacy, actor site, and patient context.
- Added patient linkage to patient-share-case create/list/scope, shared consent list/register, and correction request create/list audit events.
- Added fail-closed `patient_share_correction_requests_viewed` read audit coverage to `GET /api/patient-share-cases/:id/correction-requests`.

### Files Changed

- `prisma/schema/admin.prisma`
- `prisma/migrations/20260619190000_add_audit_actor_context/migration.sql`
- `src/lib/auth/context.ts`
- `src/lib/auth/config.ts`
- `src/types/next-auth.d.ts`
- `src/lib/auth/request-context.ts`
- `src/lib/db/rls.ts`
- `src/lib/audit/audit-entry.ts`
- `src/server/services/export-audit.ts`
- `src/server/services/file-download-audit.ts`
- `src/lib/api/audit-log-filters.ts`
- `src/app/api/audit-logs/route.ts`
- `src/app/api/audit-logs/export/route.ts`
- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/[id]/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/correction-requests/route.ts`
- Related unit tests for the files above.

### Validation

- `pnpm db:generate`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm exec vitest run src/lib/audit/audit-entry.test.ts src/server/services/export-audit.test.ts src/server/services/file-download-audit.test.ts src/lib/db/__tests__/rls.test.ts src/lib/auth/__tests__/context.test.ts src/lib/auth/config.test.ts src/app/api/audit-logs/route.test.ts src/app/api/audit-logs/export/route.test.ts src/app/api/patient-share-cases/route.test.ts 'src/app/api/patient-share-cases/[id]/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 12 files / 107 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed after targeted Prettier.
- `git diff --check`: passed.

### Remaining / Next Loop

- Browser-level workflow proof across patient card creation, consent/link/activation, visit request, partner record, billing, and report draft paths remains pending.
- Consent document download audit still cannot directly resolve a `ConsentRecord` context because `ConsentRecord` stores only `document_url`.
- ConsentRecord expiry/document update UI remains absent; only the API PATCH path is covered.
- The new migration was generated and schema-validated but not applied to a live database in this turn.

## 20260619-1909 JST - ConsentRecord Document File Context and Update UI Slice

### Completed

- Re-read the v0.2 `FR-004`, `FR-019`, `P1-06`, `P1-27`, and `P1-28` requirements against the current `ConsentRecord` UI/API and file-download audit path.
- Added durable `ConsentRecord.document_file_id` linkage to `FileAsset`, with a migration that backfills only canonical audited URLs whose `FileAsset` exists before adding the FK.
- Updated consent create/PATCH APIs to persist `document_file_id` alongside the audited URL, and to clear both the URL and file link when the document is cleared.
- Updated consent serialization and consent-record audit flags so `document_file_id` is the preferred, safe source for audited document access.
- Extended file-download audit context resolution to attach patient context for both `PatientShareConsent.file_asset_id` and `ConsentRecord.document_file_id`, with legacy fallback limited to the canonical relative audited URL.
- Updated `/api/files/:id/download` and `/api/files/:id/presigned-download` to pass resolved patient/site/consent context into fail-closed file download audit logging before returning JSON or redirect responses.
- Added the patient consent UI update dialog for active consent records, letting operators change expiry date and upload a replacement consent document through the existing FileAsset upload/complete flow while sending only `document_file_id` to PATCH.
- Hid mutation actions for expired/revoked consent records and added UI coverage that legacy redacted document URLs are not rendered as clickable links.
- Fixed validation drift found by the full test run: v0.2 pharmacy-cooperation models are now classified in the data-explorer coverage catalog, and stale audit-log tests now expect the standard actor pharmacy/site/patient/IP/user-agent fields already written by `createAuditLogEntry`.

### Files Changed

- `prisma/schema/admin.prisma`
- `prisma/schema/patient.prisma`
- `prisma/migrations/20260619193000_add_consent_record_document_file_id/migration.sql`
- `src/server/services/consent-record-documents.ts`
- `src/server/services/consent-record-audit.ts`
- `src/server/services/file-download-audit.ts`
- `src/app/api/consent-records/route.ts`
- `src/app/api/consent-records/[id]/route.ts`
- `src/app/api/files/[id]/download/route.ts`
- `src/app/api/files/[id]/presigned-download/route.ts`
- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx`
- `src/lib/admin/data-explorer-catalog.ts`
- Related unit tests for the files above plus stale audit expectation tests for conference notes, patient self reports, logout-all, and pharmacy stock review.

### Validation

- `pnpm db:generate`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm exec vitest run src/server/services/consent-record-documents.test.ts src/server/services/file-download-audit.test.ts src/server/services/consent-record-audit.test.ts src/app/api/consent-records/route.test.ts 'src/app/api/consent-records/[id]/route.test.ts' 'src/app/api/files/[id]/download/route.test.ts' 'src/app/api/files/[id]/presigned-download/route.test.ts' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 8 files / 60 tests.
- `pnpm exec vitest run src/lib/admin/data-explorer-catalog.test.ts src/app/api/conference-notes/route.test.ts 'src/app/api/conference-notes/[id]/route.test.ts' 'src/app/api/conference-notes/[id]/generate-report/route.test.ts' src/app/api/patient-self-reports/route.test.ts 'src/app/api/patient-self-reports/[id]/route.test.ts' src/app/api/me/logout-all/route.test.ts src/app/api/pharmacy-drug-stocks/review/route.test.ts --reporter=dot --testTimeout=30000`: passed, 8 files / 90 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed after targeted Prettier.
- `git diff --check`: passed.
- `pnpm test -- --reporter=dot --testTimeout=30000`: passed, 1039 files / 8145 tests; 1 file and 1 test skipped.
- `pnpm build`: passed with Next.js 16.2.9 webpack build.

### Remaining / Next Loop

- Browser-level workflow proof across patient card creation, consent/link/activation, visit request, partner record, billing, and report draft paths remains pending.
- The v0.2 migrations, including `20260619193000_add_consent_record_document_file_id`, were generated and schema/build validated but not applied to a live database in this turn.

## 20260619-1951 JST - Pharmacy Cooperation Route-Mocked Browser Proof

### Completed

- Re-read the full higher-version v0.2 pharmacy-cooperation specification, including monthly billing, contract-document, refactoring, testing, and completion criteria sections.
- Added a route-mocked Playwright proof for the pharmacy cooperation operator path from an existing draft share case through consent registration, base/partner patient-link decisions, share activation, pharmacy visit request creation, partner visit record draft/submission/base confirmation, physician report draft creation, billing candidate generation, and invoice PDF link exposure.
- Kept the browser proof PHI-minimized: patient name/address/request-reason text is asserted absent from the workflow and billing list views, while request payload assertions still verify the protected API receives the intended clinical details.
- Reused the existing patient-card unit coverage for draft share-case creation because direct `/patients/[id]` browser rendering currently requires unapplied local e2e DB migrations.

### Files Changed

- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `pnpm exec eslint tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `git diff --check`: passed.
- `pnpm format:check`: passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium -g "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test.
- `pnpm typecheck`: passed.
- `pnpm test -- 'src/app/(dashboard)/patients/[id]/card-workspace.test.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx'`: passed. Vitest executed the full suite, 1039 files passed / 1 skipped; 8145 tests passed / 1 skipped.
- `pnpm lint`: passed.

### Blocked / Not Applied

- A direct patient-card browser step was attempted, but `/patients/pharmacy_coop_route_patient` hit Prisma P2022 because the local e2e DB is missing `ConsentRecord.document_file_id`; the earlier accidental broader E2E run also exposed missing `AuditLog.actor_pharmacy_id`. Migration application was not run because repo instructions require prior approval for migration apply or other DB mutation operations.
- The first `pnpm test:e2e:local -- ...` invocation passed an extra `--` through the package script and began unrelated tests; it was interrupted. The failures observed there were from existing PCA/billing tests against the same stale e2e DB schema, not from the new route-mocked pharmacy-cooperation test.
- New v0.2 migrations still need approved application against the local/live target DB before authenticated real-data browser evidence can cover patient-card SSR directly.

## 20260619-2004 JST - Pharmacy Contract Document API Foundation

### Completed

- Re-read the higher-version v0.2 pharmacy-cooperation specification sections for contract documents, fee schedules, PDF/save handling, audit, and common API foundations.
- Added `/api/pharmacy-contracts/[id]/documents` with:
  - `GET` list for generated contract documents under org-scoped contract ownership.
  - `POST mode=preview` to render a contract document preview from a `contract_document` template, the selected/latest contract version, and the active fee rule.
  - `POST mode=save` to persist a `ContractDocument` row with template/version/file/hash metadata.
- Added a contract-document service that requires template-managed articles 1 through 23, replaces safe contract placeholders, renders a fee schedule section, and hashes the rendered snapshot.
- Added signed-PDF attachment validation so `signed_file_id` must be a same-org completed `FileAsset` before document creation.
- Added minimized audit for saved contract documents: metadata only, no contract body, article body, patient data, filenames, storage keys, or signed URLs.
- Registered the new route in API route catalog and rate-limit template catalogs.

### Files Changed

- `src/server/services/pharmacy-contract-documents.ts`
- `src/app/api/pharmacy-contracts/[id]/documents/route.ts`
- `src/app/api/pharmacy-contracts/[id]/documents/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm vitest run 'src/app/api/pharmacy-contracts/[id]/documents/route.test.ts'`: passed, 1 file / 5 tests.
- `pnpm typecheck`: passed.
- `pnpm vitest run src/lib/api/rate-limit.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts 'src/app/api/pharmacy-contracts/[id]/documents/route.test.ts'`: passed, 4 files / 43 tests.
- `pnpm exec prettier --write src/server/services/pharmacy-contract-documents.ts 'src/app/api/pharmacy-contracts/[id]/documents/route.ts' 'src/app/api/pharmacy-contracts/[id]/documents/route.test.ts' src/lib/api/rate-limit.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts Plans.md CODEX_GOAL_PROGRESS.md`: passed.
- `pnpm exec eslint src/server/services/pharmacy-contract-documents.ts 'src/app/api/pharmacy-contracts/[id]/documents/route.ts' 'src/app/api/pharmacy-contracts/[id]/documents/route.test.ts' src/lib/api/rate-limit.ts src/lib/api/route-catalog.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Operator UI for contract template preview/save/attach is not wired yet.
- The route persists document metadata and can attach a signed PDF `FileAsset`, but a first-party binary PDF generator/storage step for contract documents remains to be added if required before full v0.2 close.
- Existing contract status enums still use older `ended` / `archived` states in some places and should be aligned to the higher-version spec states (`expired` / `terminated`) in a separate migration-aware slice.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.

## 20260619-2011 JST - Pharmacy Contract Status Alignment

### Completed

- Re-read the v0.2 contract-state requirement and treated its status list as the higher-version SSOT for `PharmacyContractStatus`.
- Updated `prisma/schema/pharmacy-partnership.prisma` so contract statuses are `draft`, `pending_base_approval`, `pending_partner_approval`, `active`, `expired`, `terminated`, and `suspended`.
- Added a migration that renames existing enum values from `ended` to `terminated` and from `archived` to `expired` without applying it to a database.
- Updated contract list filtering and contract-version creation guards to use `expired` / `terminated`.
- Updated the pharmacy cooperation admin status labels/variants so contract terminal states display as v0.2 `期限切れ` / `終了` while leaving non-contract `archived` and partnership `ended` labels intact.
- Added tests that reject legacy `ended` status filters, accept the v0.2 `terminated` filter, and block version creation for both `expired` and `terminated` contracts.

### Files Changed

- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619200600_align_pharmacy_contract_statuses/migration.sql`
- `src/app/api/pharmacy-contracts/route.ts`
- `src/app/api/pharmacy-contracts/route.test.ts`
- `src/app/api/pharmacy-contracts/[id]/versions/route.ts`
- `src/app/api/pharmacy-contracts/[id]/versions/route.test.ts`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/`: passed.
- `pnpm vitest run src/app/api/pharmacy-contracts/route.test.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.test.ts' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed, 3 files / 15 tests.
- `pnpm exec prettier --write ...` over `.sql` / `.prisma` initially failed because no parser is configured for those file types; rerun over TS/TSX files passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm db:generate`: passed.
- `pnpm typecheck`: passed.
- Targeted `pnpm exec eslint` over touched TS/TSX files: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Migration was generated and validated but not applied to any database, per repository DB mutation rules.
- Broader v0.2 lifecycle statuses for patient share cases and visit requests still differ from the full specification and should be reviewed in separate migration-aware slices.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.

## 20260619-2034 JST - Patient Share Case Status Alignment

### Completed

- Re-read the v0.2 patient-share-case lifecycle requirement and treated it as the higher-version SSOT over the existing `pending_partner` flow.
- Updated `PatientShareCaseStatus` to `draft`, `consent_pending`, `partner_confirmation_pending`, `active`, `suspended`, `ended`, `revoked`, and `declined`.
- Added a migration that adds `consent_pending` / `declined` and renames existing `pending_partner` values to `partner_confirmation_pending` without applying it to a database.
- Changed create/consent/link/activation behavior so new share cases start at `consent_pending`, consent registration advances to `partner_confirmation_pending`, activation is allowed only from partner confirmation or suspended states with active consent and accepted link, and patient-link decline closes the share case as `declined`.
- Updated workflow labels, terminal-state guards, consent create availability, policy tests, route tests, and route-mocked browser proof to follow the v0.2 order: consent, base approval, partner acceptance, activation.

### Files Changed

- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619202000_align_patient_share_case_statuses/migration.sql`
- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `src/app/api/patient-share-cases/[id]/route.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.test.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.test.ts`
- `src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.test.ts`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm db:generate`: passed.
- `pnpm vitest run src/server/services/pharmacy-partnerships.test.ts src/app/api/patient-share-cases/route.test.ts 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' 'src/app/api/patient-share-cases/[id]/patient-link/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.test.ts' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed, 7 files / 48 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm exec prettier --write tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `pnpm exec eslint tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- Initial route-mocked Playwright rerun failed because the existing proof still activated before registering consent; after updating the proof to the v0.2 order, rerun passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium -g "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Migration was generated and validated but not applied to any database, per repository DB mutation rules.
- Visit request lifecycle statuses still need a separate migration-aware v0.2 alignment slice.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.

## 20260619-2050 JST - Pharmacy Visit Request Status Alignment

### Completed

- Re-read the v0.2 visit-request lifecycle requirement and treated it as the higher-version SSOT over the older `cancelled` / `expired` / direct-`completed` flow.
- Updated `PharmacyVisitRequestStatus` to `draft`, `requested`, `accepted`, `declined`, `scheduled`, `visited`, `recording`, `submitted`, `base_reviewing`, `returned`, `confirmed`, `physician_report_created`, `claim_checked`, and `completed`.
- Added a migration that maps existing `cancelled` / `expired` visit requests to `declined` while recreating the enum; the migration was generated and validated but not applied to any database.
- Advanced visit requests through the v0.2 operational states: partner draft save moves `accepted` / `returned` to `recording`, partner submit moves to `submitted`, base review confirm moves to `confirmed`, base return moves to `returned`, physician report draft moves `confirmed` to `physician_report_created`, and billing candidate generation moves confirmed/report-created requests to `claim_checked`.
- Tightened billing candidate eligibility so candidate creation requires base-confirmed-or-later request status, satisfying the v0.2 rule that billing candidates must not be made before base pharmacy confirmation.
- Updated workflow UI labels, focused API/service/UI tests, and the route-mocked browser proof to reflect the full v0.2 status progression.

### Files Changed

- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619204000_align_pharmacy_visit_request_statuses/migration.sql`
- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `src/server/services/partner-visit-report-drafts.ts`
- `src/server/services/partner-visit-report-drafts.test.ts`
- `src/app/api/pharmacy-visit-requests/route.ts`
- `src/app/api/pharmacy-visit-requests/route.test.ts`
- `src/app/api/partner-visit-records/route.ts`
- `src/app/api/partner-visit-records/route.test.ts`
- `src/app/api/partner-visit-records/[id]/submit/route.ts`
- `src/app/api/partner-visit-records/[id]/submit/route.test.ts`
- `src/app/api/partner-visit-records/[id]/review/route.ts`
- `src/app/api/partner-visit-records/[id]/review/route.test.ts`
- `src/app/api/visit-billing-candidates/route.ts`
- `src/app/api/visit-billing-candidates/route.test.ts`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm db:generate`: passed.
- Focused `pnpm vitest run` over pharmacy partnership policy, partner visit report drafts, pharmacy visit requests, partner visit record create/submit/review, physician report draft, visit billing candidates, and pharmacy cooperation workflow UI: passed, 10 files / 45 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: initially failed on `src/app/api/partner-visit-records/[id]/review/route.ts`; after targeted Prettier, rerun passed.
- `git diff --check`: passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium -g "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test.

### Remaining / Next Loop

- Migration was generated and validated but not applied to any database, per repository DB mutation rules.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.
- Remaining v0.2 gaps should be re-audited against the attached specification now that contract, share-case, and visit-request lifecycle enums are aligned.

## 20260619-2100 JST - Contract Document Operator UI

### Completed

- Re-read the v0.2 contract-document requirements for contract template selection, fee schedule generation, contract preview, saved contract documents, and signed-PDF attachment metadata.
- Extended the existing pharmacy cooperation setup screen to fetch `contract_document` templates and the selected contract's generated documents.
- Added a contract-document operator panel that selects a contract/template, previews the rendered contract and fee schedule through `/api/pharmacy-contracts/[id]/documents`, saves `ContractDocument` rows, and records optional signed PDF `FileAsset` ID plus signature date through the existing API.
- Added a saved contract-document list with document hash, signed PDF attachment state, signature date, and saved date so operators can return to previously generated contract documents.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed.
- `pnpm vitest run 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 4 tests.
- `pnpm typecheck`: passed.
- Targeted `pnpm exec eslint` over the setup UI and test: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- This UI uses the existing FileAsset ID attach contract; first-party upload controls for signed contract PDFs can be added later if operators should upload from the same panel.
- First-party binary PDF generation/storage for unsigned contract previews remains a follow-up if required before full v0.2 close.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.

## 20260619-2125 JST - Contract Document PDF Storage And Upload

### Completed

- Added first-party contract document PDF rendering from the frozen contract preview snapshot and attached generated PDFs to saved `ContractDocument` rows.
- Added `contract-document` as a dedicated FileAsset purpose for both generated PDFs and signed-PDF uploads, with PDF-only MIME validation, contract-document storage prefixes, 7-year default retention metadata, KMS/report-key reuse, and canonical FileAsset write failure as a hard failure for contract documents.
- Replaced manual signed PDF FileAsset ID entry in the pharmacy cooperation setup UI with the normal `presigned-upload -> PUT -> complete` upload flow, then saved the completed FileAsset ID through the contract document API.
- Tightened signed-file validation so `signed_file_id` must be an uploaded, unused, same-org `contract-document` PDF without patient/visit/report/job references.
- Minimized contract document creation audit metadata by removing contract body, file IDs, signed date values, hash, billing amount, billing model, and tax category from the audit payload.
- Added contract-document context to file download audit resolution so downloads record contract document/contract/version identifiers without filenames, storage keys, signed URLs, hashes, contract body, patient data, or fee values.
- Restricted contract-document listing to `canManagePatientSharing`, matching create/upload/download access expectations.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `src/app/api/files/[id]/download/route.ts`
- `src/app/api/files/[id]/presigned-download/route.ts`
- `src/app/api/files/presigned-upload/route.ts`
- `src/app/api/files/presigned-upload/route.test.ts`
- `src/app/api/pharmacy-contracts/[id]/documents/route.ts`
- `src/app/api/pharmacy-contracts/[id]/documents/route.test.ts`
- `src/server/services/file-download-audit.ts`
- `src/server/services/file-download-audit.test.ts`
- `src/server/services/file-storage.ts`
- `src/server/services/file-storage.test.ts`
- `src/server/services/pdf-pharmacy-contract-document.tsx`
- `src/server/services/pdf-pharmacy-contract-document.test.tsx`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm vitest run 'src/app/api/pharmacy-contracts/[id]/documents/route.test.ts' src/server/services/file-storage.test.ts src/server/services/pdf-pharmacy-contract-document.test.tsx 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' src/app/api/files/presigned-upload/route.test.ts src/server/services/file-download-audit.test.ts 'src/app/api/files/[id]/download/route.test.ts' 'src/app/api/files/[id]/presigned-download/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 8 files / 135 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Real S3/DB upload/download was not executed in this slice; behavior is covered by unit/component tests and existing file API abstractions.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.
- New migrations were not applied to any database in this slice.

## 20260619-2140 JST - Pharmacy Invoice Lifecycle Actions

### Completed

- Re-read the v0.2 monthly billing requirements for invoice issue, cancellation, reissue, payment schedule, payment recording, snapshot preservation, and audit events.
- Added `transitionPharmacyInvoice` as the request-boundary state machine for `PharmacyInvoice` lifecycle actions: issue, mark sent, mark received, schedule payment, record payment, cancel, and reissue.
- Added `PATCH /api/pharmacy-invoices/[id]` with strict action-specific validation, Serializable transaction wrapping, safe 404/409 error mapping, sensitive no-store responses, and `canManageBilling` authorization.
- Updated the partner-cooperation billing UI so operators can issue, send, receive, schedule payment, record payment, cancel, and reissue monthly invoice/free-report rows from the history table.
- Added lifecycle audit actions to the audit-log filter vocabulary. Audit metadata records only IDs, status, document kind, item counts, date-presence flags, scheduled date, and reason length; it does not include item snapshots, patient names, filenames, fee JSON, or reason bodies.
- Kept this slice migration-free. The payment scheduled date is captured in the invoice lifecycle snapshot and audit metadata because the current `PharmacyInvoice` schema has no dedicated scheduled-payment date column.

### Files Changed

- `src/server/services/pharmacy-invoices.ts`
- `src/server/services/pharmacy-invoices.test.ts`
- `src/app/api/pharmacy-invoices/[id]/route.ts`
- `src/app/api/pharmacy-invoices/[id]/route.test.ts`
- `src/app/api/pharmacy-invoices/route.ts`
- `src/app/api/pharmacy-invoices/route.test.ts`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/audit-logs/filter-options.ts`
- `src/lib/audit-logs/filter-options.test.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over touched TS/TSX files: passed.
- `pnpm vitest run src/server/services/pharmacy-invoices.test.ts src/app/api/pharmacy-invoices/route.test.ts 'src/app/api/pharmacy-invoices/[id]/route.test.ts' 'src/app/api/pharmacy-invoices/[id]/pdf/route.test.ts' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' src/lib/api/route-catalog.test.ts src/lib/api/rate-limit.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/audit-logs/filter-options.test.ts --reporter=dot --testTimeout=30000`: passed, 9 files / 64 tests.
- `pnpm typecheck`: passed.
- Targeted `pnpm exec eslint` over touched TS/TSX files: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Payment scheduled date remains JSON-backed rather than first-class schema because this slice intentionally avoided a migration. If operators need reporting/search by scheduled payment date, add a dedicated nullable `payment_scheduled_for @db.Date` column in a migration-aware slice.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.
- Real DB/S3/browser execution was not run in this slice; behavior is covered by service, route, and component tests.

## 20260619-2148 JST - Pharmacy Invoice Payment Schedule Column

### Completed

- Promoted the v0.2 payment-schedule field from invoice lifecycle JSON to a first-class nullable `PharmacyInvoice.payment_scheduled_for @db.Date` column.
- Added an expand-only migration, `20260619214500_add_pharmacy_invoice_payment_schedule`, with an org/date index for future payment-schedule search and reporting.
- Updated invoice lifecycle transitions so `schedule_payment` writes both the queryable date column and the minimized lifecycle snapshot/audit metadata.
- Updated invoice list responses and partner-cooperation billing UI rows to expose/display the scheduled payment date.

### Files Changed

- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619214500_add_pharmacy_invoice_payment_schedule/migration.sql`
- `src/server/services/pharmacy-invoices.ts`
- `src/server/services/pharmacy-invoices.test.ts`
- `src/app/api/pharmacy-invoices/route.ts`
- `src/app/api/pharmacy-invoices/route.test.ts`
- `src/app/api/pharmacy-invoices/[id]/route.test.ts`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm db:generate`: passed.
- Targeted Prettier over touched TS/TSX files: passed.
- `pnpm vitest run src/server/services/pharmacy-invoices.test.ts src/app/api/pharmacy-invoices/route.test.ts 'src/app/api/pharmacy-invoices/[id]/route.test.ts' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 4 files / 20 tests.
- `pnpm typecheck`: passed.
- Targeted `pnpm exec eslint` over touched TS/TSX files: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Migration was generated and validated but not applied to any database.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.
- Remaining v0.2 gap candidates include patient/visit request message-thread integration and notification service reuse for pharmacy-cooperation lifecycle events.

## 20260619-2204 JST - Pharmacy Cooperation Message Threads

### Completed

- Added first-class v0.2 pharmacy cooperation message thread schema for patient-share-case and visit-request contexts.
- Added an expand-only migration, `20260619223000_add_pharmacy_cooperation_message_threads`, with org-scoped FKs, RLS, context uniqueness, body length check, and DB-triggered audit redaction for message bodies.
- Added `GET/POST /api/pharmacy-cooperation-message-threads`; both routes require active patient share case access, use no-store responses, and write explicit read/create audit events with patient context but without message body text.
- Reused the existing notification service for new message notifications with PHI-free title/message and safe workflow links. Visit-request messages explicitly notify the original requester when the sender differs.
- Registered the route in the operational route catalog and rate-limit template list.

### Files Changed

- `prisma/schema/organization.prisma`
- `prisma/schema/pharmacy-partnership.prisma`
- `prisma/migrations/20260619223000_add_pharmacy_cooperation_message_threads/migration.sql`
- `src/app/api/pharmacy-cooperation-message-threads/route.ts`
- `src/app/api/pharmacy-cooperation-message-threads/route.test.ts`
- `src/lib/api/route-catalog.ts`
- `src/lib/api/route-catalog.test.ts`
- `src/app/api/meta/route-catalog/route.test.ts`
- `src/lib/api/rate-limit.ts`
- `src/lib/api/rate-limit.test.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma format --schema=prisma/schema/`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm db:generate`: passed.
- Targeted Prettier over touched TS files: passed.
- `pnpm exec vitest run src/app/api/pharmacy-cooperation-message-threads/route.test.ts src/lib/api/route-catalog.test.ts src/app/api/meta/route-catalog/route.test.ts src/lib/api/rate-limit.test.ts`: passed, 4 files / 42 tests.
- `pnpm typecheck`: passed after tightening route union and JSON input types.
- Targeted `pnpm exec eslint` over touched TS files: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.
- `pnpm exec prettier --check` over touched TS files: passed.
- `pnpm format:check`: failed on unrelated dirty UI files already present in the worktree: `src/components/ui/confirm-dialog.tsx`, `src/components/ui/error-state.tsx`, and `src/components/ui/switch.tsx`.

### Remaining / Next Loop

- Migration was generated and validated but not applied to any database.
- The workflow UI still needs a message list/posting surface and browser proof for patient-share-case and visit-request message contexts.
- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.

## 20260619-2230 JST - PH-OS Clinical Workbench Language and Common UI Refresh

### Loop UI-0 - Baseline / Protected Surface

- Re-read `docs/ui-ux-design-guidelines.md` before UI edits.
- Re-confirmed local Next.js 16 docs already read for App Router client boundaries, accessibility, and error handling in this UI goal.
- Confirmed `/dispense`, `/audit`, `/set`, and `/set-audit` all mount `DispensingWorkbench` through `PageScaffold variant="bare"` with padding/min-height neutralized.
- Decision: these four main screens remain the visual/interaction base and are not redesigned in this slice. Shared `PageScaffold` updates are limited to general/card pages and do not alter the workbench component itself.

### Loop UI-1 - Research Synthesis

External design research integrated into the PH-OS UI SSOT:

- Apple HIG: fit primary content to the screen, keep controls near modified content, maintain 44pt-class hit targets.
- Google Material 3 / Expressive: use color, size, shape, and containment to guide attention, while preserving familiar patterns and text labels.
- Adobe Spectrum 2: prioritize inclusive accessibility, density/contrast adaptation, and clearer focus hierarchy.
- Zoom Apps: respect operator time and attention through concise wording, consistent flows, and minimal setup.
- Atlassian Design System: separate foundation, component, and pattern layers so common problems are solved once.
- NHS / WCAG 2.2: treat accessibility and failure-state clarity as clinical safety concerns.

Adjacent UI candidates evaluated:

| Candidate                                                        | Term  | Priority | Reuse target                               | Decision                                                              |
| ---------------------------------------------------------------- | ----- | -------- | ------------------------------------------ | --------------------------------------------------------------------- |
| PH-OS Clinical Workbench Language in UI SSOT                     | Short | High     | `docs/ui-ux-design-guidelines.md`          | Implemented                                                           |
| General page working-area expansion                              | Short | High     | `PageScaffold`, `PageSection`              | Implemented                                                           |
| Visible error/empty descriptions and live error announcements    | Short | High     | `ErrorState`, `EmptyState`                 | Implemented                                                           |
| Data table export/print invalid-state gating and row labels      | Short | High     | `DataTable`                                | Implemented                                                           |
| Wider clinical workflow dialogs                                  | Short | Medium   | `DialogContent`                            | Implemented and applied to report send dialog                         |
| Communication/request and patient-packaging query failure states | Mid   | High     | `ErrorState`, query screens                | Deferred to next UI error-state loop                                  |
| Full visual overhaul of every general screen                     | Long  | High     | shared scaffold/section/table/dialog first | Continue incrementally; direct broad rewrite would duplicate patterns |

### Loop UI-2 - Implementation

Implemented:

- Added `PH-OS Clinical Workbench Language` to `docs/ui-ux-design-guidelines.md`, with the dispensing/audit/set workbench as the canonical base and Apple/Google/Adobe/Zoom/Atlassian/NHS/WCAG synthesis.
- Updated `PageScaffold` default padding and stack spacing to give general pages a wider, more deliberate work area (`space-y-6`).
- Updated `PageSection` to use the clinical section marker, slightly tighter radius, wider padding on larger screens, and wrapped action groups.
- Updated `ErrorState` so descriptions are visible by default and dynamic errors announce via `aria-live="polite"` unless `live="off"` is requested.
- Updated `EmptyState` so guidance text is visible instead of hidden behind a help popover.
- Updated `DataTable` with `getRowA11yLabel`, row-aware selection/expand labels, and default export/print disabling for loading, error, and empty states.
- Applied table row labels to billing candidates and task list rows.
- Added `DialogContent size` variants and applied `size="2xl"` to the report send confirmation dialog.
- Ran Prettier on existing dirty pharmacy-cooperation and partner-cooperation billing UI files to restore repository format checks.
- Preserved existing API, DB schema, permission, audit, and protected workbench flows.

### Validation

- `pnpm exec vitest run src/components/ui/confirm-dialog.test.tsx src/components/ui/switch.test.tsx src/components/ui/data-table.test.tsx src/components/ui/dialog.test.tsx src/components/ui/empty-state.test.tsx src/components/ui/error-state.test.tsx src/components/layout/app-header.test.tsx src/components/layout/sidebar.test.tsx`: passed, 8 files / 47 tests.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx' 'src/app/(dashboard)/reports/[id]/page.test.tsx'`: passed, 6 files / 26 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- `pnpm build`: passed with Next.js 16.2.9 webpack build.

### Remaining / Blocked

- Direct authenticated browser proof remains blocked by the existing unapplied v0.2 local e2e DB migrations.
- Broad visual replacement of every screen should continue through the shared UI layer and representative screen slices, not by parallel one-off page rewrites.
- Next actionable UI loop: apply the new `ErrorState` contract to high-risk false-empty query screens such as communication requests, patient packaging, schedule proposals, workflow dashboard, and report delivery analytics.

## 20260619-2216 JST - Pharmacy Cooperation Message UI

### Completed

- Connected the pharmacy cooperation workflow UI to `GET/POST /api/pharmacy-cooperation-message-threads`.
- Added an active-share-case scoped message panel with a patient-share-case thread target and optional visit-request target.
- Added message posting with trimmed body submission, existing org header handling, workflow cache invalidation, and busy/error handling aligned with the rest of the workflow.
- Added UI coverage for listing a patient-share-case message, switching to a visit-request message thread, and posting a visit-request-scoped message.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over the two touched workflow files: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed, 1 file / 9 tests.
- Targeted `pnpm exec eslint` over the two touched workflow files: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.

### Remaining / Next Loop

- Direct authenticated browser proof for message threads remains blocked until v0.2 migrations are approved/applied to the local e2e DB.
- Unrelated dirty UI changes remain in the worktree and were not included in this slice's commits.

## 20260619-2217 JST - PH-OS UI Safety and Accessibility Slice

### Completed

- Reused shared `Button` styling in `EmptyState` and `ErrorState` link actions so empty/error recovery actions keep the same 44px target and variant behavior as the rest of PH-OS.
- Hardened `ConfirmDialog` with unique generated input IDs, optional custom body content, and an external disabled gate while preserving existing call sites.
- Added Switch hit-area expansion without changing the compact visual size.
- Connected the sidebar logout button to `next-auth` sign-out and changed the header help shortcut to the actual settings destination.
- Added rollback and toast feedback when care-mode preference saving fails.
- Added missing accessible labels to non-native selects in patient master, contacts, care team, conditions, and report send channel flows.
- Added a confirmation gate to partner-cooperation billing invoice lifecycle actions. PATCH now occurs only after confirmation; `cancel` and `reissue` require a non-empty trimmed reason.
- Reduced billing-page privacy leakage by replacing raw fetch `error.message` details with a safe fixed support message and by hiding internal invoice IDs from the history table/action labels.

### Files Changed

- `src/components/ui/empty-state.tsx`
- `src/components/ui/empty-state.test.tsx`
- `src/components/ui/error-state.tsx`
- `src/components/ui/error-state.test.tsx`
- `src/components/ui/confirm-dialog.tsx`
- `src/components/ui/confirm-dialog.test.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/switch.test.tsx`
- `src/components/layout/sidebar.tsx`
- `src/components/layout/sidebar.test.tsx`
- `src/components/layout/app-header.tsx`
- `src/components/layout/app-header.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-master-card.tsx`
- `src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-contacts-panel.tsx`
- `src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-conditions-card.tsx`
- `src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx`
- `src/app/(dashboard)/reports/[id]/page.tsx`
- `src/app/(dashboard)/reports/[id]/page.test.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Baseline `pnpm format:check`: passed before this slice.
- Baseline `pnpm typecheck`: passed before this slice.
- Baseline `pnpm lint`: passed before this slice.
- Targeted Prettier over touched UI/test files: passed.
- `pnpm exec vitest run src/components/ui/empty-state.test.tsx src/components/ui/error-state.test.tsx src/components/ui/confirm-dialog.test.tsx src/components/ui/switch.test.tsx src/components/layout/sidebar.test.tsx src/components/layout/app-header.test.tsx 'src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx' 'src/app/(dashboard)/reports/[id]/page.test.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 12 files / 68 tests.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed with Next.js 16.2.9 webpack build.

### Remaining / Next Loop

- Direct authenticated browser proof remains blocked until v0.2 migrations are approved/applied to the local e2e DB.
- Remaining UI audit candidates include broader DataTable export audit routing, pharmacy-cooperation responsive table density, and expanded axe/browser coverage for reports/workflow/billing/admin pharmacy cooperation routes.

## 20260619-2231 JST - Pharmacy Cooperation Message Browser Proof

### Completed

- Extended the route-mocked pharmacy cooperation Playwright smoke to cover the v0.2 message panel.
- Added stateful route mocks for `GET/POST /api/pharmacy-cooperation-message-threads`.
- Verified browser interaction for posting a patient-share-case scoped message and a visit-request scoped message from the pharmacy cooperation workflow.
- Kept the direct patient-card browser proof blocked on unapplied local e2e DB migrations, while preserving route-mocked coverage for the workflow path that can run without DB mutation.

### Files Changed

- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `pnpm exec eslint tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `git diff --check`: passed.
- Temporary `pnpm dev:e2e:local` on `localhost:3012`: started and served the targeted smoke.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium -g "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- Direct patient-card browser proof remains blocked until the local e2e DB is prepared with the unapplied v0.2 migrations, including `AuditLog.actor_pharmacy_id` and `ConsentRecord.document_file_id`.
- New migrations were not applied to any database in this slice.
- Remaining v0.2 close-out work should continue with non-DB-mutating proof or wait for explicit migration-application approval.

## 20260619-2247 JST - Pharmacy Cooperation Confirmation Gate Verifier Follow-up

### Completed

- Ran a verifier pass over the already-implemented pharmacy cooperation confirmation gates.
- Closed the verifier's low-severity unit coverage gap by adding direct confirmation-before-fetch assertions for visit-request decline, partner-visit-record submit, and plain record confirmation without report draft.
- Preserved existing API payload expectations, including `decline_reason`, submit POST, `doctor_report_required: false`, and the existing `doctor_report_required: true` confirm+report coverage.
- Clarified the progress ledger so the 22:39 entry remains the implementation record and this entry records the verifier follow-up.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed, 1 file / 12 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec prettier --write docs/pharmacy-cooperation-v0.2-completion-audit.md`: passed.
- `pnpm exec prettier --write docs/pharmacy-cooperation-v0.2-completion-audit.md Plans.md CODEX_GOAL_PROGRESS.md .codex/ralph-state.md`: failed when Prettier reached 6.8MB `.codex/ralph-state.md` with Node heap OOM; the first three files were unchanged.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec prettier --write .codex/ralph-state.md`: failed with Node heap OOM. `tools/scripts/check-format-changed-files.mjs` excludes `.codex/`, so this file was verified by `git diff --check` instead.
- `pnpm format:check`: passed after formatting the new completion-audit document.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Verifier follow-up unit coverage was committed separately as `test(pharmacy): extend workflow confirmation gates`.
- Remaining UI audit candidates still include pharmacy-cooperation responsive table density, false-empty query screens, broader custom table/DataTable consolidation, select accessible-name gaps, and expanded browser/a11y coverage.

## 20260619-2239 JST - Pharmacy Cooperation Workflow Confirmation Gates

### Completed

- Added a shared `ConfirmDialog` gate for high-risk pharmacy cooperation workflow transitions: patient-share activation, patient-link approval/acceptance/decline, visit-request acceptance/decline, partner visit record submit/confirm/return, and physician report draft creation.
- Added per-action confirmation headings, labels, minimized detail lines, and destructive styling for decline/return operations.
- Replaced raw workflow query error detail rendering with a generic support-safe message.
- Updated the workflow UI unit tests and the route-mocked Playwright smoke so state-changing actions are proven to call APIs only after confirmation.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over touched workflow and Playwright files: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 10 tests.
- Targeted `pnpm exec eslint` over touched workflow and Playwright files: passed.
- `pnpm typecheck`: passed.
- Temporary `pnpm dev:e2e:local` on `localhost:3012`: started and served the targeted smoke.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium -g "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Local e2e DB remains behind 18 migrations, confirmed read-only by `prisma migrate status`.
- Direct patient-card browser proof and real migration application confirmation still require explicit approval to apply the pending migrations.

## 20260619-2244 JST - Pharmacy Cooperation v0.2 Completion Audit

### Completed

- Added `docs/pharmacy-cooperation-v0.2-completion-audit.md` as the current-state v0.2 final report/audit artifact.
- Mapped the attached specification's implementation targets into a feature inventory with state, evidence, remaining work, refactor status, and priority.
- Audited the 14 explicit completion criteria against current code, tests, route-mocked browser proof, and the known DB migration blocker.
- Documented the pending local e2e migration set from read-only `prisma migrate status`.
- Added a v0.2 migration application and rollback policy without applying any migration.

### Files Changed

- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Read `/Users/yusuke/.codex/attachments/a1d41d8b-d1ed-492b-bf6e-304ff52ab0af/pasted-text-1.txt` completely.
- Inspected model/API/UI/service/test evidence for pharmacy cooperation v0.2.
- Read-only `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public pnpm exec prisma migrate status --schema=prisma/schema/`: confirmed 18 pending migrations.
- `pnpm exec prettier --write docs/pharmacy-cooperation-v0.2-completion-audit.md`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Direct patient-card browser proof and real migration application confirmation still require explicit approval to apply the pending migrations.

## 20260619-2252 JST - Patient Packaging False-Empty Guard

### Completed

- Fixed a false-empty state in the patient detail packaging card: failed packaging-profile fetches no longer render as "未設定" with an editable empty form.
- Added an inline shared `ErrorState` with retry, support-safe detail copy, and a destructive "取得できません" badge.
- Stopped save affordance exposure while the existing settings failed to load, preventing accidental overwrite from an empty fallback form.
- Added a regression test for the error state, retry action, absence of the "未設定" copy, and absence of the save button.

### Files Changed

- `src/app/(dashboard)/patients/[id]/patient-packaging-card.tsx`
- `src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/patient-packaging-card.tsx' 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx'`: passed, 1 file / 2 tests.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/patient-packaging-card.tsx' 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx'`: passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Verifier follow-up: expanded the success-path test to assert rendered summary/table/overdue values and the reminder action, then reran focused Vitest, targeted ESLint, `pnpm format:check`, and `git diff --check`; all passed.
- Verifier follow-up: no blocking/high/medium findings. Low test-quality note only: the report delivery analytics failure test mocks React Query's `isError` state directly rather than driving a fetch rejection, which is sufficient for this narrow component-branch regression.
- Verifier follow-up: added a click assertion for the `再試行` action and reran `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx'`, targeted ESLint, `pnpm format:check`, and `git diff --check`; all passed.

### Remaining / Next Loop

- Continue the false-empty audit on workflow dashboard, communications requests, report delivery analytics, and schedule proposals.

## 20260619-2257 JST - Report Delivery Analytics False-Empty Guard

### Completed

- Fixed the report delivery analytics panel false-empty state: failed analytics fetches no longer render as empty trend tables or "未確認報告はありません" messaging.
- Added a shared `ErrorState` with retry and support-safe detail text.
- Hid the reminder task action while analytics failed to load, so operators cannot queue follow-up work from an unknown stale/failed state.
- Added a regression test that asserts the error state, retry callback, absence of empty analytics text, absence of empty overdue message, and absence of the reminder action.
- Strengthened the existing success-path test with non-empty analytics fixtures for summary, monthly trend, physician breakdown, overdue rows, and the reminder action.

### Files Changed

- `src/app/(dashboard)/reports/report-delivery-dashboard.tsx`
- `src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/reports/report-delivery-dashboard.tsx' 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx'`: passed unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 4 tests.
- `pnpm exec eslint 'src/app/(dashboard)/reports/report-delivery-dashboard.tsx' 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-packaging-card.test.tsx'`: passed.
- Follow-up positive-path test validation: `pnpm exec vitest run 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' --reporter=dot --testTimeout=30000` passed, 1 file / 2 tests; `pnpm exec eslint 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx'` passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Continue false-empty hardening for communications requests and schedule proposals.

## 20260619-2302 JST - Workflow Dashboard False-Empty Guard

### Completed

- Fixed the workflow dashboard initial-load failure path: failed realtime dashboard fetches no longer render zero/empty workflow queues as if no operational work exists.
- Threaded `isError` from `useRealtimeQuery` into `WorkflowDashboardView` and show a shared `ErrorState` only when there is no usable workflow snapshot.
- Preserved stale-data rendering when a previous workflow snapshot still exists.
- Added a regression test that asserts the error state, retry callback, absence of the main workflow section, and absence of the communication workflow section.

### Files Changed

- `src/app/(dashboard)/workflow/workflow-dashboard-content.tsx`
- `src/app/(dashboard)/workflow/workflow-dashboard-view.tsx`
- `src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/workflow-dashboard-content.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-view.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/workflow-dashboard-content.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-view.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed after targeted Prettier.
- `git diff --check`: passed.

### Remaining / Next Loop

- Continue false-empty hardening for communications requests and schedule proposals, then return to the pharmacy cooperation R-07 transition-commonality gap.

## 20260619-2308 JST - Communication Requests False-Empty Guard

### Completed

- Fixed the communication requests follow-up workspace failure path: failed request-list fetches no longer render "返信待ちの依頼はありません" or the empty selected-item prompt.
- Added a shared `ErrorState` with retry and support-safe detail text for the request-list panel.
- Hid the reply-follow-up list, the empty selected-item prompt, and the "対応済みにする" action while the initial request-list state is loading or failed.
- Added regression tests for the error state, retry callback, initial loading state, absence of the reply-follow-up list, absence of empty follow-up text, and absence of the resolve action.

### Files Changed

- `src/app/(dashboard)/communications/requests/requests-content.tsx`
- `src/app/(dashboard)/communications/requests/requests-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/communications/requests/requests-content.tsx' 'src/app/(dashboard)/communications/requests/requests-content.test.tsx'`: passed unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/communications/requests/requests-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 6 tests.
- `pnpm exec eslint 'src/app/(dashboard)/communications/requests/requests-content.tsx' 'src/app/(dashboard)/communications/requests/requests-content.test.tsx'`: passed.
- Verifier follow-up: the read-only verifier found no blocker and one low loading-state gap; added the initial loading regression, then reran focused communication/schedule Vitest and targeted ESLint successfully.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Continue false-empty hardening for schedule proposals.

## 20260619-2313 JST - Schedule Proposals False-Empty Guard

### Completed

- Fixed the schedule proposal dashboard failure path: failed proposal fetches no longer render empty candidate controls or "条件に一致する訪問候補はありません。"
- Added a shared `ErrorState` with retry and support-safe detail text.
- Hid bulk approve/reject actions, selection controls, diagnostics, and proposal cards while proposal state is unknown.
- Added a regression test for the error state, retry callback, absence of empty-candidate text, and absence of bulk approval controls.
- Removed a duplicate schedule proposal error-state test while keeping the stronger workspace-level regression.

### Files Changed

- `src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx`
- `src/app/(dashboard)/schedules/proposals/schedule-proposals-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.test.tsx'`: passed unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 32 tests.
- `pnpm exec eslint 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.test.tsx'`: passed.
- Combined false-empty focused rerun: `pnpm exec vitest run 'src/app/(dashboard)/communications/requests/requests-content.test.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 38 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Continue with pharmacy cooperation R-07 transition-commonality gap.

## 20260619-2312 JST - Pharmacy Cooperation Visit Status Transition Commonality

### Completed

- Added explicit service-level transition rules for pharmacy visit requests and partner visit records in `pharmacy-partnerships.ts`.
- Routed visit request accept/decline, partner record submit/confirm/return, physician report creation, and claim-check marking through helper-derived `nextStatus`.
- Added unit coverage for allowed and denied visit request / partner visit record transitions.
- Fixed a verifier-identified high risk in partner visit record confirmation: the route now updates the partner record before moving the linked visit request from `submitted` to `confirmed`, avoiding a self-conflict in the same transaction.
- Added review-route tests for update ordering, return-side request status update, and request-transition race handling.

### Files Changed

- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `src/app/api/pharmacy-visit-requests/[id]/decision/route.ts`
- `src/app/api/partner-visit-records/[id]/submit/route.ts`
- `src/app/api/partner-visit-records/[id]/review/route.ts`
- `src/app/api/partner-visit-records/[id]/review/route.test.ts`
- `src/server/services/partner-visit-report-drafts.ts`
- `src/app/api/visit-billing-candidates/route.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Read local Next.js route handler docs: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Read attached v0.2 R-07 spec sections.
- `pnpm exec prettier --write` over touched R-07 files: passed.
- `pnpm exec vitest run src/server/services/pharmacy-partnerships.test.ts 'src/app/api/pharmacy-visit-requests/[id]/decision/route.test.ts' 'src/app/api/partner-visit-records/[id]/submit/route.test.ts' 'src/app/api/partner-visit-records/[id]/review/route.test.ts' src/server/services/partner-visit-report-drafts.test.ts 'src/app/api/visit-billing-candidates/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 6 files / 29 tests after the verifier follow-up fix.
- Targeted ESLint over touched R-07 files/tests: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- Verifier follow-up: initially found a high transaction-ordering risk in the partner visit review confirm path; fixed and revalidated.

### Remaining / Next Loop

- R-07 is now implemented for visit request / partner visit record / physician report / claim-check transitions and for patient-share-case consent/link/revoke/activate status transitions. DB-backed browser proof and migration application still require explicit approval.

## 20260619-2325 JST - Patient Share Case Transition Helper

### Summary

- Centralized patient-share-case lifecycle transition rules in `src/server/services/pharmacy-partnerships.ts` with explicit allowed-from contracts for consent registration, patient-link approval/acceptance/decline, consent revoke, and activation.
- Updated consent registration, patient-link update, consent revoke, and activation routes to use the shared transition helper while preserving existing terminal-case conflicts, active-case decline conflict, activation blocker ordering, audit metadata, and transaction boundaries.
- Added service-level transition coverage for non-terminal, terminal, activation prerequisite, revoke, and active-decline behavior.

### Files Changed

- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/route.ts`
- `src/app/api/patient-share-cases/[id]/patient-link/route.ts`
- `src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/pharmacy-partnerships.ts src/server/services/pharmacy-partnerships.test.ts 'src/app/api/patient-share-cases/[id]/activate/route.ts' 'src/app/api/patient-share-cases/[id]/consents/route.ts' 'src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.ts' 'src/app/api/patient-share-cases/[id]/patient-link/route.ts'`: passed.
- `pnpm exec vitest run src/server/services/pharmacy-partnerships.test.ts 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/[consentId]/revoke/route.test.ts' 'src/app/api/patient-share-cases/[id]/patient-link/route.test.ts' 'src/app/api/patient-share-cases/[id]/route.test.ts' src/app/api/patient-share-cases/route.test.ts --reporter=dot --testTimeout=30000`: passed, 7 files / 48 tests.
- Targeted ESLint over touched patient-share transition files/tests: passed.
- `pnpm typecheck`: initially failed on a narrowed `allowedFrom.includes` type, then passed after widening the includes check without changing runtime behavior.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Patient-share-case transition commonality is now covered for the active v0.2 mutation routes. Broader legacy-wide state-machine modeling, DB-backed browser proof, and migration application remain follow-ups requiring either wider scope or explicit approval.

## 20260619-2331 JST - Inquiry Records GET Status Filter Guard

### Summary

- Hardened `GET /api/inquiry-records` query parsing so `cycle_id`, `patient_id`, and `status` are trimmed before query construction.
- Made the existing `status=resolved|unresolved` contract fail closed: unknown status filters now return 400 before any inquiry query instead of silently returning an unfiltered list.
- Added regression coverage for resolved/unresolved filters and invalid status rejection.

### Files Changed

- `src/app/api/inquiry-records/route.ts`
- `src/app/api/inquiry-records/route.test.ts`
- `Plans.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Read local Next.js route handler docs before editing the route.
- `pnpm exec prettier --write src/app/api/inquiry-records/route.ts src/app/api/inquiry-records/route.test.ts`: passed unchanged.
- `pnpm exec vitest run src/app/api/inquiry-records/route.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 8 tests.
- `pnpm exec eslint src/app/api/inquiry-records/route.ts src/app/api/inquiry-records/route.test.ts`: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- `GET /api/inquiry-records?status=unresolved` is now validated and covered. Continue with the higher-value pharmacy-cooperation notification gap identified by the read-only code mapper.

## 20260619-2334 JST - Partner Visit Record Review Notifications

### Summary

- Added PHI-free in-app notifications for partner visit record base review results: confirm and return now dispatch dedicated notification events after the record/request updates succeed.
- Routes notify the accepting partner-side user recorded on the visit request when available, while still allowing notification rules to add configured recipients.
- Notification metadata is limited to IDs, decision, and next status; return reasons and patient-identifying content are not copied into notifications or audit metadata.

### Files Changed

- `src/app/api/partner-visit-records/[id]/review/route.ts`
- `src/app/api/partner-visit-records/[id]/review/route.test.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/api/partner-visit-records/[id]/review/route.ts' 'src/app/api/partner-visit-records/[id]/review/route.test.ts'`: passed unchanged.
- `pnpm exec vitest run 'src/app/api/partner-visit-records/[id]/review/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 1 file / 4 tests.
- `pnpm exec vitest run 'src/app/api/partner-visit-records/[id]/submit/route.test.ts' 'src/app/api/partner-visit-records/[id]/review/route.test.ts' src/server/services/notifications.test.ts --reporter=dot --testTimeout=30000`: passed, 3 files / 20 tests.
- `pnpm exec eslint 'src/app/api/partner-visit-records/[id]/review/route.ts' 'src/app/api/partner-visit-records/[id]/review/route.test.ts' 'src/app/api/partner-visit-records/[id]/submit/route.test.ts' src/server/services/notifications.test.ts`: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- R-04 now covers message, submit, confirm, and return notification reuse in code/tests. Broader live delivery proof remains blocked by unapplied migrations/environment setup.

## 20260619-2340 JST - Pharmacy Contract Status Policy

### Summary

- Centralized pharmacy contract and contract-version active status decisions in `src/server/services/pharmacy-partnerships.ts`.
- Routed contract creation through the shared policy for both pharmacy approvals, active partnership, and active partner pharmacy prerequisites.
- Routed contract-version creation through the shared policy for terminal parent contracts, active parent contract requirement, both approvals, active partnership, and active partner pharmacy prerequisites.
- Confirmed invoice lifecycle already uses the shared `transitionPharmacyInvoice` policy in `src/server/services/pharmacy-invoices.ts`.

### Files Changed

- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `src/app/api/pharmacy-contracts/route.ts`
- `src/app/api/pharmacy-contracts/[id]/versions/route.ts`
- `Plans.md`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Read local Next.js route handler docs before editing the routes.
- `pnpm exec prettier --write src/server/services/pharmacy-partnerships.ts src/server/services/pharmacy-partnerships.test.ts src/app/api/pharmacy-contracts/route.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.ts'`: passed unchanged.
- `pnpm exec vitest run src/server/services/pharmacy-partnerships.test.ts src/app/api/pharmacy-contracts/route.test.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 3 files / 26 tests.
- `pnpm exec vitest run src/server/services/pharmacy-partnerships.test.ts src/app/api/pharmacy-contracts/route.test.ts 'src/app/api/pharmacy-contracts/[id]/versions/route.test.ts' src/app/api/inquiry-records/route.test.ts 'src/app/api/partner-visit-records/[id]/review/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 5 files / 38 tests.
- Targeted ESLint over touched service/route/test files: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed, no changed files required Prettier check.
- `git diff --check`: passed.

### Remaining / Next Loop

- R-07 now covers patient-share-case, visit request, partner visit record, contract, contract-version, physician-report/claim candidate transitions, and the existing invoice transition service. Broader legacy-wide state-machine modeling, DB-backed browser proof, and migration application remain follow-ups requiring explicit approval.

## 20260619-2342 JST - Management Plan Version Evidence Guard

### Summary

- Hardened `POST /api/patient-share-cases` so a shared management plan can only be attached when plan ID, version, and base case are provided together.
- Validated the management plan before share-case creation: same org, same care case, same patient, approved status, and version match.
- Extended audit metadata with only `shared_management_plan_id` and `shared_management_plan_version`; no plan content or patient-identifying details are copied into the audit payload.

### Files Changed

- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts`: passed unchanged.
- `pnpm exec vitest run src/app/api/patient-share-cases/route.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 17 tests.
- `pnpm exec vitest run src/app/api/patient-share-cases/route.test.ts 'src/app/api/patient-share-cases/[id]/route.test.ts' 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' 'src/app/api/patient-share-cases/[id]/consents/route.test.ts' 'src/app/api/patient-share-cases/[id]/patient-link/route.test.ts' 'src/app/(dashboard)/patients/[id]/card-workspace.test.tsx' --reporter=dot --testTimeout=30000`: passed, 6 files / 66 tests.
- Targeted ESLint over patient-share route/card workspace files: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- B-01 management-plan version evidence is now enforced at the share-case API boundary. Direct DB-backed browser proof remains blocked until migration application is explicitly approved.

## 20260619-2350 JST - Patient Share Summary Derivation

### Summary

- Added a shared `patient-share-summary` service that derives pharmacy-share state from active, consent-valid `PatientShareCase` rows.
- Extended patient list items with a `pharmacy_share` summary containing only active case count, partner pharmacy count, and merged scope keys.
- Kept patient-master state computed from share cases instead of adding or relying on a patient-level sharing flag.

### Files Changed

- `src/server/services/patient-share-summary.ts`
- `src/server/services/patient-share-summary.test.ts`
- `src/server/mappers/patient-response-mapper.ts`
- `src/server/services/patient-service.ts`
- `src/app/api/patients/route.test.ts`
- `src/app/api/patients/__snapshots__/route.test.ts.snap`
- `Plans.md`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/patient-share-summary.ts src/server/services/patient-share-summary.test.ts src/server/mappers/patient-response-mapper.ts src/server/services/patient-service.ts src/app/api/patients/route.test.ts`: passed.
- `pnpm exec vitest run src/server/services/patient-share-summary.test.ts src/app/api/patients/route.test.ts --reporter=dot --testTimeout=30000`: passed, 2 files / 20 tests. Existing mocked webhook stderr appeared during patient creation tests.
- Targeted ESLint over touched patient-list/share-summary files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- R-01 now has a concrete patient-list surface deriving pharmacy-share state from active share cases. Broader patient-detail and cross-app summary projection can still be hardened later, and DB-backed proof remains blocked until migration application is explicitly approved.

## 20260619-2354 JST - Load Failure Safety States

### Summary

- Updated the notifications inbox to show a retryable server error state instead of an empty inbox when notification loading fails.
- Updated the visit constraints card to show a retryable server error state instead of an editable empty form when visit-constraint loading fails.
- Kept failed loads distinct from "no data" states so users do not accidentally overwrite existing scheduling constraints or miss pending notification state.

### Files Changed

- `src/app/(dashboard)/notifications/notifications-content.tsx`
- `src/app/(dashboard)/notifications/notifications-content.test.tsx`
- `src/app/(dashboard)/patients/[id]/visit-constraints-card.tsx`
- `src/app/(dashboard)/patients/[id]/visit-constraints-card.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run 'src/app/(dashboard)/notifications/notifications-content.test.tsx' 'src/app/(dashboard)/patients/[id]/visit-constraints-card.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 9 tests.
- Targeted ESLint over touched notification/visit-constraint files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- DB-backed proof for the broader v0.2 goal remains blocked until migration application is explicitly approved.

## 20260620-0004 JST - Patient Share Correction Policy

### Summary

- Added a shared patient-share policy service for correction/addition request ownership and direct-edit checks.
- Routed patient-share correction request creation through the shared policy instead of route-local target-owner maps.
- Added regression coverage proving inactive/revoked share cases stop before target lookup, create, or audit side effects.

### Files Changed

- `src/server/services/patient-share-policy.ts`
- `src/server/services/patient-share-policy.test.ts`
- `src/app/api/patient-share-cases/[id]/correction-requests/route.ts`
- `src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts`
- `Plans.md`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/patient-share-policy.ts src/server/services/patient-share-policy.test.ts 'src/app/api/patient-share-cases/[id]/correction-requests/route.ts' 'src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts'`: passed.
- `pnpm exec vitest run src/server/services/patient-share-policy.test.ts 'src/app/api/patient-share-cases/[id]/correction-requests/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 9 tests.
- Targeted ESLint over touched policy/correction-request files: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- R2 is stronger for correction/addition requests. Direct DB-backed proof and migration application remain blocked until explicit approval.

## 20260620-0005 JST - Document Template Delete Confirmation

### Summary

- Added an explicit destructive confirmation before deleting document templates from the admin document-template workspace.
- Named the target template, template type, and version in the confirmation copy.
- Added a target-specific accessible name to the template delete action.
- Added a regression test proving the DELETE request is not sent until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/document-templates/template-content.tsx`
- `src/app/(dashboard)/admin/document-templates/template-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/document-templates/template-content.tsx' 'src/app/(dashboard)/admin/document-templates/template-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/document-templates/template-content.test.tsx' 'src/app/(dashboard)/admin/document-templates/document-delivery-rule-manager.test.tsx' src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: initially failed because the responsive table renders duplicate delete actions; the test was corrected to select the first matching accessible action, then passed with 3 files / 7 tests.
- Targeted ESLint over touched document-template and confirm-dialog files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Next candidates include service-area destructive confirmation, broader admin destructive-action consistency, pharmacy-cooperation responsive table density, select accessible-name gaps, and expanded browser/a11y proof.

## 20260619-2356 JST - Dialog Viewport Safety

### Summary

- Bounded alert/confirm dialog content to the mobile viewport with safe width, max-height, and scroll behavior.
- Added a ConfirmDialog regression test that asserts long dialog content remains inside the viewport constraints.

### Files Changed

- `src/components/ui/alert-dialog.tsx`
- `src/components/ui/confirm-dialog.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: passed, 1 file / 3 tests.
- Targeted ESLint over touched dialog files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- DB-backed proof for the broader v0.2 goal remains blocked until migration application is explicitly approved.

## 20260620-0000 JST - Document Delivery Rule Destructive Action and Switch A11y

### Summary

- Added an explicit destructive confirmation before deleting document delivery rules from the admin document-template workspace.
- Gave each delivery-rule delete button a target-specific accessible name, including document type, role, and primary channel.
- Connected the active-state Switch to the visible "有効化" label and description.
- Extended `ConfirmDialog` with opt-in `closeOnConfirm={false}` so pending destructive actions can remain open until the caller resolves, while preserving the default close-on-confirm behavior.

### Files Changed

- `src/app/(dashboard)/admin/document-templates/document-delivery-rule-manager.tsx`
- `src/app/(dashboard)/admin/document-templates/document-delivery-rule-manager.test.tsx`
- `src/components/ui/confirm-dialog.tsx`
- `src/components/ui/confirm-dialog.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/document-templates/document-delivery-rule-manager.tsx' 'src/app/(dashboard)/admin/document-templates/document-delivery-rule-manager.test.tsx' src/components/ui/confirm-dialog.tsx src/components/ui/confirm-dialog.test.tsx`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/document-templates/document-delivery-rule-manager.test.tsx' src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 6 tests.
- Targeted ESLint over touched document-delivery and confirm-dialog files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Unrelated patient-share correction-policy worktree files were present during this slice and preserved.
- Continue UI/UX remediation with the next high-value accessibility or destructive-action candidate; broader remaining candidates still include pharmacy-cooperation responsive table density, select accessible-name gaps, and expanded browser/a11y proof.

## 20260620-0008 JST - Service Area Delete Confirmation

### Summary

- Added an explicit destructive confirmation before deleting service areas from the admin service-area workspace.
- Named the target service area, site, and area type in the confirmation copy.
- Added a target-specific accessible name to the service-area delete action.
- Added a regression test proving the DELETE request is not sent until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/service-areas/page.tsx`
- `src/app/(dashboard)/admin/service-areas/page.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/service-areas/page.tsx' 'src/app/(dashboard)/admin/service-areas/page.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/service-areas/page.test.tsx' src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 5 tests.
- Targeted ESLint over touched service-area and confirm-dialog files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Next candidates include broader admin destructive-action consistency, pharmacy-cooperation responsive table density, select accessible-name gaps, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0011 JST - Pharmacy Site Form Label Associations

### Summary

- Associated visible labels with pharmacy site edit inputs: name, address, phone, and FAX.
- Associated visible labels with insurance config controls: insurance type, revision, effective dates, and dynamic medical config selects.
- Added regression tests proving the pharmacy site and insurance config fields can be found by their visible labels.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx' 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- Targeted ESLint over touched pharmacy-site files: passed.
- `pnpm typecheck`: initially found one dynamic insurance config `Field` without `htmlFor`; after adding field-key-based ids, passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx' 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx'`: passed.
- `git diff --check`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: blocked by unrelated dirty `src/server/services/patient-share-policy.ts`; touched pharmacy-site files are formatted.

### Remaining / Next Loop

- UI/UX remediation remains active. Full format check needs the unrelated patient-share-policy dirty file to be formatted or committed by its owning slice. Remaining candidates include broader admin destructive-action consistency, pharmacy-cooperation responsive table density, select accessible-name gaps outside pharmacy-sites, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0011 JST - Patient Share Output Policy

### Summary

- Added a shared patient-share data output policy for v0.2 R2 permission commonality.
- Mapped attachment view, attachment download, print, PDF output, PDF download, and shared data download actions to required `share_scope` keys.
- Made attachment downloads require both `attachments` and `download`, and PDF downloads require both `pdf_output` and `download`.
- Added fail-closed tests for inactive share cases and non-boolean scope values.

### Files Changed

- `src/server/services/patient-share-policy.ts`
- `src/server/services/patient-share-policy.test.ts`
- `Plans.md`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/patient-share-policy.ts src/server/services/patient-share-policy.test.ts`: passed.
- `pnpm exec vitest run src/server/services/patient-share-policy.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 8 tests.
- Targeted ESLint over touched patient-share policy files: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- Direct DB-backed proof and migration application remain explicit-approval blocked.
- Next non-DB candidates include wiring the shared output policy into concrete output routes where share-case context is available, broader role-matrix browser proof after DB apply, and pharmacy-cooperation responsive/a11y hardening.

## 20260620-0015 JST - Alert Rule Delete Confirmation

### Summary

- Added an explicit destructive confirmation before deleting prescription safety alert rules.
- Named the target alert type and severity in the confirmation copy.
- Added a target-specific accessible name to the alert-rule delete action.
- Added a regression test proving the DELETE request is not sent until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/alert-rules/page.tsx`
- `src/app/(dashboard)/admin/alert-rules/page.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/alert-rules/page.tsx' 'src/app/(dashboard)/admin/alert-rules/page.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/alert-rules/page.test.tsx' src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 5 tests.
- Targeted ESLint over touched alert-rule and confirm-dialog files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include broader admin destructive-action consistency, pharmacy-cooperation responsive table density, select accessible-name gaps outside the touched admin forms, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0017 JST - Packaging Method Switch A11y Regression

### Summary

- Verified the packaging method active Switch already receives the accessible name "有効" from its wrapping label.
- Recorded that the runtime UI did not need an additional label change for this control.
- Added the progress record for the already-committed regression test that protects the active/inactive control name.

### Files Changed

- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`
- Previously committed in `22d5bb7e`: `src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.test.tsx`

### Validation

- HEAD commit `22d5bb7e` records these passing checks:
  - `pnpm exec vitest run 'src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.test.tsx' --reporter=dot --testTimeout=30000`
  - `pnpm exec eslint 'src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.test.tsx'`
  - `git diff --check -- 'src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.test.tsx'`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec prettier --check .codex/ralph-state.md CODEX_GOAL_PROGRESS.md`: blocked by JavaScript heap OOM while checking the large progress files.
- `git diff --check`: passed after the ledger update.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include broader admin destructive-action consistency, pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0021 JST - Patient Share Output Actions in Scope API

### Summary

- Wired the shared patient-share output policy into `PATCH /api/patient-share-cases/[id]`.
- Added allowed `output_actions` to the share-scope update response.
- Added previous/current `output_actions` to the scope-update audit metadata without exposing raw `share_scope`.
- Added route and policy regressions proving draft cases fail closed and active cases with `pdf_output` scope expose only `pdf_output`.

### Files Changed

- `src/server/services/patient-share-policy.ts`
- `src/server/services/patient-share-policy.test.ts`
- `src/app/api/patient-share-cases/[id]/route.ts`
- `src/app/api/patient-share-cases/[id]/route.test.ts`
- `Plans.md`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/server/services/patient-share-policy.ts src/server/services/patient-share-policy.test.ts 'src/app/api/patient-share-cases/[id]/route.ts' 'src/app/api/patient-share-cases/[id]/route.test.ts'`: passed.
- `pnpm exec vitest run src/server/services/patient-share-policy.test.ts 'src/app/api/patient-share-cases/[id]/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 14 tests.
- Targeted ESLint over touched route and policy files: passed.
- `pnpm typecheck`: passed.

### Remaining / Next Loop

- Direct DB-backed proof and migration application remain explicit-approval blocked.
- Concrete attachment/PDF/download routes can adopt the same output-action policy where they receive explicit share-case context.

## 20260620-0023 JST - Notification Escalation Delete Confirmation

### Summary

- Added an explicit destructive confirmation before deleting notification escalation rules.
- Named the target trigger, action, role, and threshold in the delete action and confirmation copy.
- Added a regression test proving the DELETE request is not sent until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
- `src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx' 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx' src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 5 tests.
- Targeted ESLint over touched notification-settings and confirm-dialog files: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include broader admin destructive-action consistency, pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0025 JST - Formulary Template Delete Confirmation

### Summary

- Added explicit confirmation before deleting drug-master formulary templates.
- Added target-specific accessible names for the template delete action using template name and item count.
- Reused the existing `ConfirmDialog` pattern already used by formulary request decisions.
- Added a regression test proving the delete mutation is not called until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
- `src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx' 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 9 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx' 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx'`: passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx' 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include shift template/holiday destructive confirmation, pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0028 JST - Shift Workspace Delete Confirmations

### Summary

- Added explicit confirmation before deleting shift templates.
- Added explicit confirmation before deleting business holidays from the shift workspace.
- Added target-specific accessible names and confirmation copy for template user/weekday/site/availability and holiday name/date/site.
- Added regression tests proving neither delete mutation runs until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/shifts/shifts-content.tsx`
- `src/app/(dashboard)/admin/shifts/shifts-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/shifts/shifts-content.tsx' 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/shifts/shifts-content.tsx' 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx'`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0500 JST - PCA Pump Rental Inline Validation

### Summary

- Aligned the admin PCA pump rental sheet with the existing API validation contract before submission.
- Added inline blockers for missing pump/institution, invalid or reversed rental dates, and non-integer fee values.
- Added accessible error/help wiring and a disabled save reason so invalid rental payloads are not sent to the mutation.

### Files Changed

- `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx`
- `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx' 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx' 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 6 tests.
- `git diff --check -- 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx' 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- PCA rental creation now matches the inspected API schema at the form boundary. Next candidates include PCA return-inspection disabled reasons and DB-backed browser proof now that DB access is allowed.

## 20260620-0505 JST - PCA Return Inspection Blocker Explanations

### Summary

- Added target-specific accessible names for pending PCA return-inspection actions.
- Added item-level error states for unchecked inspection statuses and missing damage/loss notes.
- Added a disabled save reason connected to the return-inspection save button.

### Files Changed

- `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx`
- `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx' 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx' 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 7 tests.
- `git diff --check`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm db:e2e:prepare`: passed; no pending migrations and local E2E DB reseeded.
- `pnpm medical-ui:e2e:preflight`: passed with app port 3012, DB port 5433, 111 org-scoped RLS tables, and 22 audit triggers.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts --project=chromium`: passed, 4 Chromium tests.
- Standalone Playwright browser check for `/admin/pca-pumps`: passed after retrying the command with an async wrapper and absolute URL. It opened the return-inspection sheet, verified `検品 PCA-E2E-mqld1puv サンプル在宅クリニック 返却日 2026/6/20`, confirmed `検品完了` was disabled with `aria-describedby="return-inspection-save-blocker"`, and found the visible blocker listing all unchecked inspection items. No console/page/http errors were captured.

### Remaining / Next Loop

- PCA return-inspection disabled reasons and target-specific action names are addressed for the inspected screen with jsdom, DB-backed API, and browser evidence.

## 20260620-0512 JST - Pharmacy Site Insurance Config Inline Validation

### Summary

- Added target-specific accessible names for repeated pharmacy site and insurance config actions.
- Added inline validation for insurance config effective date ranges before save.
- Connected effective-date helper/error text and the disabled save reason through ARIA.
- Added focused regression coverage for target-specific action names, delete confirmation copy, and blocked invalid date ranges.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx' 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx' 'src/app/api/pharmacy-sites/[id]/insurance-configs/route.test.ts' 'src/app/api/pharmacy-sites/[id]/insurance-configs/[configId]/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 3 files / 23 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx' 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx'`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx' 'src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Pharmacy-site insurance config date ranges now match the existing API validation at the form boundary, and repeated site/config actions have target-specific accessible names.
- Continue with the next small UI/UX candidate from the scan, likely admin institutions row action names, billing-rule disabled reasons, or admin jobs rerun action names.

## 20260620-0517 JST - Institution Row Action Names

### Summary

- Added target-specific accessible names for admin institution edit/delete row actions.
- Added a focused regression test proving deletion remains behind confirmation and targets the selected institution.

### Files Changed

- `src/app/(dashboard)/admin/institutions/institutions-content.tsx`
- `src/app/(dashboard)/admin/institutions/institutions-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/institutions/institutions-content.tsx' 'src/app/(dashboard)/admin/institutions/institutions-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/institutions/institutions-content.tsx' 'src/app/(dashboard)/admin/institutions/institutions-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/institutions/institutions-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `git diff --check -- 'src/app/(dashboard)/admin/institutions/institutions-content.tsx' 'src/app/(dashboard)/admin/institutions/institutions-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Institution row action names are addressed. Continue with billing-rule system disabled reasons or admin jobs rerun action names.

## 20260620-0451 JST - Pharmacist Credential Inline Validation

### Summary

- Added API-aligned inline validation to pharmacist credential registration/edit dialog.
- Enforced credential date order (`issued_date <= expiry_date`) with native date min/max hints and visible error text.
- Added native bounds and helper/error text for tenure years (`0-80`) and weekly work hours (`0-168`).
- Blocked invalid saves before the credential mutation can run and tied the save button to the blocker text.
- Added a focused jsdom regression test with a native Select mock for deterministic user selection.

### Files Changed

- `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx`
- `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Read `docs/ui-ux-design-guidelines.md` and `node_modules/next/dist/docs/03-architecture/accessibility.md` before committing this UI/a11y slice.
- Inspected `src/lib/validations/pharmacist-credential.ts` and confirmed the UI bounds match existing API validation.
- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' --reporter=dot --testTimeout=30000`: initially failed on an over-specific duplicate-message expectation, then passed with 1 file / 2 tests after stabilizing the Select interaction and assertion.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx'`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Pharmacist credential date/number validation no longer relies only on API/toast feedback for these constraints.
- Continue with the next UI/UX hardening candidate, likely PCA pump rental/return disabled-reason gaps or remaining pharmacy-cooperation proof items.

## 20260620-0446 JST - Patient Share Transaction Query Serialization

### Summary

- Serialized the `POST /api/patient-share-cases` validation lookups inside `withOrgContext` instead of issuing same-transaction Prisma reads with `Promise.all`.
- Removed the nested relation `include` from `POST /api/patient-share-cases/:id/activate` update output, because Prisma expanded it into concurrent `PgTransaction` queries and triggered the pg@9 deprecation warning.
- Returned a no-store, minimized activation response that preserves safe status/link/partnership fields without exposing full patient-link snapshots or identity proof JSON.
- Added regression coverage for serialized create-route lookups and activation response minimization.

### Files Changed

- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before editing Route Handler code.
- `pnpm exec prettier --write 'src/app/api/patient-share-cases/route.ts' 'src/app/api/patient-share-cases/route.test.ts'`: passed.
- `pnpm exec eslint 'src/app/api/patient-share-cases/route.ts' 'src/app/api/patient-share-cases/route.test.ts' && pnpm exec vitest run 'src/app/api/patient-share-cases/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 1 file / 18 tests.
- Trace repro before the activation fix: `NODE_OPTIONS='--max-old-space-size=12288 --trace-deprecation' DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT=1 AUTH_SECRET=ph-os-local-auth-secret NEXTAUTH_SECRET=ph-os-local-auth-secret NEXTAUTH_URL=http://localhost:3012 NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM=1 NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA=1 NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$PWD/tools/tests/helpers/next-font-google-mocked-responses.cjs ./node_modules/.bin/next dev --webpack --port 3012` plus the focused patient-share Playwright flow passed but logged `Calling client.query() when the client is already executing a query`; stack pointed to `PgTransaction` relation-query expansion.
- `pnpm exec prettier --write 'src/app/api/patient-share-cases/[id]/activate/route.ts' 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' 'src/app/api/patient-share-cases/route.ts' 'src/app/api/patient-share-cases/route.test.ts'`: passed.
- `pnpm exec eslint 'src/app/api/patient-share-cases/[id]/activate/route.ts' 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' 'src/app/api/patient-share-cases/route.ts' 'src/app/api/patient-share-cases/route.test.ts' && pnpm exec vitest run 'src/app/api/patient-share-cases/route.test.ts' 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 25 tests.
- `pnpm typecheck`: passed.
- Focused Playwright rerun on trace server: `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium --grep "patient card drives a DB-backed share, visit, report, and billing flow"`: passed, 1 Chromium test, and the post-fix server log had no `Calling client.query()` deprecation warning.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- The pg@9 same-client query warning is fixed for the DB-backed patient-share activation flow and covered by unit plus browser/log evidence.
- Remaining pharmacy-cooperation proof work should continue with any still-unverified message-thread browser/readback gaps or the next UI/UX hardening candidate.

## 20260620-0443 JST - Admin User Visit Constraint Guidance

### Summary

- Added API-aligned native constraints for admin user visit capacity fields: daily 1-20, weekly 1-100, travel 0-480 minutes.
- Added persistent helper/error text and ARIA links for visit-limit inputs.
- Blocked invalid visit-limit saves inline before the detail mutation can run.
- Connected non-operational role disabled visit controls to their visible disabled reason.

### Files Changed

- `src/app/(dashboard)/admin/users/users-content.tsx`
- `src/app/(dashboard)/admin/users/users-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm vitest run 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: initially failed on test assertion shape, then passed with 1 file / 5 tests after switching to DOM-property assertions.
- `pnpm exec eslint 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Admin user visit constraints now match the existing pharmacist API validation contract and no longer rely on server/toast feedback for invalid bounds.
- Two unrelated dirty files, `src/app/api/patient-share-cases/route.ts` and `src/app/api/patient-share-cases/route.test.ts`, were present during this slice and were not modified here.
- Remaining candidates from the second scan include pharmacist credential date/number validation and PCA pump rental/return disabled-reason gaps.

## 20260620-0304 JST - Local DB Apply and Patient Share Case DB-Backed Proof

### Summary

- Applied the 18 pending Prisma migrations to the local e2e database only after explicit DB approval.
- Re-seeded the local e2e database and verified Prisma status/validation.
- Added DB-backed patient-card Playwright coverage that creates a pharmacy cooperation share case with an approved management-plan version and then verifies the persisted `PatientShareCase` plus `PatientLink`.
- Fixed the API bug surfaced by that browser proof: nested `PatientLink` creation under `PatientShareCase` must not pass explicit `org_id`; Prisma infers the composite relation from the parent create.
- Updated the v0.2 completion audit to reflect local e2e DB apply completion and partial DB-backed browser proof completion.

### Files Changed

- `src/app/api/patient-share-cases/route.ts`
- `src/app/api/patient-share-cases/route.test.ts`
- `tools/tests/ui-major-screens.spec.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `DATABASE_URL=... DIRECT_URL=... pnpm exec prisma migrate status --schema=prisma/schema/`: initially reported 18 pending migrations, then passed after deploy with schema up to date.
- `DATABASE_URL=... DIRECT_URL=... pnpm exec prisma migrate deploy --schema=prisma/schema/`: passed for the local e2e DB.
- `DATABASE_URL=... DIRECT_URL=... pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `DATABASE_URL=... DIRECT_URL=... pnpm exec prisma db seed`: passed.
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium -g "patient share screen exposes backend share and self-report data"`: passed.
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium -g "pharmacy cooperation route-mocked browser workflow smoke"`: passed.
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium -g "patient detail screen renders cleanly"`: passed.
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium -g "patient card creates a DB-backed share case"`: initially failed with a Prisma `Unknown argument org_id` error in nested `patient_link.create`, then passed after the API fix.
- `pnpm exec prettier --write src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec eslint src/app/api/patient-share-cases/route.ts src/app/api/patient-share-cases/route.test.ts tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec vitest run src/app/api/patient-share-cases/route.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 17 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Full DB-backed pharmacy cooperation workflow proof is still pending beyond the patient-card creation slice: consent/link/activation, visit request, partner record, report draft, billing candidate, invoice/payment, and message thread.
- `patient detail screen surfaces representative backend data` was rerun after migration apply and failed on a stale `safety-board` expectation because the seeded demo case currently renders no active card/safety board; no migration/Prisma 5xx surfaced in that run.

## 20260620-0314 JST - Patient Share Activation DB Proof and JST Date Boundary

### Summary

- Extended the DB-backed patient-card Playwright proof from share-case creation to consent registration, base approval, partner acceptance, activation, and workflow active-state display.
- Fixed a JST morning `@db.Date` boundary bug that rejected same-local-day patient-share activation with `薬局間連携の開始日前です`.
- Normalized activation share-case/partnership windows and active patient-share consent checks through the repo's `localDateKey()` -> `utcDateFromLocalKey()` @db.Date convention.

### Files Changed

- `src/app/api/patient-share-cases/[id]/activate/route.ts`
- `src/app/api/patient-share-cases/[id]/activate/route.test.ts`
- `src/server/services/pharmacy-partnerships.ts`
- `src/server/services/pharmacy-partnerships.test.ts`
- `tools/tests/ui-major-screens.spec.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec eslint src/server/services/pharmacy-partnerships.ts src/server/services/pharmacy-partnerships.test.ts 'src/app/api/patient-share-cases/[id]/activate/route.ts' 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec vitest run src/server/services/pharmacy-partnerships.test.ts 'src/app/api/patient-share-cases/[id]/activate/route.test.ts' src/app/api/patient-share-cases/route.test.ts --reporter=dot --testTimeout=30000`: passed, 3 files / 39 tests.
- `DATABASE_URL=... DIRECT_URL=... PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium -g "patient card creates and activates a DB-backed share case"`: passed, 1 test.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- DB-backed proof still needs downstream pharmacy cooperation flow coverage: visit request, partner visit record, physician report draft, billing candidate, invoice/payment, and message thread.
- The separate DataTable accessibility/error-state diff is present in the worktree and should be validated/committed as its own UI component group.

## 20260620-0316 JST - DataTable Error and Row Activation Accessibility

### Summary

- Added disabled-toolbar reason text through `aria-describedby` so CSV/print disabled states expose why the action is unavailable.
- Changed DataTable error empty rows to render an error-specific empty message instead of the normal empty-data text.
- Named clickable desktop and mobile rows from `getRowA11yLabel()` as `<label> の詳細を表示`.
- Added regression coverage for row naming, disabled action descriptions, and error-state empty copy.

### Files Changed

- `src/components/ui/data-table.tsx`
- `src/components/ui/data-table.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/components/ui/data-table.tsx src/components/ui/data-table.test.tsx`: passed.
- `pnpm exec eslint src/components/ui/data-table.tsx src/components/ui/data-table.test.tsx`: passed.
- `pnpm exec vitest run src/components/ui/data-table.test.tsx --reporter=dot --testTimeout=30000`: passed, 1 file / 4 tests.
- `git diff --check -- src/components/ui/data-table.tsx src/components/ui/data-table.test.tsx`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.

### Remaining / Next Loop

- DataTable component slice is ready to commit as a separate UI component group.

## 20260620-0322 JST - Visit Request DB-Backed Proof

### Summary

- Extended the local e2e DB-backed Playwright proof from active patient-share case to pharmacy visit request creation and acceptance.
- Added deterministic cleanup/readback for `PharmacyVisitRequest` rows scoped to the UI demo share case.
- Verified the workflow screen renders the accepted real DB visit request row after API creation/acceptance.

### Files Changed

- `tools/tests/ui-major-screens.spec.ts`
- `docs/pharmacy-cooperation-v0.2-completion-audit.md`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts`: passed.
- `DATABASE_URL=... DIRECT_URL=... PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium -g "patient card creates an active DB-backed share case and accepted visit request"`: passed, 1 test.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- DB-backed proof still needs partner visit record draft/submit/review, physician report draft, billing candidate, invoice/payment, and message thread coverage.
- UI/UX remediation remains active for pharmacy-cooperation responsive table density, raw workflow table convergence, toast-only form validation, and expanded browser/a11y proof.

## 20260620-0326 JST - SOAP ToggleButton Shared Accessibility

### Summary

- Removed duplicate local `ToggleButton` implementations from SOAP step components and reused the shared SOAP step toggle.
- Added `aria-pressed` to the shared SOAP toggle so symptom/problem/intervention option state is exposed programmatically.
- Added regression coverage for selected and unselected pressed states plus click dispatch.

### Files Changed

- `src/components/features/visits/soap-steps/toggle-button.tsx`
- `src/components/features/visits/soap-steps/toggle-button.test.tsx`
- `src/components/features/visits/soap-steps/subjective-step.tsx`
- `src/components/features/visits/soap-steps/objective-basic-step.tsx`
- `src/components/features/visits/soap-steps/functional-assessment-step.tsx`
- `src/components/features/visits/soap-steps/assessment-step.tsx`
- `src/components/features/visits/soap-steps/plan-step.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write` over SOAP step toggle files: passed.
- `pnpm exec eslint` over SOAP step toggle files: passed.
- `pnpm exec vitest run src/components/features/visits/soap-steps/toggle-button.test.tsx src/components/features/visits/visit-medication-management-section.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 2 tests.
- `git diff --check -- src/components/features/visits/soap-steps/...`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- Verifier subagent reported no blocking findings for the SOAP toggle shared-component slice.

### Remaining / Next Loop

- SOAP toggle duplication is addressed for the inspected step components. Remaining UI/UX remediation candidates include pharmacy-cooperation responsive table density, raw workflow table convergence, toast-only form validation, and expanded browser/a11y proof.

## 20260620-0330 JST - Pharmacy Cooperation TableFrame Keyboard Access

### Summary

- Made pharmacy-cooperation workflow horizontal table frames keyboard-focusable scroll regions.
- Kept the existing table `aria-label` and `min-w-[72rem]` layout while adding a separate scroll-region label.
- Added regression coverage that the share-case table region is focusable and still contains the named table.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 12 tests.
- `git diff --check -- 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- Verifier subagent reported no findings for the TableFrame keyboard accessibility slice.

### Remaining / Next Loop

- This improves keyboard access to the existing responsive table wrapper without changing table data or PHI projections. Remaining UI/UX remediation candidates include deeper responsive row-card conversion, raw workflow table convergence, toast-only form validation, and expanded browser/a11y proof.

## 20260620-0335 JST - External Share Inline Validation

### Summary

- Replaced toast-only validation for `/patients/:id/share` external share setup with inline, persistent form errors.
- Added `aria-invalid` and error description wiring to the required share-recipient name input.
- Added a named scope checkbox group and inline error message when every share scope is unchecked.

### Files Changed

- `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx`
- `src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/share/external-share-content.tsx' 'src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- External share setup validation is now visible inline. Broader UI/UX remediation remains active for remaining toast-only form validation and expanded browser/a11y proof.

## 20260620-0336 JST - DB-backed Pharmacy Cooperation Completion Proof

### Summary

- Extended the local e2e DB-backed patient-card pharmacy cooperation proof from visit request acceptance through partner visit record draft, submit, base confirmation, claim note creation, physician report draft, billing candidate generation, invoice draft, invoice issue, payment recording, and invoice PDF export.
- Added deterministic UI-demo pharmacy contract, active version, and fixed-per-visit fee-rule seed data so billing candidate and invoice generation use the same contract/version path as production code.
- Fixed `createPharmacyInvoiceDraft` for Prisma 7 nested invoice item creation by removing the invalid nested `org_id`; Prisma infers it through the parent invoice composite relation.
- Hardened invoice service unit coverage so nested invoice item creation does not regress to passing `org_id`.

### Files Changed

- `src/server/services/pharmacy-invoices.ts`
- `src/server/services/pharmacy-invoices.test.ts`
- `tools/tests/ui-major-screens.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/server/services/pharmacy-invoices.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 7 tests.
- `pnpm exec vitest run src/server/services/pharmacy-invoices.test.ts src/app/api/pharmacy-invoices/route.test.ts 'src/app/api/pharmacy-invoices/[id]/route.test.ts' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 4 files / 28 tests.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium --grep "patient card drives a DB-backed share, visit, report, and billing flow"`: passed, 1 Chromium test.
- `pnpm exec eslint src/server/services/pharmacy-invoices.ts src/server/services/pharmacy-invoices.test.ts tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- The paid DB-backed flow is now covered through PDF/payment. Remaining v0.2 proof gaps include free cooperation report DB-backed proof, share-case message thread DB-backed proof, broader invoice search/audit browser coverage, and the existing stale patient-detail `safety-board` assertion.

## 20260620-0433 JST - Free Cooperation Report Search/Audit Proof

### Summary

- Extended the free cooperation report E2E to search `/api/pharmacy-invoices` after PDF generation with `document_kind=free_cooperation_report`, `status=issued`, `contract_id`, and `billing_month`.
- Strengthened DB readback for PDF export audits by resolving the expected export `target_type` from `document_kind`: `pharmacy_invoice` for paid invoices and `pharmacy_free_cooperation_report` for free reports.
- Added assertions for free report draft, issue, and PDF export audit counts plus latest export purpose and target type.

### Files Changed

- `tools/tests/ui-major-screens.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write tools/tests/ui-major-screens.spec.ts`: passed unchanged.
- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts`: passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium --grep "patient card drives a DB-backed share, visit, report, and billing flow|patient share flow produces a DB-backed free cooperation report"`: passed, 2 Chromium tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Free cooperation report proof now covers draft, issue, search, PDF, and audit readback. Remaining v0.2 proof gaps include any message-thread browser/readback gap not already covered and the `pg@9` concurrent `client.query()` warning.

## 20260620-0433 JST - Dispense Grid Period Input Guidance

### Summary

- Added screen-reader helper text for dispense-workbench group start-date and prescription-days inputs.
- Linked group period inputs with stable `aria-describedby` IDs.
- Constrained prescription-days input with `min=1` and `step=1` to match the write-handler validation contract.
- Added focused regression coverage for the accessible descriptions and numeric constraints.

### Files Changed

- `src/components/features/dispense-workbench/prescription-grid.tsx`
- `src/components/features/dispense-workbench/prescription-grid.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/components/features/dispense-workbench/prescription-grid.tsx src/components/features/dispense-workbench/prescription-grid.test.tsx`: passed.
- `pnpm exec eslint src/components/features/dispense-workbench/prescription-grid.tsx src/components/features/dispense-workbench/prescription-grid.test.tsx`: passed.
- `pnpm vitest run src/components/features/dispense-workbench/prescription-grid.test.tsx`: passed, 1 file / 1 test.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check -- src/components/features/dispense-workbench/prescription-grid.tsx src/components/features/dispense-workbench/prescription-grid.test.tsx`: passed.

### Remaining / Next Loop

- Dispense grid period controls now expose their expected formats and positive-day constraint to assistive tech. The deeper real-data write-handler toast paths still require a broader state/error surface if fully replacing transient validation toasts.

## 20260620-0427 JST - Drug Master Reorder Point Inline Validation

### Summary

- Replaced the drug-master formulary reorder-point toast-only validation path with a reusable parser and persistent inline error text.
- Linked the reorder-point input and save button to help/error text with `aria-describedby`, and set `aria-invalid` while invalid input is present.
- Centralized drug-detail opening so stale reorder-point errors are cleared when selecting another drug from formulary request, usage mismatch, impact, table, drawer close, or ingredient-member paths.
- Added parser regression coverage for blank, valid integer, negative, decimal, exponent, mixed, infinity, and unsafe-integer values.

### Files Changed

- `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
- `src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx' 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx'`: passed unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx' 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 20 tests.
- `pnpm exec prettier --write 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx'`: passed unchanged for the follow-up detail-open reset.
- `pnpm exec eslint 'src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx'`: passed for the follow-up detail-open reset.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Drug-master reorder-point validation now blocks malformed values locally and keeps the reason visible inline. Browser/a11y proof remains optional if the drug-master formulary page enters the UI proof queue.

## 20260620-0424 JST - Patient Detail Safety Board DB-backed Seed

### Summary

- Reproduced the stale patient-detail E2E failure where `getByTestId('safety-board')` was absent even though the patient card and profile summary rendered.
- Confirmed `SafetyBoard` intentionally returns `null` when all safety rows are empty, while the patient workspace derives safety rows from `Patient.allergy_info`, latest `PatientLabObservation(egfr)`, `PatientSchedulePreference.swallowing_route`, and current prescription-line handling tags.
- Updated the UI major-screen demo seed to create deterministic allergy, eGFR, swallowing-route, medication-cycle, prescription-intake, prescription-line, dispense-task, and transition-log data for `ui_demo_patient_1`.
- Re-ran the patient-detail representative-data E2E; the DB-backed `safety-board` and prescription section now render without relying on residual local database rows.

### Files Changed

- `tools/tests/ui-major-screens.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts`: passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium --grep "patient detail screen surfaces representative backend data"`: passed, 1 Chromium test.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/uat/uat-content.tsx' 'src/app/(dashboard)/admin/uat/uat-content.test.tsx' tools/tests/ui-major-screens.spec.ts`: passed.

### Remaining / Next Loop

- Patient-detail safety board proof is now deterministic for the UI major-screen demo patient. Remaining v0.2 proof gaps include free cooperation report DB-backed proof, share-case message thread DB-backed proof, and the `pg@9` concurrent `client.query()` warning.

## 20260620-0422 JST - UAT Feedback Disabled Send Reason

### Summary

- Added persistent helper text explaining why blank UAT feedback cannot be submitted.
- Linked the feedback textarea and disabled submit button to the helper/error text with `aria-describedby`.
- Replaced the old blank-submit toast path with local inline error state and regression coverage that input clears the disabled reason, enables submit, and does not call `toast.error`.

### Files Changed

- `src/app/(dashboard)/admin/uat/uat-content.tsx`
- `src/app/(dashboard)/admin/uat/uat-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/uat/uat-content.tsx' 'src/app/(dashboard)/admin/uat/uat-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/uat/uat-content.tsx' 'src/app/(dashboard)/admin/uat/uat-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/uat/uat-content.test.tsx'`: passed, 1 file / 1 test.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/uat/uat-content.tsx' 'src/app/(dashboard)/admin/uat/uat-content.test.tsx'`: passed.

### Remaining / Next Loop

- UAT feedback now exposes the disabled-send reason next to the feedback field and ties it to the submit control. Browser/a11y proof remains optional if the UAT admin page enters the UI proof queue.

## 20260620-0414 JST - Notification Escalation Inline Validation

### Summary

- Replaced toast-only invalid escalation threshold feedback with persistent inline error text.
- Wired the threshold input to help/error text with `aria-describedby` and `aria-invalid`.
- Added regression coverage that invalid threshold values block the POST before creating an escalation rule, do not fall back to `toast.error`, and clear stale inline errors after cancel/reopen.

### Files Changed

- `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
- `src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx' 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx'`: passed, unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx' 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/notification-settings/escalation-threshold.test.ts'`: passed, 1 file / 11 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check -- 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx' 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx'`: passed.

### Remaining / Next Loop

- Notification escalation rule creation now leaves persistent inline feedback for invalid thresholds. Browser/a11y proof remains optional if admin notification settings enters the UI proof queue.

## 20260620-0414 JST - Pharmacy Invoice Search/Audit DB-backed Proof

### Summary

- Extended the paid DB-backed pharmacy cooperation Playwright proof to verify filtered `GET /api/pharmacy-invoices` lookup after payment.
- Added DB readback for invoice lifecycle audit logs: draft creation, issue, payment recording, and PDF export.
- Verified the PDF export audit stores the expected export purpose on the generated invoice ID.

### Files Changed

- `tools/tests/ui-major-screens.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write tools/tests/ui-major-screens.spec.ts`: passed, unchanged.
- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `nc -z localhost 5433`: passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium --grep "patient card drives a DB-backed share, visit, report, and billing flow"`: passed, 1 Chromium test.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Paid invoice search and audit readback are now covered in the DB-backed flow. Remaining v0.2 proof gaps are the stale patient-detail `safety-board` expectation and the recurring `pg@9` concurrent `client.query()` warning.

## 20260620-0406 JST - Schedule Proposal Blocking Error Feedback

### Summary

- Added persistent inline feedback when weekly schedule proposal generation is blocked because no case is selected.
- Wired both the weekly grid action and the cell inspector action to the same blocking reason with `aria-describedby`.
- Added regression coverage through the weekly optimizer test mock so the disabled reason remains visible until a case is selected.

### Files Changed

- `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx`
- `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx`
- `src/app/(dashboard)/schedules/proposals/weekly-cell-inspector.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx' 'src/app/(dashboard)/schedules/proposals/weekly-cell-inspector.tsx'`: passed, unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx' 'src/app/(dashboard)/schedules/proposals/weekly-cell-inspector.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx' 'src/app/(dashboard)/schedules/proposals/weekly-cell-inspector.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx' 'src/app/(dashboard)/schedules/proposals/weekly-cell-inspector.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 5 tests.
- `pnpm typecheck`: passed.
- `git diff --check -- 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx' 'src/app/(dashboard)/schedules/proposals/weekly-cell-inspector.tsx'`: passed.

### Remaining / Next Loop

- Weekly proposal generation now exposes the missing-case blocker in the grid and cell inspector. Browser/a11y proof remains optional if schedule proposal enters the UI proof queue.

## 20260620-0402 JST - Report Composer Blocking Error Feedback

### Summary

- Added persistent inline errors for report composer states that block bulk send: no selected share target and incomplete pre-send checks.
- Connected the disabled bulk-send button to the active error text with `aria-describedby`, so the blocking reason is visible and announced instead of only implied by disabled state.
- Added regression coverage for both the initial incomplete-check state and the zero-recipient state.

### Files Changed

- `src/app/(dashboard)/reports/[id]/page.tsx`
- `src/app/(dashboard)/reports/[id]/page.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/reports/[id]/page.tsx' 'src/app/(dashboard)/reports/[id]/page.test.tsx'`: passed, unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/reports/[id]/page.tsx' 'src/app/(dashboard)/reports/[id]/page.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/reports/[id]/page.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 15 tests.
- `pnpm typecheck`: passed.
- `git diff --check -- 'src/app/(dashboard)/reports/[id]/page.tsx' 'src/app/(dashboard)/reports/[id]/page.test.tsx'`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Report composer blocking states now have visible inline feedback and ARIA linkage. Browser/a11y proof for the report detail composer remains optional if this route enters the UI proof queue.

## 20260620-0357 JST - Pharmacy Cooperation Message DB-backed Proof

### Summary

- Extended the paid DB-backed pharmacy cooperation Playwright proof to cover both patient-share-case-level and visit-request-level message threads.
- Added DB readback for `PharmacyCooperationMessageThread`, `PharmacyCooperationMessage`, and `AuditLog` so the proof verifies context type, message count, latest sender side/body, `last_message_at`, and create/view audit records.
- Confirmed the existing route unit coverage for PHI-safe audit/notification behavior still passes.

### Files Changed

- `tools/tests/ui-major-screens.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec vitest run src/app/api/pharmacy-cooperation-message-threads/route.test.ts --reporter=dot --testTimeout=30000`: passed, 1 file / 4 tests.
- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts src/app/api/pharmacy-cooperation-message-threads/route.ts src/app/api/pharmacy-cooperation-message-threads/route.test.ts`: passed.
- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --project=chromium --grep "patient card drives a DB-backed share, visit, report, and billing flow"`: passed, 1 Chromium test.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Patient-level and visit-request-level pharmacy cooperation messages are now DB-backed in the paid flow, including audit-log proof. Remaining v0.2 proof gaps include broader invoice search/audit browser coverage and the stale patient-detail `safety-board` expectation.
- The local E2E server again emitted the existing `pg@9` deprecation warning about concurrent `client.query()` use. It did not fail validation, but the recurrence makes it a concrete follow-up for DB helper/runtime cleanup.

## 20260620-0357 JST - Management Plan Inline Validation

### Summary

- Replaced toast-only management-plan editor validation with persistent inline errors for missing title and invalid JSON body.
- Added `aria-invalid` / `aria-describedby` wiring plus `role="alert"` error text for the title and JSON body controls.
- Kept toast as secondary feedback and preserved the existing valid submit path through the save mutation.
- Added regression coverage that invalid values do not call the create/update mutation and valid values still flow through the existing mutation path.

### Files Changed

- `src/app/(dashboard)/patients/[id]/management-plan-panel.tsx`
- `src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/management-plan-panel.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/management-plan-panel.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 4 tests.
- `git diff --check -- 'src/app/(dashboard)/patients/[id]/management-plan-panel.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm lint`: passed.
- Verifier subagent reported no major or medium regressions; its low valid-submit test gap was closed before final validation.

### Remaining / Next Loop

- Management-plan editor validation is now visible inline. Browser/a11y proof for the patient detail management-plan panel remains a possible follow-up if this route enters the UI proof queue.

## 20260620-0349 JST - Conferences Inline Validation

### Summary

- Replaced toast-only required validation for conference note creation with persistent inline errors for title, conference datetime, and content/structured sections.
- Replaced toast-only required validation for community activity creation with persistent inline errors for activity type, activity datetime, and title.
- Added `aria-invalid` / `aria-describedby` wiring plus `role="alert"` error text, following `docs/ui-ux-design-guidelines.md` guidance for explicit dynamic errors.
- Added regression tests that invalid submits show inline errors and do not call the create mutations.
- Addressed verifier follow-up by tying structured-section textareas to the shared content/structured error and resetting community-activity inline errors when the dialog closes through the close affordance.

### Files Changed

- `src/app/(dashboard)/conferences/conferences-content.tsx`
- `src/app/(dashboard)/conferences/conferences-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec eslint 'src/app/(dashboard)/conferences/conferences-content.tsx' 'src/app/(dashboard)/conferences/conferences-content.test.tsx' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/conferences/conferences-content.test.tsx' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 13 tests, with an existing DataTable act warning in the consent focused test.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- `pnpm lint`: passed.
- Verifier subagent initially found two low-severity follow-ups: structured-section controls were not tied to the content/structured error, and community-activity inline errors could stay stale after closing via the dialog close affordance. Both were fixed and revalidated with targeted Prettier, targeted ESLint, focused Vitest, `pnpm typecheck`, `pnpm format:check`, `git diff --check`, and `pnpm lint`.

### Remaining / Next Loop

- Conference note/activity required-field validation is now visible inline. Browser/a11y proof for the conferences page remains a possible follow-up if this route enters the UI proof queue.

## 20260620-0346 JST - Free Cooperation Report DB-backed Proof

### Summary

- Added a separate UI demo free partner pharmacy, active partnership, active contract, active contract version, and `free` fee rule fixture.
- Generalized the patient-share cleanup and share-case read helpers so paid and free E2E cases can run against the same patient without deleting each other's partnership/contract records.
- Added a DB-backed Playwright proof for the free cooperation path: share case, consent, patient link approval/acceptance, activation, visit request, partner visit record, base confirmation, visit billing candidate, `free_cooperation_report` draft/issue, PDF generation, and workflow table visibility.
- Confirmed the existing paid DB-backed flow still passes after the helper changes.

### Files Changed

- `tools/tests/ui-major-screens.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- `pnpm exec prettier --write tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm exec eslint tools/tests/ui-major-screens.spec.ts`: passed.
- `pnpm typecheck`: initially failed because `readUiDemoPatientShareCase` inferred a literal default partnership type, then passed after annotating the parameter as `string`.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --grep "patient share flow produces a DB-backed free cooperation report"`: passed, 2 projects / 2 tests.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-major-screens.spec.ts --grep "patient card drives a DB-backed share|patient share flow produces a DB-backed free cooperation report" --project=chromium`: passed, 2 tests.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- `pnpm lint`: passed.

### Remaining / Next Loop

- Free cooperation report output is now DB-backed through issued report PDF. Remaining v0.2 proof gaps include share-case message thread DB-backed proof, broader invoice search/audit browser coverage, and the stale patient-detail `safety-board` expectation.
- The E2E server emitted an existing `pg@9` deprecation warning about concurrent `client.query()` use during local Playwright; it did not fail the run but should be tracked separately if it recurs in focused DB helper work.

## 20260620-0344 JST - Consent Record Inline Validation

### Summary

- Replaced toast-only validation in the consent-record create dialog with persistent inline errors for missing consent type and obtained date.
- Added `aria-invalid` / `aria-describedby` wiring for the required consent-type Select trigger and obtained-date input.
- Kept toast as secondary feedback and `noValidate` on the form so the custom inline validation runs before any create mutation.
- Extended regression coverage to prove invalid submits do not `POST /api/consent-records`, while existing document-file create/update behavior remains unchanged.

### Files Changed

- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx`
- `src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 6 tests, with an existing DataTable act warning in this focused test environment.
- `git diff --check -- 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx' 'src/app/(dashboard)/patients/[id]/consent/consent-records-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- Verifier subagent reported no blocking findings for the consent-record inline-validation slice.

### Remaining / Next Loop

- Consent-record create validation is now visible inline for the required fields. Broader UI/UX remediation remains active for remaining toast-only form validation, browser/a11y proof expansion, and any unrelated dirty E2E spec work preserved in the worktree.

## 20260620-0224 JST - Admin Analytics Monthly Trend DataTable

### Summary

- Replaced the admin analytics monthly-trend raw table with the shared `DataTable`.
- Kept the existing aggregate columns and added table search, column visibility, row labels, loading, empty, and mobile-card behavior through the shared component.
- Added a focused regression test with route-level fetch mocks to prove the monthly trend uses aggregate-only DataTable controls.

### Files Changed

- `src/app/(dashboard)/admin/analytics/analytics-content.tsx`
- `src/app/(dashboard)/admin/analytics/analytics-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/analytics/analytics-content.tsx' 'src/app/(dashboard)/admin/analytics/analytics-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/analytics/analytics-content.tsx' 'src/app/(dashboard)/admin/analytics/analytics-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/analytics/analytics-content.test.tsx' --reporter=dot --testTimeout=30000`: initially exposed a test assertion/wait issue, then passed with 1 file / 1 test.
- `rg -n "<table|overflow-auto|min-w-full|overflow-x-auto" 'src/app/(dashboard)/admin/analytics/analytics-content.tsx'`: passed with no matches.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Admin analytics monthly trend convergence is addressed for this slice. UI/UX remediation remains active for raw tables in other routes, pharmacy-cooperation responsive density, and expanded browser/a11y proof.

## 20260620-0228 JST - Inventory Forecast Drug DataTable

### Summary

- Replaced the admin inventory-forecast drug-demand raw table with the shared `DataTable`.
- Kept affected-patient cards outside the table/search surface to avoid adding patient-name search.
- Added a focused regression test proving the drug table has aggregate-safe search/column controls while the affected-patient list does not gain a search input.

### Files Changed

- `src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx`
- `src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx' 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx' 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx' 'src/components/ui/data-table.test.tsx' --reporter=dot --testTimeout=30000`: initially exposed a duplicate text assertion in the new test, then passed with 2 files / 4 tests.
- `rg -n "<table|overflow-x-auto|min-w-full|min-w-\\[" 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx'`: passed with no matches.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Inventory drug table convergence is addressed. Affected-patient cards intentionally remain non-DataTable to avoid patient search; remaining PHI-bearing raw tables should be handled only with search disabled or targeted action-name/accessibility fixes.

## 20260620-0231 JST - Pharmacy Contract Renewal Alerts

### Summary

- Added a PHI-free contract renewal alert section to the pharmacy-cooperation setup screen.
- Flags active, suspended, expired, and approval-pending contracts when `effective_to` is expired or within 60 days.
- Shows contract ID, base/partner pharmacy names, status, end date, and fee model only; it does not expose patient data, contract body text, filenames, or file links.
- Added a focused regression test proving a soon-ending contract renders in the alert list and does not make patient/file details searchable or visible.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 6 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Contract renewal alerting is now covered at the admin setup UI level without a DB migration. Pending migration application and direct DB-backed browser proof still require the existing external approval path.

## 20260620-0232 JST - Workflow Refill Proposal Action Names

### Summary

- Added target-specific accessible names to repeated refill/split `候補生成` buttons.
- Used row context (`リフィル` / `分割調剤` and row number) rather than patient names to avoid adding PHI to button names.
- Added a focused regression test proving the button is distinguishable and does not expose the patient name in its accessible name.

### Files Changed

- `src/app/(dashboard)/workflow/workflow-dashboard-view.tsx`
- `src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/workflow-dashboard-view.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/workflow-dashboard-view.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 4 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Refill proposal action naming is addressed. PHI-bearing raw tables remain intentionally not converted to searchable DataTables; future fixes should use search-disabled tables or targeted accessible-name updates.

## 20260620-0235 JST - Pharmacy Workflow Correction Request DataTable

### Summary

- Replaced the pharmacy-cooperation workflow correction-request raw table with the shared `DataTable`.
- Kept raw reason and proposed-value content out of the list/search surface; the table uses request ID, target type, field path, status, and update time only.
- Added focused regression coverage for the DataTable search/column controls and adjusted duplicate-safe assertions for desktop/mobile DataTable rendering.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: initially exposed a duplicate text assertion after DataTable mobile/desktop rendering, then passed with 1 file / 12 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- Static scan for `TableFrame label="修正依頼一覧"`: passed with no matches.

### Remaining / Next Loop

- Correction request table convergence is addressed without exposing reason/proposed-value free text. Remaining pharmacy-cooperation raw tables include PHI-bearing share-case, consent, visit-request, and partner-record tables; future DataTable work must either keep search disabled or use targeted non-PHI labels.

## 20260620-0237 JST - Admin Shift Calendar Cell Buttons

### Summary

- Changed edit-mode monthly shift cells from clickable table cells into native buttons inside each cell.
- Added PHI-free accessible names with staff/date/site/availability context.
- Added a regression test proving edit-mode cells are exposed as buttons and open the matching shift edit panel.

### Files Changed

- `src/app/(dashboard)/admin/shifts/shifts-content.tsx`
- `src/app/(dashboard)/admin/shifts/shifts-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/shifts/shifts-content.tsx' 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/shifts/shifts-content.tsx' 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 3 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Shift calendar edit cells are now keyboard-accessible. The monthly matrix remains a calendar-style table rather than a DataTable; future work should focus on grid semantics or browser/a11y proof.

## 20260620-0253 JST - Dispense Calendar Native Cell Buttons

### Summary

- Replaced dispense-workbench medication calendar cell `div role="button"` controls with native buttons.
- Removed custom keyboard activation and relied on native button semantics.
- Added PHI-minimized cell names using day index, timing key, packet/PTP counts, and normalized state only.
- Added regression coverage proving hold free text and owner details stay out of the button name while cell selection still fires.

### Files Changed

- `src/components/features/dispense-workbench/medication-calendar-grid.tsx`
- `src/components/features/dispense-workbench/medication-calendar-grid.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write src/components/features/dispense-workbench/medication-calendar-grid.tsx src/components/features/dispense-workbench/medication-calendar-grid.test.tsx`: passed.
- `pnpm exec eslint src/components/features/dispense-workbench/medication-calendar-grid.tsx src/components/features/dispense-workbench/medication-calendar-grid.test.tsx`: passed.
- `pnpm exec vitest run src/components/features/dispense-workbench/medication-calendar-grid.test.tsx --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- `rg -n "role=\"button\"|activateOnKey|KeyboardEvent" src/components/features/dispense-workbench/medication-calendar-grid.tsx || true`: passed, no matches.

### Remaining / Next Loop

- Dispense-workbench calendar cell controls now use native button semantics. Browser/mobile proof for the full workbench remains a separate follow-up.

## 20260620-0250 JST - Billing Check PHI Toolbar Guard

### Summary

- Added regression assertions that the billing-check PHI review DataTable does not render `CSV出力` or `印刷`.
- Kept the existing assertion that the section has no search textbox.
- This locks the toolbar to column visibility only for patient-label review rows.

### Files Changed

- `src/app/(dashboard)/billing/billing-check-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/billing/billing-check-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/billing/billing-check-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/billing-check-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 7 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Billing-check review rows remain protected from DataTable search, CSV export, and print toolbar affordances. Browser/mobile visual proof remains a separate follow-up.

## 20260620-0244 JST - Billing Check Review DataTable

### Summary

- Replaced the billing-check review raw table with the shared `DataTable`.
- Kept the toolbar limited to column visibility because the rows contain patient labels.
- Added regression coverage that the review table has a captioned table, a column control, and no search textbox.

### Files Changed

- `src/app/(dashboard)/billing/billing-check-content.tsx`
- `src/app/(dashboard)/billing/billing-check-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/billing-check-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/billing-check-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/billing-check-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 7 tests.
- `if rg -n '<table|overflow-x-auto|min-w-full' 'src/app/(dashboard)/billing/billing-check-content.tsx'; then exit 1; else echo 'no raw billing check review table'; fi`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Billing-check review list now uses the shared DataTable shell without global search, CSV, or print output. Remaining PHI-bearing raw tables should follow the same search-disabled pattern if converted.

## 20260620-0245 JST - Prescription History Native Toggles

### Summary

- Replaced the prescription-intake card header's click/role behavior with a native button.
- Added date-only open/close accessible names and kept patient/drug names out of the toggle name.
- Added regression coverage for the native button tag, `aria-expanded`, and PHI-minimized label.

### Files Changed

- `src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx`
- `src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/billing-check-content.test.tsx' 'src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx' 'src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/billing/billing-check-content.tsx' 'src/app/(dashboard)/billing/billing-check-content.test.tsx' 'src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx' 'src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/billing-check-content.test.tsx' 'src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 9 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Prescription history card toggles are now native buttons. Broader prescription-history raw table and print surfaces remain separate candidates.

## 20260620-0057 JST - QR Draft Case Selector Label

### Summary

- Added an explicit accessible name to the QR prescription draft case selector.
- Added a lightweight accessibility contract test matching existing static source-contract test patterns for route-heavy pages.

### Files Changed

- `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx`
- `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx' 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts' 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.helpers.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 3 tests.
- `pnpm exec eslint 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx' 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, raw table/DataTable convergence, expanded browser/a11y proof, and broader legacy select/input label scans outside the fixed QR draft case selector.

## 20260620-0054 JST - Patient Detail Label Associations

### Summary

- Associated case primary/backup pharmacist Select controls with visible labels.
- Added an accessible label for the management-plan case selector and kept the no-case state as a status message.
- Associated the care-team quick-create profession Select with its visible `職種` label.
- Added regression assertions for case pharmacist labels, management-plan case selection, and quick-create profession labeling.

### Files Changed

- `src/app/(dashboard)/patients/[id]/cases-tab.tsx`
- `src/app/(dashboard)/patients/[id]/cases-tab.test.tsx`
- `src/app/(dashboard)/patients/[id]/management-plan-panel.tsx`
- `src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/cases-tab.tsx' 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx' --reporter=dot --testTimeout=30000`: passed, 3 files / 5 tests.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/cases-tab.tsx' 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.tsx' 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, raw table/DataTable convergence, expanded browser/a11y proof, and broader legacy select/input label scans outside the fixed patient detail panels.

## 20260620-0051 JST - Search Advanced Filter Label Associations

### Summary

- Replaced visual-only advanced filter row text for Select controls with associated `Label` components.
- Added stable trigger IDs for visit date, assignee, cycle status, proposal status, and medication-deadline filters.
- Added a regression test proving those Select filters are reachable by their visible labels.

### Files Changed

- `src/app/(dashboard)/search/advanced-filter-modal.tsx`
- `src/app/(dashboard)/search/advanced-filter-modal.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/search/advanced-filter-modal.tsx' 'src/app/(dashboard)/search/advanced-filter-modal.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/search/advanced-filter-modal.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/search/advanced-filter-modal.tsx' 'src/app/(dashboard)/search/advanced-filter-modal.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, raw table/DataTable convergence, expanded browser/a11y proof, and broader legacy select/input label scans outside the fixed search advanced-filter controls.

## 20260620-0048 JST - Admin User and Credential Label Associations

### Summary

- Associated pharmacist credential dialog controls with their visible labels and added a regression test for the registration dialog.
- Associated admin user filters, invite fields, detail fields, visit constraints, permission switches, and action reason textarea with visible labels.
- Added target-specific accessible names for user row actions and the detail-sheet retire action.
- Added regression assertions covering user filters, row actions, invite form labels, detail form labels, switches, and action reason labels.

### Files Changed

- `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx`
- `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx`
- `src/app/(dashboard)/admin/users/users-content.tsx`
- `src/app/(dashboard)/admin/users/users-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 4 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, raw table/DataTable convergence, expanded browser/a11y proof, and broader legacy select/input label scans outside the fixed admin credential/user screens.

## 20260620-0038 JST - Pharmacy Cooperation Table Density

### Summary

- Added explicit table min-widths to pharmacy-cooperation setup tables so dense rows preserve readable columns inside horizontal scroll containers.
- Added explicit min-widths to partner cooperation billing candidate and invoice tables.
- Added an explicit min-width to the shared pharmacy-cooperation workflow table frame.
- Added regression assertions for the affected table widths.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 3 files / 22 tests.
- Targeted ESLint over the six touched pharmacy-cooperation files: passed.
- Targeted Prettier check over the six touched pharmacy-cooperation files: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0040 JST - Data Explorer Control Labels

### Summary

- Added accessible labels to the model search, category filter, row search, and JSON editor controls.
- Added a focused regression test proving those high-power admin controls are reachable by label.

### Files Changed

- `src/app/(dashboard)/admin/data-explorer/data-explorer-content.tsx`
- `src/app/(dashboard)/admin/data-explorer/data-explorer-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.tsx' 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.tsx' 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.test.tsx'`: passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.tsx' 'src/app/(dashboard)/admin/data-explorer/data-explorer-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include select accessible-name gaps in incidents, pharmacist credentials, settings, and users, plus raw table/DataTable convergence and expanded browser/a11y proof.

## 20260620-0042 JST - Settings Editor Mode Label

### Summary

- Added an accessible label to the admin settings form/json editor mode Select.
- Extended the existing settings test to assert the control is reachable by label.

### Files Changed

- `src/app/(dashboard)/admin/settings/settings-content.tsx`
- `src/app/(dashboard)/admin/settings/settings-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/settings/settings-content.tsx' 'src/app/(dashboard)/admin/settings/settings-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/settings/settings-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/admin/settings/settings-content.tsx' 'src/app/(dashboard)/admin/settings/settings-content.test.tsx'`: passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/settings/settings-content.tsx' 'src/app/(dashboard)/admin/settings/settings-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include select accessible-name gaps in pharmacist credentials and users, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0048 JST - Admin User And Credential Label Associations

### Summary

- Associated pharmacist credential dialog labels with their Select/Input controls.
- Associated admin user filters, invite fields, detail fields, switches, and account-action reason textarea with visible labels.
- Added target-specific accessible names for user row actions and the detail-sheet retire action.
- Added focused mocked UI regression tests for both admin surfaces.

### Files Changed

- `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx`
- `src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx`
- `src/app/(dashboard)/admin/users/users-content.tsx`
- `src/app/(dashboard)/admin/users/users-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx' --reporter=dot --testTimeout=30000`: initially failed on an invalid users test interaction after the detail sheet made the background inert; after correcting the test to open the detail-sheet retire action, passed with 2 files / 4 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.tsx' 'src/app/(dashboard)/admin/pharmacist-credentials/pharmacist-credentials-content.test.tsx' 'src/app/(dashboard)/admin/users/users-content.tsx' 'src/app/(dashboard)/admin/users/users-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Read-only `SelectTrigger` accessible-name rescan: no remaining pharmacist credentials or admin users hits.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining select accessible-name gaps from the latest scan are in prescriptions QR drafts, conferences, advanced search, and patient detail panels. Raw table/DataTable convergence and expanded browser/a11y proof also remain.

## 20260620-0051 JST - Advanced Search Filter Label Associations

### Summary

- Replaced advanced search modal Select row label spans with associated `Label htmlFor` controls.
- Added stable ids to visit date, assignee, cycle status, proposal status, and medication deadline Select triggers.
- Added a modal-only regression test proving all five Select filters are reachable by their visible labels.

### Files Changed

- `src/app/(dashboard)/search/advanced-filter-modal.tsx`
- `src/app/(dashboard)/search/advanced-filter-modal.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/search/advanced-filter-modal.tsx' 'src/app/(dashboard)/search/advanced-filter-modal.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/search/advanced-filter-modal.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- Targeted ESLint over search/admin touched TSX/test files: passed.
- Targeted Prettier check over search/admin touched TSX/test files: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Read-only `SelectTrigger` accessible-name rescan: no remaining advanced search hits.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining select accessible-name gaps from the latest scan are in prescriptions QR drafts, conferences, and patient detail panels. Raw table/DataTable convergence and expanded browser/a11y proof also remain.

## 20260620-0055 JST - Patient Detail Select Label Associations

### Summary

- Added an accessible name to the management-plan case selector.
- Associated case-edit primary and backup pharmacist labels with their Select triggers.
- Associated the care-team quick-create profession label with its Select trigger.
- Updated focused patient-detail tests to cover the new label associations and current empty-state semantics.

### Files Changed

- `src/app/(dashboard)/patients/[id]/management-plan-panel.tsx`
- `src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx`
- `src/app/(dashboard)/patients/[id]/cases-tab.tsx`
- `src/app/(dashboard)/patients/[id]/cases-tab.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over the six touched patient files: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/management-plan-panel.test.tsx' 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx' --reporter=dot --testTimeout=30000`: initially failed on an obsolete management-plan empty-state button assertion; after updating it to the current `role="status"` empty state, passed with 3 files / 5 tests.
- Targeted ESLint over search/patient touched TSX/test files: passed.
- Targeted Prettier check over search/patient touched TSX/test files: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Read-only `SelectTrigger` accessible-name rescan: no remaining patient-detail hits.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining select accessible-name gaps from the latest scan are in prescriptions QR drafts and conferences. Raw table/DataTable convergence and expanded browser/a11y proof also remain.

## 20260620-0058 JST - Conference Dialog Label Associations

### Summary

- Associated the conference participant external-professional Select with its visible `登録済み他職種` label.
- Associated the conference report-generation Select with its visible `報告書種別` label.
- Extended conferences UI tests to cover both dialog controls by visible labels.
- Wrapped the direct mutation success callback in `act(...)` so the focused test run is warning-free.

### Files Changed

- `src/app/(dashboard)/conferences/conferences-content.tsx`
- `src/app/(dashboard)/conferences/conferences-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/conferences/conferences-content.tsx' 'src/app/(dashboard)/conferences/conferences-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/conferences/conferences-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- `pnpm exec eslint 'src/app/(dashboard)/conferences/conferences-content.tsx' 'src/app/(dashboard)/conferences/conferences-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include raw table/DataTable convergence, expanded browser/a11y proof, and broader legacy select/input label scans outside the fixed conference dialogs.

## 20260620-0100 JST - Conference Participant Input Label Associations

### Summary

- Associated conference participant name, role/organization, email, and fax labels with their Input controls.
- Extended the conferences UI test to assert all participant fields are reachable by visible labels.
- Kept the focused conferences test run warning-free after the participant input assertions.

### Files Changed

- `src/app/(dashboard)/conferences/conferences-content.tsx`
- `src/app/(dashboard)/conferences/conferences-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/conferences/conferences-content.tsx' 'src/app/(dashboard)/conferences/conferences-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/conferences/conferences-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests; rerun emitted no React `act(...)` warnings.
- `pnpm exec eslint 'src/app/(dashboard)/conferences/conferences-content.tsx' 'src/app/(dashboard)/conferences/conferences-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Conferences participant text inputs have focused coverage. Broader remaining candidates include QR draft prescription line Input labels, wider Input/Textarea label remediation, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0103 JST - QR Draft Input Label Associations

### Summary

- Associated QR draft prescription header inputs with visible labels.
- Associated prescription-line edit inputs for drug, code, dose, frequency, days, dosage form, start/end dates, packaging, and notes with labels.
- Added distinct accessible names for the quantity and unit inputs inside the shared quantity/unit group.
- Expanded the QR draft accessibility contract test and replaced the standalone quantity/unit `Label` with grouped text because each input now has its own accessible name.

### Files Changed

- `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx`
- `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx' 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts' 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.helpers.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 4 tests.
- `pnpm exec eslint 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx' 'src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.accessibility.test.ts'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Conferences participant inputs and QR draft review inputs have focused coverage. Broader remaining candidates include wider Input/Textarea label remediation, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0107 JST - Patient Master Input Label Associations

### Summary

- Associated patient master identity, contact, residence, insurance, allergy-name, and notes fields with accessible labels.
- Updated the local `Field` helper to bind the repo `Input` and `Textarea` components while leaving Select controls on their explicit `aria-label` path.
- Added focused assertions that patient master fields can be reached by their visible labels.

### Files Changed

- `src/app/(dashboard)/patients/[id]/patient-master-card.tsx`
- `src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/patient-master-card.tsx' 'src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/patient-master-card.tsx' 'src/app/(dashboard)/patients/[id]/patient-master-card.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. QR draft, conferences, and patient master inputs have focused coverage. Broader remaining candidates include patient contacts/care-team/cases Input/Textarea labels, workflow pharmacy cooperation labels, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0110 JST - Patient Contact Input Label Associations

### Summary

- Added row-specific accessible names to patient contact name, phone, email, organization, department, fax, address, and notes fields.
- Extended the patient contacts test to assert each repeated-row input is reachable by label.
- Preserved the existing contact save payload, reliability warning handling, and panel layout.

### Files Changed

- `src/app/(dashboard)/patients/[id]/patient-contacts-panel.tsx`
- `src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.tsx' 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.tsx' 'src/app/(dashboard)/patients/[id]/patient-contacts-panel.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Patient contacts, patient master, QR draft, and conferences inputs have focused coverage. Broader remaining candidates include care-team/cases Input/Textarea labels, workflow pharmacy cooperation labels, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0113 JST - Patient Case Input Label Associations

### Summary

- Added row-specific accessible names to patient case referral source/date, start/end dates, end reason, and notes fields.
- Extended the cases tab test to assert the first case's editable fields are reachable by label.
- Preserved the existing case save payload, pharmacist assignment controls, status transitions, and layout.

### Files Changed

- `src/app/(dashboard)/patients/[id]/cases-tab.tsx`
- `src/app/(dashboard)/patients/[id]/cases-tab.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/cases-tab.tsx' 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/cases-tab.tsx' 'src/app/(dashboard)/patients/[id]/cases-tab.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Patient cases, patient contacts, patient master, QR draft, and conferences inputs have focused coverage. Broader remaining candidates include care-team Input/Textarea labels, workflow pharmacy cooperation labels, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0117 JST - Remaining Patient Detail Input Label Associations

### Summary

- Associated visit-constraint time-range labels with their time inputs using stable `id`/`htmlFor` pairs.
- Added row-specific accessible names to repeated care-team contact fields and quick-create dialog fields.
- Extended focused tests for visit time ranges, care-team row fields, and quick-create dialog fields.

### Files Changed

- `src/app/(dashboard)/patients/[id]/visit-constraints-card.tsx`
- `src/app/(dashboard)/patients/[id]/visit-constraints-card.test.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx`
- `src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/visit-constraints-card.tsx' 'src/app/(dashboard)/patients/[id]/visit-constraints-card.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx'`: passed, unchanged.
- Initial focused visit-constraints Vitest failed because the new assertions used non-current label text; the assertions were corrected to the actual UI labels.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/visit-constraints-card.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 4 tests.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/visit-constraints-card.tsx' 'src/app/(dashboard)/patients/[id]/visit-constraints-card.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.tsx' 'src/app/(dashboard)/patients/[id]/patient-care-team-panel.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Patient detail input/select label coverage now includes master, contacts, cases, care team, and visit constraints. Broader remaining candidates include workflow pharmacy cooperation labels, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0121 JST - Inquiry Workbench Input Label Associations

### Summary

- Added row-scoped accessible labels to inquiry workbench edit fields for drug name, dose, frequency, days, and memo.
- Kept patient and drug values out of the control labels, matching the no-PHI-in-notification/accessibility-name constraint.
- Added a focused regression test proving the labels exist and do not include patient or drug names.

### Files Changed

- `src/app/(dashboard)/workflow/workflow-dashboard-view.tsx`
- `src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/workflow-dashboard-view.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 3 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/workflow-dashboard-view.tsx' 'src/app/(dashboard)/workflow/workflow-dashboard-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- In-home cooperation goal remains active. UI label hardening has covered current patient-detail surfaces and the workflow inquiry workbench. Next candidates include pharmacy-cooperation workflow/admin/billing forms, raw table/DataTable convergence, and browser/a11y proof.

## 20260620-0124 JST - Patient Condition Row Label Associations

### Summary

- Added row-scoped accessible names to condition name, noted date, and notes fields without embedding condition names.
- Added row-scoped names to primary/active checkboxes and delete actions so repeated rows are not ambiguous.
- Extended the patient conditions card test to assert all first-row controls are reachable by label/name.

### Files Changed

- `src/app/(dashboard)/patients/[id]/patient-conditions-card.tsx`
- `src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/patients/[id]/patient-conditions-card.tsx' 'src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/patients/[id]/patient-conditions-card.tsx' 'src/app/(dashboard)/patients/[id]/patient-conditions-card.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- In-home cooperation goal remains active. Patient-detail label hardening now also includes condition/problem rows. Next candidates remain pharmacy-cooperation workflow/admin/billing forms, raw table/DataTable convergence, and browser/a11y proof.

## 20260620-0127 JST - Report and Search Input Label Associations

### Summary

- Added an accessible name to the report delivery overdue-days input.
- Added an accessible name to the global search keyword input and shifted the search test helper to label-based lookup.
- Verified the report/search files no longer contain unlabeled Input/Textarea controls.
- Re-ran a conservative dashboard-wide Input/Textarea scan and kept the remaining broader candidates open instead of treating the scan as clean.

### Files Changed

- `src/app/(dashboard)/reports/report-delivery-dashboard.tsx`
- `src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx`
- `src/app/(dashboard)/search/search-content.tsx`
- `src/app/(dashboard)/search/search-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over report/search UI and test files: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' 'src/app/(dashboard)/search/search-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 2 files / 16 tests.
- Report/search file-local Input/Textarea scan: passed, 0 unlabeled controls.
- `pnpm exec eslint 'src/app/(dashboard)/reports/report-delivery-dashboard.tsx' 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' 'src/app/(dashboard)/search/search-content.tsx' 'src/app/(dashboard)/search/search-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Conservative dashboard-wide Input/Textarea static scan: still reports additional candidates outside report/search, including pharmacy-cooperation workflow/admin, partner billing, saved views, schedule optimizer, patient board, admin settings JSON draft, document template body editor, PCA pump, and drug-master fields.

### Remaining / Next Loop

- UI/UX remediation remains active. Continue with a bounded pharmacy-cooperation or partner-billing label slice first because those screens are closest to the in-home cooperation spec.

## 20260620-0131 JST - Final Dashboard Input/Textarea Label Sweep

### Summary

- Added an accessible name to the schedule optimizer preferred-time end input.
- Added a stable id to the drug-master reorder-point input so the existing wrapped label is easier to audit.
- Added an accessible name to the admin settings JSON editor textarea.
- Re-ran the dashboard-wide Input/Textarea scan and brought it to zero unlabeled controls under `src/app/(dashboard)`.

### Files Changed

- `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx`
- `src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx`
- `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
- `src/app/(dashboard)/admin/settings/settings-content.tsx`
- `src/app/(dashboard)/admin/settings/settings-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over schedule optimizer, drug master, and settings files: passed, unchanged.
- Initial settings JSON-mode interaction coverage failed because the Base UI Select interaction did not enter JSON mode reliably in jsdom; that brittle assertion was replaced with static source coverage for the hidden JSON editor label.
- `pnpm exec vitest run 'src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.test.tsx' 'src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx' 'src/app/(dashboard)/admin/settings/settings-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 3 files / 14 tests.
- Improved dashboard-wide Input/Textarea static scan: passed, `NO_MISSING_INPUT_TEXTAREA_NAMES`.
- Targeted ESLint over the same files: passed.
- `pnpm typecheck`: passed.
- Markdown Prettier over `.codex/ralph-state.md`: failed due Node heap OOM even with an 8GB heap; ledger whitespace was checked with `git diff --check` instead.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. This closes the current dashboard Input/Textarea static scan. Next pass should scan SelectTrigger/action names/table density and then run browser/a11y proof for the highest-risk flows.

## 20260620-0137 JST - Calendar Navigation Action Names

### Summary

- Added accessible names to the previous/next month buttons in the business-holiday calendar.
- Added accessible names to the previous/next month buttons in the conference calendar.
- Covered both changes in the existing focused UI tests.

### Files Changed

- `src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx`
- `src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx`
- `src/app/(dashboard)/conferences/conferences-content.tsx`
- `src/app/(dashboard)/conferences/conferences-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over business-holiday and conference files: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec vitest run 'src/app/(dashboard)/conferences/conferences-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- Targeted ESLint over the same files: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Next pass should run a fresh action-name/table-density scan, with pharmacy-cooperation workflow/admin/billing still the highest-priority area if new issues appear.

## 20260620-0138 JST - Shared Close Button Action Names

### Summary

- Added static accessible names to the shared Dialog and Sheet close icon buttons.
- Extended Dialog/Sheet component tests to assert the close controls are reachable by name.
- Re-ran the improved `size="icon"` Button scan and cleared the remaining shared close-button hits.

### Files Changed

- `src/components/ui/dialog.tsx`
- `src/components/ui/dialog.test.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/sheet.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- Targeted Prettier over Dialog/Sheet files: passed, unchanged.
- `pnpm exec vitest run src/components/ui/dialog.test.tsx src/components/ui/sheet.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 3 tests.
- Targeted ESLint over Dialog/Sheet files: passed.
- Improved `size="icon"` Button static scan: passed, 0 unlabeled icon-sized Buttons under dashboard/components.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Input/Textarea, SelectTrigger, and icon-sized Button static scans are clean. Next pass should cover table-density and browser/a11y proof for the highest-risk pharmacy-cooperation or workflow surfaces.

## 20260620-0142 JST - Notification PHI Check and Partner Invoice PDF Links

### Summary

- Verified that external SMS/LINE/Web Push notification delivery uses fixed non-PHI content while in-app notifications retain detail behind login.
- Confirmed pharmacy-cooperation message and partner-visit notification routes pass generic notification messages.
- Added row-specific accessible names to partner-cooperation invoice PDF links.

### Files Changed

- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run src/server/services/notifications.test.ts 'src/app/api/pharmacy-cooperation-message-threads/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 18 tests.
- Targeted ESLint over notification service and pharmacy-cooperation message route/test: passed.
- Targeted Prettier over partner-cooperation billing files: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- Targeted ESLint over partner-cooperation billing files: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Notification PHI redaction is verified for the inspected paths. UI/UX remediation remains active; next pass should cover table-density/browser-a11y proof or any remaining pharmacy-cooperation action-name findings.

## 20260620-0145 JST - Confirmed Partner Visit Billing Gate

### Summary

- Verified that visit billing candidate generation only scans partner visit records with `status: 'confirmed'` and `confirmed_at` set.
- Verified that the monthly summary confirmed-record count uses the same confirmed/confirmed-at gate.
- Confirmed the existing tests already lock the generation and summary query contracts, so no route code change was required.

### Files Changed

- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec vitest run 'src/app/api/visit-billing-candidates/route.test.ts' 'src/app/api/visit-billing-candidates/summary/route.test.ts' --reporter=dot --testTimeout=30000`: passed, 2 files / 7 tests.
- `pnpm exec eslint 'src/app/api/visit-billing-candidates/route.ts' 'src/app/api/visit-billing-candidates/route.test.ts' 'src/app/api/visit-billing-candidates/summary/route.ts' 'src/app/api/visit-billing-candidates/summary/route.test.ts'`: passed.

### Remaining / Next Loop

- Billing candidate confirmed-record gating is verified for the inspected routes. UI/UX remediation remains active; next pass should cover table-density/browser-a11y proof or any remaining pharmacy-cooperation action-name findings.

## 20260620-0148 JST - Partner Cooperation Billing DataTables

### Summary

- Replaced the partner-cooperation billing candidate and monthly document raw tables with the shared `DataTable`.
- Added table search, column visibility, row labels, and typed export values while keeping the existing PDF/action names and PHI-minimized row content.
- Updated the billing UI regression to assert the new DataTable search controls and preserved PDF link contract.

### Files Changed

- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx`
- `src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- `pnpm exec eslint 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx' 'src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- `rg -n "<table|overflow-x-auto|min-w-\\[" 'src/app/(dashboard)/billing/partner-cooperation' -g '*.tsx'`: found no remaining raw table or `overflow-x-auto`; the only remaining `min-w-[36rem]` is the controls grid, not a table.

### Remaining / Next Loop

- Partner-cooperation billing tables now use the shared DataTable contract. UI/UX remediation remains active; next pass should run browser/a11y proof or continue scanning pharmacy-cooperation action names.

## 20260620-0153 JST - Patient Share Consent Revoke Safety

### Summary

- Moved patient-share-consent revoke into the shared pharmacy-cooperation `ConfirmDialog` flow.
- Required a non-empty trimmed revoke reason before enabling the row action and before sending the mutation body.
- Made the revoke action destructive and target-specific, with confirmation details for share case, partner pharmacy, consent ID/date, and reason length.
- Bound the revoke mutation to the consent's own share-case ID so a later selector change cannot retarget the request.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' tools/tests/ui-route-mocked-smoke.spec.ts`: passed, unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 12 tests after fixing the confirmation detail to show the full consent ID.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- Focused `rg` scan for revoke wiring: confirmed the revoke mutation is invoked from the pending workflow action path and rejects empty reasons.

### Remaining / Next Loop

- Patient-share-consent revoke now requires reason + confirmation before API execution, and the revoke URL is bound to the target consent's share case. UI/UX remediation remains active; route-mocked browser/a11y proof was expanded in the next grouped test slice.

## 20260620-0154 JST - Partner Billing Route-Mocked Browser Proof

### Summary

- Extended the route-mocked pharmacy-cooperation browser smoke to exercise the new partner billing DataTable search controls.
- Added monthly document filtering, root overflow checking, and an axe critical/serious scan for the partner-cooperation billing surface.
- Scoped the PDF link assertion to the generated invoice draft result so repeated links remain unambiguous.

### Files Changed

- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `nc -z localhost 3012`: passed.
- `nc -z localhost 5433`: passed.
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project chromium --grep "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test in 8.8s on the latest rerun.
- `pnpm exec eslint tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Partner billing DataTable now has route-mocked browser/a11y proof. UI/UX remediation remains active; next candidates are patient-link acceptance context and repeated workflow/admin row action names.

## 20260620-0203 JST - Pharmacy Cooperation Workflow Row Action Names

### Summary

- Added target-specific accessible names for pharmacy-cooperation workflow row actions across patient share cases, visit requests, and partner visit records.
- Included non-PHI record IDs plus partner pharmacy context in action names, while excluding patient names, dates of birth, addresses, request reasons, clinical notes, and medication content.
- Updated focused workflow tests to use row-scoped exact accessible names instead of generic button text or broad regexes.
- Updated the route-mocked workflow smoke to drive the new target-specific accessible names for visit-request and partner-record actions.
- Added a regression assertion for the share-case correction target action name.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `tools/tests/ui-route-mocked-smoke.spec.ts`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' tools/tests/ui-route-mocked-smoke.spec.ts`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 12 tests.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' tools/tests/ui-route-mocked-smoke.spec.ts`: passed.
- `nc -z localhost 3012`: passed.
- `nc -z localhost 5433`: passed.
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project chromium --grep "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test in 6.4s.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- Focused `rg` scan for row-action `aria-label` coverage: confirmed patient-share-case, visit-request, and partner-visit-record row actions now include record ID plus partner pharmacy context.
- Verifier subagent reran focused ESLint and Vitest, confirmed the labels are target-specific, and confirmed PHI was not added to accessible names.

### Remaining / Next Loop

- Pharmacy-cooperation workflow row action naming is addressed for the inspected tables. UI/UX remediation remains active for any remaining patient-link acceptance context, responsive table density, broader select/input label scans, and browser/a11y proof expansion outside this focused slice.

## 20260620-0207 JST - Admin Pharmacy Cooperation Activation Action Name

### Summary

- Added a target-specific accessible name to the repeated partnership `有効化` action in the admin pharmacy-cooperation setup table.
- Included non-PHI partnership ID plus partner pharmacy context, while excluding patient names, addresses, clinical details, contract body text, filenames, signed URLs, and storage keys.
- Updated the setup regression test to click the exact row-scoped action name.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed, unchanged.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Admin pharmacy-cooperation partnership activation naming is addressed. Raw setup tables still remain and should be converted or browser/a11y-proved in a separate DataTable/responsive-density slice if prioritized.

## 20260620-0208 JST - Pharmacy Workflow Confirmation Full IDs

### Summary

- Removed workflow confirmation ID shortening for patient share cases, visit requests, and partner visit records.
- Kept confirmation details PHI-minimized while showing exact non-PHI object IDs for high-risk action review.
- Added focused regression assertions that each workflow confirmation dialog shows the full target ID and key non-PHI context before the API call is confirmed.

### Files Changed

- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx`
- `src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed, unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx' 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 12 tests.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- Exact `rg` check for `workflowShortId`: no remaining references.
- `DATABASE_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public DIRECT_URL=postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 pnpm exec playwright test --config playwright.local.config.ts tools/tests/ui-route-mocked-smoke.spec.ts --project=chromium --grep "pharmacy cooperation route-mocked browser workflow smoke"`: passed, 1 Chromium test in 7.3s.

### Remaining / Next Loop

- Pharmacy-cooperation confirmation details now show exact target IDs for inspected workflow actions. UI/UX remediation remains active for raw setup tables, responsive table density, and broader browser/a11y coverage outside this focused slice.

## 20260620-0214 JST - Admin Pharmacy Cooperation DataTables

### Summary

- Replaced the admin pharmacy-cooperation setup raw tables for partnerships, contract documents, and contracts with the shared `DataTable`.
- Added table search, column visibility, row a11y labels, and mobile-card behavior without enabling CSV/print export surfaces.
- Preserved the partnership activation inputs/action and existing contract document preview/save flows.
- Updated regression tests away from raw-table `min-w-*` assertions and toward DataTable search/column controls.

### Files Changed

- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx`
- `src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed.
- `pnpm exec eslint 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx' 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 5 tests.
- `if rg -n '<table|overflow-x-auto|min-w-\\[' 'src/app/(dashboard)/admin/pharmacy-cooperation' -g '*.tsx'; then exit 1; else echo 'no raw admin pharmacy-cooperation tables'; fi`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.
- Route-mocked browser test inventory scan found no existing admin setup browser smoke, so browser proof was not run for this admin route.
- Verifier subagent reran focused ESLint, Vitest, and raw-table scan; it found no regressions and no PHI added to labels/search.

### Remaining / Next Loop

- Admin setup raw-table convergence is addressed for the inspected page. Broader browser/a11y coverage for the admin setup route remains a follow-up candidate.

## 20260620-0218 JST - Report Delivery Analytics DataTables

### Summary

- Replaced the report delivery dashboard's monthly, physician, and channel analytics raw tables with the shared `DataTable`.
- Added table search, column visibility, row a11y labels, and mobile-card behavior for aggregate analytics.
- Left patient-level overdue follow-up cards unchanged.

### Files Changed

- `src/app/(dashboard)/reports/report-delivery-dashboard.tsx`
- `src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/reports/report-delivery-dashboard.tsx' 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx'`: passed, unchanged.
- `pnpm exec eslint 'src/app/(dashboard)/reports/report-delivery-dashboard.tsx' 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/reports/report-delivery-dashboard.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `if rg -n '<table|overflow-x-auto|min-w-' 'src/app/(dashboard)/reports/report-delivery-dashboard.tsx'; then exit 1; else echo 'no raw report delivery analytics tables'; fi`: passed.
- `pnpm typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- Report delivery aggregate table convergence is addressed for the inspected dashboard. Browser/mobile proof for this report section remains a possible follow-up if this route enters the browser/a11y proof queue.

## 20260620-0036 JST - Billing Rule Row Action Names

### Summary

- Changed billing-rule edit/delete icon buttons from generic names to target-specific accessible names.
- Added a regression test proving the named delete action opens confirmation and does not call the delete mutation until confirmed.

### Files Changed

- `src/app/(dashboard)/admin/billing-rules/page.tsx`
- `src/app/(dashboard)/admin/billing-rules/page.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/billing-rules/page.tsx' 'src/app/(dashboard)/admin/billing-rules/page.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/billing-rules/page.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/admin/billing-rules/page.tsx' 'src/app/(dashboard)/admin/billing-rules/page.test.tsx'`: passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/billing-rules/page.tsx' 'src/app/(dashboard)/admin/billing-rules/page.test.tsx'`: passed.
- `pnpm typecheck`: initially failed on the mocked DataTable cell return type, then passed after typing it as `ReactNode`.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0033 JST - Business Holiday Label Associations

### Summary

- Added an accessible label to the business-holiday calendar site filter.
- Extended the local `Field` helper to wire visible labels to inputs and Select triggers.
- Associated bulk holiday name/type/site controls with labels.
- Associated add/edit holiday date/name/type/site controls with labels.
- Added a regression assertion that the site filter is reachable by label.

### Files Changed

- `src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx`
- `src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx' 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 1 test.
- `pnpm exec eslint 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx' 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx'`: passed.
- `pnpm exec prettier --check 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx' 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx'`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0031 JST - Contact Profile Label Associations

### Summary

- Associated the contact-profile kind filter Select with its visible `種別` label.
- Associated the contact-profile search input with its visible `検索` label.
- Associated the delivery-method Select with its visible `送付方法` label.
- Added regression assertions that the controls are reachable by their visible labels.

### Files Changed

- `src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.tsx`
- `src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.tsx' 'src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.test.tsx' --reporter=dot --testTimeout=30000`: passed, 1 file / 2 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.tsx' 'src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.test.tsx'`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.

## 20260620-0029 JST - Business Holiday Delete Confirmation

### Summary

- Replaced the dedicated business-holiday delete dialog with the shared `ConfirmDialog`.
- Added target-specific delete action naming and confirmation copy with date, site, holiday type, and open/closed state.
- Added a regression test proving the DELETE request is not sent until the confirmation action is clicked.

### Files Changed

- `src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx`
- `src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx`
- `CODEX_GOAL_PROGRESS.md`
- `.codex/ralph-state.md`

### Validation

- `pnpm exec prettier --write 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx' 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx'`: passed.
- `pnpm exec vitest run 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx' src/components/ui/confirm-dialog.test.tsx --reporter=dot --testTimeout=30000`: passed, 2 files / 5 tests.
- `pnpm exec eslint 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx' 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx' src/components/ui/confirm-dialog.tsx src/components/ui/confirm-dialog.test.tsx`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

### Remaining / Next Loop

- UI/UX remediation remains active. Remaining candidates include pharmacy-cooperation responsive table density, select accessible-name gaps outside fixed/verified screens, raw table/DataTable convergence, and expanded browser/a11y proof.
