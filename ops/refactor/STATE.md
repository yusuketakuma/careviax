# Refactor State

Snapshot: 2026-07-02 11:52 JST

## Phase

- Current phase: Codex execution with Codex subagent review plus continued
  behavior-preserving refactor loop.
- Current theme: frontend medical-safety false-empty / false-safe fixes, with
  Codex also allowed to autonomously identify and implement additional verified
  candidates.
- Status: active. The broad repo-wide objective is not complete.

## Last Change ID

- `RR-FE-20260702-F14-F27-cockpit-rail-false-safe`

## Build State

- Last full production build evidence:
  `pnpm build` passed after the cockpit rail false-safe loading/error fix.
- Last full cheap gate bundle evidence:
  - `pnpm typecheck`: passed after the cockpit rail false-safe loading/error
    fix.
  - `pnpm typecheck:no-unused`: passed after the cockpit rail false-safe
    loading/error fix.
  - `pnpm lint`: passed after the cockpit rail false-safe loading/error fix.
  - `pnpm format:check`: passed after the cockpit rail false-safe loading/error
    fix.
  - Scoped Prettier and diff-check passed for the handoff/schedule components
    and tests before this state update; final ledger formatting/diff checks are
    pending until this state update lands.

## Current Worktree

- The worktree is intentionally dirty from verified small slices. Preserve all
  existing dirty files unless explicitly owning a new slice.
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
