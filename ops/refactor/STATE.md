# Refactor State

Snapshot: 2026-07-02 16:34 JST

## Phase

- Current phase: Codex execution with Codex subagent review plus continued
  behavior-preserving refactor loop.
- Current theme: frontend medical-safety false-empty / false-safe fixes, with
  Codex also allowed to autonomously identify and implement additional verified
  candidates.
- Status: active. The broad repo-wide objective is not complete.

## Last Change ID

- `RR-OFFLINE-EPIC-CE14-N25-sync-queue-evidence-retry`

## Build State

- Last full production build evidence:
  `pnpm build` passed after the offline lifecycle CE14/N25 sync queue and
  evidence retry slice.
- Last full cheap gate bundle evidence:
  - Focused offline/evidence/sync bundle passed `5` files / `65` tests.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: failed only on unrelated existing dirty
    `.agent-loop/FEATURE_QUEUE.md`; touched files passed scoped Prettier.
  - `pnpm build`: passed.

## Current Worktree

- The worktree is intentionally dirty from verified small slices. Preserve all
  existing dirty files unless explicitly owning a new slice.
- Latest offline lifecycle slice changed:
  `src/lib/stores/offline-db.ts`, `src/lib/stores/sync-engine.ts`,
  `src/lib/stores/sync-engine.test.ts`,
  `src/lib/offline/evidence-drafts.ts`,
  `src/lib/offline/evidence-drafts.test.ts`,
  `src/app/(dashboard)/visits/evidence/evidence-gallery-content.tsx`,
  `src/app/(dashboard)/visits/evidence/evidence-gallery-content.test.tsx`,
  `src/app/(dashboard)/visits/[id]/capture/capture-content.tsx`,
  `src/app/(dashboard)/visits/[id]/capture/capture-content.test.tsx`,
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`, and
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`. It
  dedupes `visit_record` sync queue rows by schedule while preserving
  `server_conflict`, keeps residual medication append-only, org-scopes evidence
  draft list/sync/reset, fails closed on org-missing capture, adds gallery
  retry reset/two-drain/server-refetch behavior, and keeps sync error
  persistence generic. Focused tests, typecheck, no-unused, lint, and build
  passed; full format check is blocked only by unrelated
  `.agent-loop/FEATURE_QUEUE.md`. gbrain memory:
  `projects/careviax/decisions/2026-07-02/offline-lifecycle-sync-queue-evidence-retry`.
- Latest backend/API validation slice changed:
  `src/app/api/community-activities/route.ts`,
  `src/app/api/community-activities/route.test.ts`,
  `src/server/jobs/drug-master.ts`, `tools/date-slice-allowlist.json`,
  `src/app/api/__tests__/workflow-full-cycle.test.ts`,
  `src/app/api/__tests__/workflow-prescription-to-report.test.ts`,
  `src/app/(dashboard)/prescriptions/new/prescription-intake-form.contract.test.ts`,
  `src/app/api/facilities/route.test.ts`, and external-professional route
  tests under `src/app/api/external-professionals/[id]/`. It validates
  community activity `from`/`to` date keys, rejects reversed ranges, applies JST
  day boundaries, replaces drug-master direct ISO date slicing with
  `formatUtcDateKey(now)`, removes the stale date-slice allowlist entry, and
  aligns full-suite API/workflow fixtures with current route contracts. Full
  tests and all static/build gates passed.
- Latest backend medication-identity slice changed only
  `src/server/services/prescription-intake-service.ts` and
  `src/server/services/prescription-intake-service.test.ts`. It prevents
  unresolved incoming prescription codes from producing a dead profile-sync
  `code:` key that discontinues and recreates same-name unresolved medication
  profiles. Resolved DrugMaster lines remain code/master-first and do not match
  by name. The focused service/API regressions, full type/lint/build gates, and
  Codex test/medical-safety reviews passed; full `format:check` is blocked only
  by unrelated existing PCA Pumps formatting.
- Latest visit-record frontend medical-safety slice changed only:
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx` and
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`. It
  prevents schedule fetch failure or missing schedule data from rendering the
  editable visit record form, save action, medication-management section, CDS
  false no-alert state, or carry-item acknowledgement. Visit-preparation fetch
  now waits for `schedule.id`, and loaded-schedule/CDS failure remains visible
  via `isUnavailable`. Codex frontend, medical-safety, test-architect, and
  strict reviewers checked the slice; focused and broad local gates passed.
- Latest patient-share frontend safety slice changed only the patient card
  workspace management-plan selector:
  `src/app/(dashboard)/patients/[id]/card-workspace.tsx` and
  `src/app/(dashboard)/patients/[id]/card-workspace.test.tsx`. It prevents
  management-plan lookup failures from rendering as `承認済み計画なし`, adds a
  retryable alert, keeps true-empty distinct, suppresses stale retained plan
  options on refetch error, and prevents stale selected plan IDs/versions from
  entering the share-case payload. Codex frontend/test/strict reviewers checked
  the slice; focused and broad local gates passed except unrelated
  `ops/refactor/*.mjs` format warnings.
- Incidental current-worktree note: `src/components/ui/data-table.test.tsx`
  already had a dirty CSV export regression. Full typecheck exposed a typed
  `URL.createObjectURL` mock issue in that dirty test; the mock typing was
  corrected locally and the test passes. Do not mix this file into the
  patient-share commit unless explicitly owning that separate test slice.
- Latest frontend/API-contract compatibility slice changed only the schedule
  create/edit drawer:
  `src/app/(dashboard)/schedules/schedule-create-edit-drawer.tsx` and
  `src/app/(dashboard)/schedules/schedule-create-edit-drawer.test.ts`. It reads
  failed save standard `message` before legacy `error`, falls back safely for
  malformed/missing envelope fields, and does not display response `details`.
  Codex subagents reviewed the slice, focused/local gates passed, and full
  format check is blocked only by unrelated untracked
  `ops/refactor/ultracode-crossreview-codex-workflow.mjs`.
- Latest frontend medical-safety slice changed only the handoff and schedule
  cockpit-derived UI state:
  `src/app/(dashboard)/handoff/handoff-workspace.tsx`,
  `src/app/(dashboard)/handoff/handoff-workspace.test.tsx`,
  `src/app/(dashboard)/schedules/schedule-team-board.tsx`, and
  `src/app/(dashboard)/schedules/schedule-team-board.test.tsx`.
  It prevents cockpit loading/error states from rendering healthy right-rail
  empty labels, stale narcotic-risk actions, or silent blocked-reason /
  clerical-follow-up absence. Codex subagents reviewed the slice and full local
  gates passed.
- Latest approved frontend safety slice changed only the patient medications
  allergy section:
  `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx` and
  `src/app/(dashboard)/patients/[id]/medications/medications-content.test.tsx`.
  It surfaces patient summary allergy fetch failure as inline `ErrorState`
  instead of false-empty `登録なし`; Claude returned `APPROVED`.
- New latest approved frontend safety slice changed only the patient
  safety-check pinned banner:
  `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.tsx` and
  `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.test.tsx`.
  It surfaces patient summary fetch failure as inline `ErrorState` instead of
  silently dropping allergy/high-risk banner visibility; Claude returned
  `APPROVED`.
- Latest frontend medical-safety slice changed only the drug-master/formulary
  admin surface:
  `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx` and
  `src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx`.
  It surfaces formulary operation/detail subquery fetch failures with retryable
  error states, disables review completion on review-due query error even with
  stale rows, prevents stock-config fetch failure from rendering unregistered
  adoption actions, and makes CSV preview candidate YJ clipboard copy
  fail-closed with fixed non-raw error text. Codex subagents reviewed the slice
  and full local gates passed.
- Recent dirty implementation slices are logger convergence changes for:
  dashboard monthly stats, dispense verify-barcode, drug masters,
  drug-master imports, first-visit documents, inquiry records,
  medication issues, medication profiles, patient self reports,
  residual medications, consent records, communication request responses,
  comments, billing-evidence analytics/stats/check, staff-workload, and
  tracing-reports collection/detail, CDS check, medication-cycle history, and
  pharmacy stock usage-mismatch/bulk, and set-batches detail.
  The set-batches collection, set-plans collection/detail/generate-batches,
  set-audits, dispense-audits, dispense-results, care-reports,
  visit-billing-candidates summary, visit-records, and patient prescription
  routes are also converged. Dashboard workflow, cockpit, and
  medication-deadlines routes are now converged too.
- Current artifact-sync work added `ops/refactor/*` state files and the latest
  runtime slices added `src/lib/api/search-params.ts`, moved dashboard
  medication-deadlines exact integer / single query-param parsing onto it, and
  extended it for `/api/interventions`, `/api/medication-issues`,
  `/api/residual-medications`, `/api/first-visit-documents`, and
  `/api/medication-cycles`, and `/api/dispense-tasks` strict optional filters
  without changing validation messages or response shape.
- Latest bug-fix slice changed only Redis realtime adapter subscription state:
  `src/server/adapters/realtime/redis-adapter.ts` and
  `src/server/adapters/realtime/redis-adapter.test.ts`.
- New latest bug-fix slice changed only medication-history bulk-export
  background drain observability:
  `src/app/api/patients/medications/bulk-export/route.ts` and
  `src/app/api/patients/medications/bulk-export/route.test.ts`.
- New latest bug-fix slice changed only notification realtime broadcast
  observability:
  `src/server/services/notifications.ts` and
  `src/server/services/notifications.test.ts`.
- New latest bug-fix slice changed only voice memo manual transcript local-save
  failure handling:
  `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.tsx` and
  `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.test.tsx`.
- New latest bug-fix slice changed only presence realtime broadcast failure
  observability:
  `src/app/api/presence/route.ts` and
  `src/app/api/presence/route.test.ts`.
- New latest bug-fix slice changed only external-access fallback-audit rollback
  failure observability:
  `src/app/api/external-access/route.ts` and
  `src/app/api/external-access/route.test.ts`.
- New latest bug-fix slice changed only patient MCS sync failure handling:
  `src/server/services/patient-mcs.ts` and
  `src/server/services/patient-mcs.test.ts`.
- New latest bug-fix slice changed only visit schedule proposal detail
  pharmacist enrichment failure observability:
  `src/app/api/visit-schedule-proposals/[id]/route.ts` and
  `src/app/api/visit-schedule-proposals/[id]/route.test.ts`.
- New latest bug-fix slice changed only presence heartbeat client failure
  observability:
  `src/lib/collaboration/presence-api-client.ts` and
  `src/lib/hooks/use-presence-heartbeat.test.ts`.
- New latest bug-fix slice changed only collaboration room-token client
  transient failure observability:
  `src/lib/collaboration/room-token-client.ts` and
  `src/lib/collaboration/room-token-client.test.ts`.
- New latest bug-fix slice changed only PH-OS fee-rules Aurora rollback
  failure observability:
  `src/phos/backend/aurora-fee-rules-repository.ts` and
  `src/phos/backend/aurora-fee-rules-repository.test.ts`.
- New latest bug-fix slice changed only external drug-master import stream
  cancel cleanup observability:
  `src/server/services/drug-master-import/shared.ts` and
  `src/server/services/drug-master-import/shared.test.ts`.
- New latest bug-fix slice changed only backup-monitor RDS configured import
  failure semantics:
  `src/server/services/backup-monitor.ts` and
  `src/server/services/backup-monitor.test.ts`.
- New latest bug-fix slice changed only health route backup monitor raw error
  response handling:
  `src/app/api/health/route.ts` and `src/app/api/health/route.test.ts`.
- New latest bug-fix slice changed only backup monitor AWS check error
  result/log safety:
  `src/server/services/backup-monitor.ts` and
  `src/server/services/backup-monitor.test.ts`.
- New latest bug-fix slice changed only generic health-check DB/S3 failure
  result safety:
  `src/server/services/health-check.ts` and
  `src/server/services/health-check.test.ts`.
- New latest bug-fix slice changed only outbound webhook returned delivery URL
  and dispatch failure result safety:
  `src/server/services/outbound-webhook.ts` and
  `src/server/services/outbound-webhook.test.ts`.
- New latest bug-fix slice changed only job runner failure diagnostics
  persistence, admin notification, and cleanup logging safety:
  `src/server/jobs/runner.ts` and `src/server/jobs/runner.test.ts`.
- New latest bug-fix slice changed only CloudWatch metrics helper failure
  logging:
  `src/lib/aws/cloudwatch.ts` and `src/lib/aws/cloudwatch.test.ts`.
- New latest bug-fix slice changed only shared realtime stream listener
  failure diagnostics:
  `src/lib/realtime/shared-event-stream.ts` and
  `src/lib/realtime/shared-event-stream.test.ts`.
- New latest bug-fix slice changed only offline sync queue unexpected-failure
  diagnostics:
  `src/lib/stores/sync-engine.ts` and `src/lib/stores/sync-engine.test.ts`.
- New latest bug-fix slice changed only visit schedule planner evaluation-error
  diagnostics:
  `src/server/services/visit-schedule-planner.ts` and
  `src/server/services/visit-schedule-planner.test.ts`.
- New latest bug-fix slice changed only expired generated-file cleanup returned
  error diagnostics:
  `src/server/services/file-storage.ts` and
  `src/server/services/file-storage.test.ts`.
- New latest bug-fix slice changed only SSK drug-master import failed log
  diagnostics:
  `src/server/services/drug-master-import/ssk.ts` and
  `src/server/services/drug-master-import/ssk.test.ts`.
- New latest bug-fix slice changed only shared drug-master import failed log
  diagnostics:
  `src/server/services/drug-master-import/shared.ts` and
  `src/server/services/drug-master-import/shared.test.ts`.
- New latest bug-fix slice changed only medication-history PDF bulk-export
  failure diagnostics and drain response redaction:
  `src/server/services/pdf-bulk-export.ts`,
  `src/server/services/pdf-bulk-export.test.ts`,
  `src/app/api/jobs/[jobType]/route.ts`, and
  `src/app/api/jobs/[jobType]/route.test.ts`.
- New latest bug-fix slice changed only daily job returned error diagnostics:
  `src/server/jobs/daily/shared.ts`,
  `src/server/jobs/daily/orchestrator.ts`,
  `src/server/jobs/daily/visits.ts`, and
  `src/server/jobs/daily.test.ts`.
- New latest bug-fix slice changed only rate-limit DynamoDB failure logging and
  API route catalog coverage:
  `src/lib/api/rate-limit.ts` and `src/lib/api/rate-limit.test.ts`.
- New latest bug-fix slice changed only Secrets Manager fallback warning
  diagnostics:
  `src/lib/config/secrets.ts` and `src/lib/config/secrets.test.ts`.
- New latest bug-fix slice changed only PHOS Lambda observability failure
  diagnostics:
  `src/phos/backend/lambda-handler.ts`,
  `src/phos/backend/lambda-handler.test.ts`,
  `src/phos/backend/lambda-observability.ts`, and
  `src/phos/backend/lambda-observability.test.ts`.
- New latest bug-fix slice changed only PHOS S3 evidence cleanup failure
  diagnostics:
  `src/phos/backend/evidence-upload-verification.ts` and
  `src/phos/backend/evidence-upload-verification.test.ts`.
- New latest bug-fix slice changed only auth security-event audit persistence
  failure diagnostics:
  `src/lib/auth/security-events.ts` and
  `src/lib/auth/security-events.test.ts`.
- New latest bug-fix slice changed only `/api/me/profile` Cognito MFA state
  failure diagnostics:
  `src/app/api/me/profile/route.ts` and
  `src/app/api/me/profile/route.test.ts`.

## Blockers

- None for documentation/artifact sync.
- DB schema, migration, RLS, auth/authz semantics, external send semantics,
  billing semantics, and medical workflow behavior changes remain proposal-only
  unless explicitly approved.
- Browser/E2E smoke was intentionally skipped for recent server-only slices,
  the toast-only voice memo state fix, the presence route observability fix,
  the external-access rollback observability fix, and this patient MCS service
  failure-handling fix, and this visit schedule proposal detail enrichment
  observability fix, this presence heartbeat client observability fix, and this
  room-token client observability fix, and this PH-OS backend rollback
  observability fix, this drug-master import cleanup observability fix, and
  this backup-monitor RDS import failure semantics fix, and this health route
  raw backup error response fix, this backup monitor AWS check safe error fix,
  this generic health-check DB/S3 safe error fix, this outbound webhook safe
  result fix, this job runner safe failure diagnostics fix, and this
  CloudWatch safe metric failure log fix, this realtime listener safe
  diagnostics fix, this offline sync queue diagnostics privacy fix, and this
  visit schedule planner evaluation diagnostics privacy fix, and this
  file-storage safe cleanup errors fix, and this SSK import safe error log fix
  because no DOM layout, navigation, route contract shape, or workflow shape
  changed. The
  latest backend/client utility behavior is covered by focused regressions.
- Browser/E2E smoke was intentionally skipped for the shared drug-master import
  failed-log diagnostics fix because it changes no DOM layout, navigation,
  route contract shape, or workflow shape; service/API regressions cover the
  affected behavior.
- Browser/E2E smoke was intentionally skipped for the PDF bulk-export safe
  diagnostics fix because it changes no DOM layout, navigation, or human
  workflow shape. The intentional route contract change is covered by
  `/api/jobs/[jobType]` focused regression: drain responses now expose
  `errorCount` instead of raw `errors[]`.
- Browser/E2E smoke was intentionally skipped for the daily job safe error
  result fix because it changes no DOM layout, navigation, or human workflow
  shape. The affected server job result behavior is covered by focused
  red-then-green daily job regressions.
- Browser/E2E smoke was intentionally skipped for the rate-limit safe failure
  log and route catalog sync fix because it changes no DOM layout,
  navigation, or human workflow shape. Proxy/rate-limit behavior is covered by
  the rate-limit unit/regression suite and production build.
- Browser/E2E smoke was intentionally skipped for the Secrets Manager fallback
  safe-log fix because it changes no DOM layout, navigation, route contract
  shape, or human workflow shape. The affected startup/runtime fallback
  behavior is covered by focused config regressions and production build.
- Browser/E2E smoke was intentionally skipped for the PHOS Lambda safe
  observability-log fix because it changes no DOM layout, navigation, route
  contract shape, or human workflow shape. The affected Lambda observability
  behavior is covered by focused PHOS backend regressions and production build.
- Browser/E2E smoke was intentionally skipped for the PHOS evidence cleanup
  safe-principal-log fix because it changes no DOM layout, navigation, route
  contract shape, or human workflow shape. The affected cleanup failure logging
  behavior is covered by focused PHOS backend regressions and production build.
- Browser/E2E smoke was intentionally skipped for the auth security-event
  safe-failure-log fix because it changes no DOM layout, navigation, route
  contract shape, or human workflow shape. The affected fire-and-forget audit
  fallback logging behavior is covered by focused auth/logger/RLS regressions
  and production build.
- Browser/E2E smoke was intentionally skipped for the `/api/me/profile` MFA
  state safe-failure-log fix because it changes no DOM layout, navigation,
  route contract shape, or human workflow shape. The affected optional MFA
  enrichment fallback behavior is covered by focused route/logger regressions
  and production build.
- Browser/E2E smoke was intentionally skipped for
  `RR-FE-20260702-A-allergy-false-negative` because the change is a targeted
  inline error-state branch covered by jsdom assertions and production build.
- Browser/E2E smoke was intentionally skipped for
  `RR-FE-20260702-B-safety-banner-silent-loss` because the change is a targeted
  inline error-state branch covered by jsdom assertions and production build.

## Next Action

1. Start `RR-FE-20260702-C-drug-master-formulary-error-states` after committing
   and notifying Slice B.
2. Continue Codex-owned autonomous bug-hunt / duplicate-helper / query
   inefficiency inventory with focused evidence when the Claude-prioritized
   queue is not blocking immediate execution.
3. Keep DB schema, auth/RLS semantics, external sends, migrations, and
   destructive operations proposal-only unless explicitly approved.

## Acceptance Reminder

The full objective remains open until code map, findings, plan, log,
verification evidence, remaining issues, and at least two zero-actionable
re-audits are complete.

## Latest Slice - 2026-07-02 12:36 JST

- Change ID: `RR-PERF-20260702-F04-offline-base64-chunking`.
- Status: implemented and validated, pending commit at time of ledger update.
- Files changed:
  - `src/lib/utils/base64.ts`
  - `src/lib/utils/base64.test.ts`
  - `src/lib/offline/crypto.ts`
  - `src/lib/offline/crypto.test.ts`
  - `src/phos/api/offlineEvidenceQueue.ts`
  - `src/phos/api/offlineEvidenceQueue.test.ts`
  - `src/phos/contracts/phos_contracts.ts`
- Summary:
  - Consolidated offline byte/base64 conversion into `src/lib/utils/base64.ts`.
  - Replaced encrypted offline payload byte-by-byte encoding with bounded
    chunked conversion.
  - Migrated PH-OS offline evidence queue encode/decode to the same helper.
  - Added local integrity checks before evidence replay presign/upload:
    decoded bytes must match `size_bytes` and SHA-256.
  - Kept unreadable encrypted evidence payloads visible and retry-tracked with
    fixed `EVIDENCE_PAYLOAD_UNREADABLE`, without presign/upload.
- Validation:
  - Focused offline/PH-OS regression bundle passed `6` files / `86` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - `pnpm format:check` failed only on unrelated existing `ops/refactor/*`
    formatting issues.
- Memory:
  - `projects/careviax/decisions/2026-07-02/offline-base64-helper-consolidation`
  - `projects/careviax/failures/2026-07-02/offline-evidence-unreadable-payload-hidden`

## Latest Slice - 2026-07-02 13:33 JST

- Change ID: `RR-FE-20260702-F02-data-table-source-row-index`.
- Status: implemented, validated, and committed as `574a91fb`.
- Files changed:
  - `src/components/ui/data-table.tsx`
  - `src/components/ui/data-table.test.tsx`
- Summary:
  - Desktop DataTable now uses source `row.index` for selected-row highlight,
    click activation, and Enter/Space activation after sorting/filtering.
  - Rendered-row zebra striping still uses the rendered map index.
  - Added sorted and filtered desktop regressions for click, keyboard, and
    highlight behavior.
  - Validated client CSV export safe-csv alignment for formula-prefix cells.
- Validation:
  - Focused DataTable suite passed `1` file / `7` tests.
  - Final DataTable + safe-csv bundle passed `2` files / `17` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Frontend reviewer and test architect reported no blockers.
- Memory:
  - `projects/careviax/failures/2026-07-02/data-table-sorted-filtered-row-index`

## Latest Slice - 2026-07-02 13:47 JST

- Change ID: `RR-BUG-20260702-F01-patient-status-window-query-order`.
- Status: implemented, validated, and committed as `a5a9c84f`.
- Files changed:
  - `src/server/services/patient-status-tracker.ts`
  - `src/server/services/patient-status-tracker.test.ts`
- Summary:
  - The patient-status tracker raw SQL now orders the outer ranked audit-log
    query by projected `rn`, not non-projected `created_at`.
  - The inner window still orders by `created_at DESC`, preserving newest-first
    status history per patient.
  - Added regression coverage for `AS rn`, `rn <= 5`, the fixed outer order, and
    the absence of the old missing-column order.
- Validation:
  - Focused patient-status tracker suite passed `1` file / `7` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - DB steward and test architect reported no blockers.
- Memory:
  - `projects/careviax/failures/2026-07-02/patient-status-window-query-outer-order-created-at`

## Latest Slice - 2026-07-02 14:02 JST

- Change ID:
  `RR-BUG-20260702-F06-admin-capacity-jst-completed-today`.
- Status: implemented, validated, and committed as `38897c81`.
- Files changed:
  - `src/app/api/admin/capacity/route.ts`
  - `src/app/api/admin/capacity/route.test.ts`
- Summary:
  - `/api/admin/capacity` now counts completed dispense tasks for today with
    `japanDayInstantRange(now)` against the DateTime `updated_at` column.
  - `VisitSchedule.scheduled_date` and `PharmacistShift.date` remain on
    `todayUtcRange(now)` because they are `@db.Date` sentinel comparisons.
  - Added a JST midnight boundary regression covering the DateTime range and
    the separate `@db.Date` ranges.
  - Repaired the route test's `@db.Time` fixtures to use explicit UTC sentinel
    values.
- Validation:
  - Focused capacity route suite passed `1` file / `2` tests.
  - Capacity + date-boundary suite passed `2` files / `24` tests.
  - Final capacity + date-boundary + sibling dispensing-stats bundle passed
    `3` files / `28` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - DB steward and test architect reported no blockers.
- Memory:
  - `projects/careviax/failures/2026-07-02/admin-capacity-completed-today-server-local-midnight`

## Latest Slice - 2026-07-02 14:17 JST

- Change ID:
  `RR-BUG-20260702-F07-shift-template-apply-utc-date`.
- Status: implemented, validated, and committed as `ba3b9689`.
- Files changed:
  - `src/app/api/pharmacist-shift-templates/apply/route.ts`
  - `src/app/api/pharmacist-shift-templates/apply/route.test.ts`
  - `package.json`
- Summary:
  - Shift template apply now generates target `PharmacistShift.date` values via
    UTC month/day iteration, preserving `@db.Date` UTC-midnight sentinels under
    JST runtime.
  - Template reads now run inside the same RLS-scoped transaction as shift
    writes, with explicit request auth context.
  - The apply route regression is now included in `test:schedule-time:tz`.
- Validation:
  - Focused apply route suite passed `1` file / `3` tests.
  - Related shift/date-boundary bundle passed `4` files / `49` tests.
  - Targeted TZ bundles passed in Asia/Tokyo, UTC, and America/Los_Angeles.
  - `TZ=Asia/Tokyo pnpm test:schedule-time:tz` passed `31` files / `555` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - DB steward and test architect reported no blockers.
- Memory:
  - `projects/careviax/failures/2026-07-02/pharmacist-shift-template-apply-local-date`

## Latest Slice - 2026-07-02 14:31 JST

- Change ID:
  `RR-BUG-20260702-F09-medication-profile-unresolved-code-name-fallback`.
- Status: implemented, validated, and committed as `0a070fbc`.
- Files changed:
  - `src/server/services/prescription-intake-service.ts`
  - `src/server/services/prescription-intake-service.test.ts`
- Summary:
  - Incoming prescription lines with a normalized code that does not resolve in
    DrugMaster now add a `name:` fallback key for matching existing unresolved
    medication profiles.
  - Resolved DrugMaster identities still use `master:` and `legacy-code:` keys
    without name fallback.
  - Source-code-only DrugMaster lookup predicates are now flat ORs; combined
    source-code plus explicit-master-id lookups retain grouped OR semantics.
  - Added regression coverage for no duplicate create, one tenant-scoped update,
    no fake `drug_master_id`, and stable sync counters.
- Validation:
  - Focused F09 regression passed `1` file / `1` selected test.
  - Focused prescription-intake route backstop passed `1` file / `1` selected
    test.
  - Full prescription-intake service suite passed `1` file / `35` tests.
  - Related prescription-intake/CDS API bundle passed `4` files / `119` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - `pnpm format:check` failed only on unrelated existing dirty
    `src/app/(dashboard)/admin/pca-pumps/pca-pumps-content.tsx`; scoped
    Prettier passed for touched files.
  - Codex test architect and medical-safety reviewer reported no blockers.
- Memory:
  - `projects/careviax/failures/2026-07-02/medication-profile-unresolved-code-dead-key`

## Latest Slice - 2026-07-02 15:46 JST

- Change ID:
  `RR-BUG-20260702-F16-F17-F29-F39-F51-my-day-task-triage`.
- Status: implemented and validated; commit pending.
- Files changed:
  - `src/app/(dashboard)/my-day/my-day-content.tsx`
  - `src/app/(dashboard)/my-day/my-day-content.test.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.test.tsx`
- Summary:
  - Added `status=open` to My Day task cursor pagination.
  - Moved My Day status-change audit date basis to `japanDateKey()` and encoded
    JST midnight.
  - Gated admin-only status-change data at query key, fetch, data derivation,
    and render branches.
  - Removed stale patient-name dependency from audit-log changes and routed
    patient links through `buildPatientHref()`.
  - Counted urgent plus high priorities in the Tasks immediate summary.
- Validation:
  - Focused My Day + Tasks suite passed `2` files / `23` tests.
  - Related task/audit route tests passed `2` files / `57` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `pnpm build`, and full test suite passed.
  - Full suite: `1266` files passed / `1` skipped; `12592` tests passed / `2`
    skipped.
  - Implementation planner, API contract reviewer re-review,
    privacy-compliance reviewer, and test architect reported no remaining
    blockers.
- Memory:
  - `projects/careviax/failures/2026-07-02/my-day-task-triage-admin-status-cache`
