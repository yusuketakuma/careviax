# REFACTOR_EXECUTION_PLAN.md

Snapshot: 2026-07-01 JST

This plan turns the broad refactor objective into small, behavior-preserving
work units. It keeps the full objective open while preventing unsafe bulk
rewrites.

## Scope

- Repository: current `careviax` checkout / `ph-os` package.
- Refactor mode: behavior-preserving.
- Explicitly out of normal implementation scope:
  - DB schema and migrations
  - RLS policies
  - auth/authz behavior
  - tenant selection behavior
  - audit semantics
  - external sends
  - billing semantics
  - medication identity semantics
  - patient medical data behavior changes
  - old UI removal
  - response envelope migration
  - production config/secrets
  - dependency upgrades

If any of those are needed, create a proposal first. Do not implement silently.

## Current Evidence

- Worktree was clean at Phase 0 restart.
- `refactor-instructions.md` remains an important behavior-preserving refactor
  handoff document, but the three required Phase 0 `REFACTOR_*` files were not
  present before this slice.
- `.agent-loop/GATE_CONFIG.md` defines cheap gates:
  - lint
  - format check
  - typecheck
  - no-unused typecheck
  - targeted Vitest
- Heavy gates:
  - full unit suite
  - build
  - E2E / audit E2E
- Recent validated progress includes:
  - document-delivery-rule helper/no-store hardening
  - unused admin `MasterEditorView` stub removal
  - `/admin/metrics` placeholder zero removal
  - nav badge API path/header helper convergence
  - `/api/nav-badges` no-store response boundary hardening
  - report generation API path helper convergence
  - admin notification settings path/header helper convergence
  - `/api/notification-rules` no-store response boundary hardening
  - patient/report share communication-request and task path helper convergence
  - report-share dot-segment patient-id fail-closed rendering
  - `POST /api/tasks` no-store response boundary hardening
  - document-delivery-rule RLS request-context binding and protected matrix
    coverage
  - safe structured logger runtime allowlist and PHI/secret redaction contract
    tests
  - visit-vehicle-resource route-local logger sanitizers converged on the
    shared safe structured logger overload
  - pharmacist route-local logger sanitizers converged on the shared safe
    structured logger overload, with POST duplicate-lookup failure coverage
  - pharmacist-shift route-local logger sanitizers converged on the shared safe
    structured logger overload, with POST upsert failure coverage
  - pharmacist-shifts bulk POST added to the shared protected POST
    auth/body/no-store matrix
  - notification route-local logger sanitizer converged on the shared safe
    structured logger overload, with GET/PATCH sanitized failure coverage
  - dispense-queue route-local logger sanitizer converged on the shared safe
    structured logger overload, with sanitized queue lookup failure coverage
  - drug-master-import-log route-local logger sanitizer converged on the
    shared safe structured logger overload, with sanitized lookup failure and
    controlled-validation coverage
  - drug-master-import-status route-local logger sanitizer converged on the
    shared safe structured logger overload, with sanitized status lookup
    failure coverage
  - dashboard dispensing-stats route-local logger sanitizer converged on the
    shared safe structured logger overload, with sanitized metric-read failure
    coverage
  - dashboard overdue route-local logger sanitizer converged on the shared safe
    structured logger overload, with sanitized overdue-read failure coverage
  - dashboard overdue unrecorded-visit cutoff switched from server-local date to
    explicit Japan business-date `@db.Date` sentinel, with UTC-runtime
    JST-midnight regression coverage

## Completed Slices

### 2026-07-01 14:58 JST: Dashboard Overdue Japan Date Boundary Fix

- Completed medical-safety correctness follow-up:
  `Dashboard Overdue Japan Date Boundary Fix`.
- Files changed:
  - `src/app/api/dashboard/overdue/route.ts`
  - `src/app/api/dashboard/overdue/route.test.ts`
- Validation:
  - focused date-boundary + dashboard overdue route suite passed `2` files /
    `27` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Other routes and jobs that still use server-local `localDateKey()` for
    Japan business-day semantics remain separate candidates; do not bulk-change
    them without route-specific tests.
  - Continue with small, validated backend/API safety or logger convergence
    slices.

### 2026-07-01 14:45 JST: Dashboard Overdue Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dashboard Overdue Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dashboard/overdue/route.ts`
  - `src/app/api/dashboard/overdue/route.test.ts`
- Validation:
  - focused logger + dashboard overdue route suite passed `2` files / `12`
    tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Medical safety review found a pre-existing P2 residual: overdue visit date
    boundary still depends on server-local `localDateKey()` rather than an
    explicit Japan business-day key. This was not introduced by the
    logging-only slice and should be handled as a separate safety slice or
    runtime-contract proposal.
  - Continue with small, tested route-local logger convergence candidates.

### 2026-07-01 14:34 JST: Dashboard Dispensing Stats Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dashboard Dispensing Stats Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dashboard/dispensing-stats/route.ts`
  - `src/app/api/dashboard/dispensing-stats/route.test.ts`
- Validation:
  - focused logger + dashboard dispensing-stats route suite passed `2` files /
    `11` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - External observability backend retention/redaction policy remains outside
    this code-diff scope.
  - Continue with small, tested route-local logger convergence candidates.

### 2026-07-01 14:21 JST: Drug Master Import Status Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Drug Master Import Status Structured Logger Convergence`.
- Files changed:
  - `src/app/api/drug-master-imports/status/route.ts`
  - `src/app/api/drug-master-imports/status/route.test.ts`
- Validation:
  - focused logger + drug-master-import-status route suite passed `2` files /
    `20` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Browser-visible `last_failure.error` minimization and import writer/storage
    minimization for persisted `error_log` / `source_url` remain separate
    proposal/follow-up candidates, not part of this behavior-preserving logger
    slice.
  - Continue with small, tested route-local logger convergence candidates.

### 2026-07-01 14:09 JST: Drug Master Import Log Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Drug Master Import Log Structured Logger Convergence`.
- Files changed:
  - `src/app/api/drug-master-import-logs/route.ts`
  - `src/app/api/drug-master-import-logs/route.test.ts`
- Validation:
  - focused logger + drug-master-import-log route suite passed `2` files / `20`
    tests
  - scoped Prettier check passed after retrying a mistyped local `pnm` command
    as `pnpm`
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Import writer/storage minimization for persisted `source_url` / `error_log`
    remains a separate proposal/follow-up, not part of this
    behavior-preserving logger slice.
  - Continue with small, tested route-local logger convergence candidates.

### 2026-07-01 13:55 JST: Dispense Queue Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dispense Queue Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dispense-queue/route.ts`
  - `src/app/api/dispense-queue/route.test.ts`
- Validation:
  - focused logger + dispense-queue route suite passed `2` files / `9` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Continue with small, tested route-local logger convergence candidates.

### 2026-07-01 13:47 JST: Notifications Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Notifications Structured Logger Convergence`.
- Files changed:
  - `src/app/api/notifications/route.ts`
  - `src/app/api/notifications/route.test.ts`
- Validation:
  - focused logger + notifications route suite passed `2` files / `17` tests
  - scoped Prettier check passed after formatting the route file
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Continue with small, tested route-local logger convergence or route-matrix
    candidates.

### 2026-07-01 13:39 JST: Pharmacist Shift Bulk Protected POST Matrix

- Completed test-only route-matrix hardening follow-up:
  `Pharmacist Shift Bulk Protected POST Matrix`.
- Files changed:
  - `src/app/api/__tests__/protected-post-routes.test.ts`
- Validation:
  - focused protected POST + bulk route suite passed `2` files / `152` tests,
    with existing `webhook.org_dispatch_failed` stderr from the billing close
    matrix success case
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - Continue with small, tested route-local logger convergence or route-matrix
    candidates.

### 2026-07-01 13:27 JST: Pharmacist Shift Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Pharmacist Shift Structured Logger Convergence`.
- Files changed:
  - `src/app/api/pharmacist-shifts/route.ts`
  - `src/app/api/pharmacist-shifts/route.test.ts`
  - `src/app/api/pharmacist-shifts/available/route.ts`
  - `src/app/api/pharmacist-shifts/available/route.test.ts`
  - `src/app/api/pharmacist-shifts/bulk/route.ts`
  - `src/app/api/pharmacist-shifts/bulk/route.test.ts`
- Validation:
  - focused logger + pharmacist-shifts route suite passed `4` files / `45`
    tests
  - scoped Prettier check passed after formatting the three route files
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
  - production build passed
- Remaining follow-up:
  - `/api/pharmacist-shifts/bulk` protected POST matrix coverage was closed by
    the 13:39 JST test-only follow-up slice above.
  - Continue with small, tested route-local logger convergence candidates.

### 2026-07-01 13:13 JST: Pharmacists Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Pharmacists Structured Logger Convergence`.
- Files changed:
  - `src/app/api/pharmacists/route.ts`
  - `src/app/api/pharmacists/route.test.ts`
  - `src/app/api/pharmacists/[id]/route.ts`
  - `src/app/api/pharmacists/[id]/route.test.ts`
- Validation:
  - focused logger + pharmacists route suite passed `3` files / `42` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Continue with small, tested route-local logger convergence candidates.
  - Do not add staff PII/Cognito identifiers to safe log context without a
    separate privacy review.

### 2026-07-01 13:05 JST: Visit Vehicle Resource Structured Logger Convergence

- Completed observability/refactor follow-up:
  `Visit Vehicle Resource Structured Logger Convergence`.
- Files changed:
  - `src/app/api/visit-vehicle-resources/route.ts`
  - `src/app/api/visit-vehicle-resources/route.test.ts`
  - `src/app/api/visit-vehicle-resources/[id]/route.ts`
  - `src/app/api/visit-vehicle-resources/[id]/route.test.ts`
- Validation:
  - focused logger + visit-vehicle-resource route suite passed `3` files / `29`
    tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Continue with small, tested route-local logger convergence candidates where
    the route already has sanitized 500/no-store tests.

### 2026-07-01 12:56 JST: Safe Structured Logger Runtime Redaction

- Completed observability/security hardening follow-up:
  `Safe Structured Logger Runtime Redaction`.
- Files changed:
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Validation:
  - focused logger suite passed `1` file / `7` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Adding any new safe structured logger metadata key should be a deliberate
    allowlist/test update.
  - Continue with the next behavior-preserving API response-boundary or helper
    convergence candidate.

### 2026-07-01 12:48 JST: Document Delivery Rule RLS Request Context

- Completed API/RLS hardening follow-up:
  `Document Delivery Rule RLS Request Context`.
- Files changed:
  - `src/app/api/document-delivery-rules/route.ts`
  - `src/app/api/document-delivery-rules/[id]/route.ts`
  - `src/app/api/document-delivery-rules/route.test.ts`
  - `src/app/api/document-delivery-rules/[id]/route.test.ts`
  - `src/app/api/__tests__/protected-get-routes.test.ts`
  - `src/app/api/__tests__/protected-post-routes.test.ts`
  - `src/app/api/__tests__/protected-patch-delete-routes.test.ts`
- Validation:
  - focused document-delivery-rule route + protected GET/POST/PATCH/DELETE
    matrix suite passed `5` files / `618` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Document-delivery-rule response DTO minimization and real logger redaction
    contract tests remain separate privacy/observability candidates.

### 2026-07-01 12:36 JST: Task Create No-Store Boundary

- Completed API hardening follow-up: `POST /api/tasks` response privacy
  boundary.
- Files changed:
  - `src/app/api/tasks/route.ts`
  - `src/app/api/tasks/route.test.ts`
  - `src/app/api/__tests__/protected-post-routes.test.ts`
- Validation:
  - focused tasks route + protected POST matrix passed `2` files / `171` tests
  - scoped Prettier check passed
  - scoped ESLint passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Minimized `POST /api/tasks` success/duplicate response DTOs require a
    separate API-contract proposal because the current route returns raw task
    rows and this refactor loop is behavior-preserving.
  - PHI-safe route-level structured logging for unexpected create failures is a
    separate observability candidate.

### 2026-07-01 11:33 JST: Nav Badge API Path And Header Helper

- Completed safe candidate: `Nav badge path helper only`.
- Files changed:
  - `src/components/layout/use-nav-badges.ts`
  - `src/components/layout/use-nav-badges.test.ts`
  - `src/lib/nav-badges/api-paths.ts`
  - `src/lib/nav-badges/api-paths.test.ts`
- Validation:
  - focused nav badge/sidebar/API/service suite passed `6` files / `41` tests
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - diff whitespace check passed
- Remaining follow-up:
  - `/api/nav-badges` no-store route assertion/hardening is a separate API
    privacy candidate, not part of the helper-only slice.

### 2026-07-01 11:43 JST: Nav Badge Route No-Store Boundary

- Completed safe follow-up: `/api/nav-badges` response privacy hardening.
- Files changed:
  - `src/app/api/nav-badges/route.ts`
  - `src/app/api/nav-badges/route.test.ts`
- Validation:
  - focused nav badge/sidebar/API/service suite passed `6` files / `44` tests
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - diff whitespace check passed
- Remaining follow-up:
  - Nav badge service parity/date-boundary/RLS request-context questions remain
    separate behavior candidates.

### 2026-07-01 11:53 JST: Report Generation Path Helper

- Completed safe candidate: `Report Generation Path Helper`.
- Files changed:
  - `src/lib/reports/api-paths.ts`
  - `src/lib/reports/api-paths.test.ts`
  - `src/lib/reports/generate-from-visit-client.ts`
  - `src/lib/reports/generate-from-visit-client.test.ts`
- Validation:
  - focused report helper/client/contract/workspace/route suite passed `5`
    files / `52` tests
  - scoped ESLint passed
  - scoped Prettier check passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Server route catalog and rate-limit literals for this endpoint remain
    separate API-boundary candidates.

### 2026-07-01 12:03 JST: Admin Notification Settings Path Helpers

- Completed safe candidate: `Admin Notification Settings Path Helpers`.
- Files changed:
  - `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
  - `src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx`
  - `src/lib/notification-rules/api-paths.ts`
  - `src/lib/notification-rules/api-paths.test.ts`
  - `src/lib/escalation-rules/api-paths.ts`
  - `src/lib/escalation-rules/api-paths.test.ts`
- Validation:
  - focused notification-settings/helper/header/path-segment suite passed `5`
    files / `36` tests
  - scoped ESLint passed
  - scoped Prettier check passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - `/api/notification-rules` no-store/unexpected-error wrapping and
    notification-rule mutation audit evidence remain separate API hardening
    candidates.

### 2026-07-01 12:13 JST: Notification Rules No-Store Boundary

- Completed API hardening follow-up: `/api/notification-rules` response privacy
  boundary.
- Files changed:
  - `src/app/api/notification-rules/route.ts`
  - `src/app/api/notification-rules/route.test.ts`
  - `src/app/api/notification-rules/[id]/route.ts`
  - `src/app/api/notification-rules/[id]/route.test.ts`
- Validation:
  - focused notification-rule/escalation-rule route suite passed `4` files /
    `46` tests
  - scoped ESLint passed
  - scoped Prettier check passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - Notification-rule mutation audit evidence remains a separate API/audit
    candidate.

### 2026-07-01 12:26 JST: Patient And Report Share API Path Helpers

- Completed helper/fail-closed candidate:
  `Patient/report share communication request and task API helpers`.
- Files changed:
  - `src/lib/communications/api-paths.ts`
  - `src/lib/communications/api-paths.test.ts`
  - `src/lib/tasks/api-paths.ts`
  - `src/lib/tasks/api-paths.test.ts`
  - `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx`
  - `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx`
  - `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx`
  - `src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx`
- Validation:
  - focused communication/task/share/header suite passed `5` files / `57`
    tests
  - scoped ESLint passed
  - scoped Prettier check passed
  - scoped diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - full diff whitespace check passed
- Remaining follow-up:
  - `POST /api/tasks` no-store/sanitized-error backend hardening is the next
    PHI-bearing API response-boundary candidate.
  - Patient-share QueryClientProvider-backed integration coverage remains a
    future test-quality candidate.

## Execution Order

1. Maintain Phase 0 documents.
   - Keep `REFACTOR_REPOSITORY_INVENTORY.md`,
     `REFACTOR_RISK_MAP.md`, and this plan current when the repo shape or
     refactor strategy changes.
2. Pick one bounded change.
   - Prefer one surface, one helper family, or one route family.
   - Inspect live code and tests before editing.
3. Declare slice intent.
   - Purpose.
   - Target files.
   - Expected behavior preservation.
   - Risks.
   - Validation.
4. Implement the smallest complete change.
   - No opportunistic unrelated formatting.
   - No broad staging.
   - No migration/auth/RLS/audit/PHI behavior changes.
5. Validate.
   - Focused tests first.
   - Cheap gates before commit.
   - Heavy gates only at larger boundaries or when impacted.
6. Record progress.
   - Update `.codex/ralph-state.md` and `CODEX_GOAL_PROGRESS.md` when relevant.
   - Include commands and results, not intent-only claims.
7. Commit as a coherent group.
   - Implementation commit.
   - Progress/docs commit if separate.
   - Send agmsg FYI after commit.
8. Repeat.
   - Re-scan for remaining high-value candidates.
   - Keep the full objective open until requirement-by-requirement evidence
     proves completion.

## Repository Priority

1. Low-risk helper convergence and dead-code cleanup with proof.
2. False-empty/truncation display improvements where API compatibility is
   additive and tests can prove behavior.
3. Large-module pure helper/type extraction with characterization tests.
4. Patient/report/schedule helper work only with privacy/medical/date review.
5. P0 work only as proposals unless explicitly approved.

## Standard Change Unit

Each slice should normally satisfy:

- 1 purpose.
- 1 user-facing surface, route family, or helper family.
- 2-6 changed files where possible.
- Existing behavior preserved.
- Tests added/updated when the behavior needs locking.
- Focused validation run.
- Cheap gates green before commit.
- Progress ledger updated with evidence.

## Candidate Work Packages

### 1. Report Generation Path Helper

- Status: completed as a behavior-preserving client path helper slice on
  2026-07-01 11:53 JST.

- Files:
  - `src/lib/reports/generate-from-visit-client.ts`
  - existing or new `src/lib/reports/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize `/api/care-reports/generate-from-visit`.
  - Reduce URL/path drift.
- Risk:
  - Care report generation touches patient care content.
  - Path-only change must preserve payload and headers.
- Validation:
  - focused report generation client tests
  - hostile/encoded path assertions if applicable
  - cheap gates
- Rollback:
  - Revert helper commit.

### 2. Nav Badge API Helper

- Files:
  - `src/components/layout/use-nav-badges.ts`
  - existing or new `src/lib/nav-badges/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize `/api/nav-badges`.
  - Reduce layout fetch drift.
- Risk:
  - Badge counts are operational signals.
  - Must not expose PHI in errors/logs.
- Validation:
  - hook/helper tests
  - org-missing disabled behavior
  - fetch failure behavior
  - cheap gates
- Rollback:
  - Revert helper commit.

### 3. Admin Notification Settings Path Helpers

- Status: completed as a behavior-preserving helper/header convergence slice on
  2026-07-01 12:03 JST.

- Files:
  - `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
  - existing or new `src/lib/notification-rules/api-paths.ts`
  - existing or new `src/lib/escalation-rules/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize notification/escalation rule paths.
- Risk:
  - Notification/escalation settings affect operations.
  - No delivery, escalation, permission, or audit behavior changes.
- Validation:
  - focused admin notification tests
  - helper tests
  - cheap gates
- Rollback:
  - Revert helper commit.

### 4. Admin Shifts Helper Split

- Files:
  - `src/app/(dashboard)/admin/shifts/shifts-content.tsx`
  - helpers for pharmacy sites, pharmacists, shifts, templates, holidays
  - related tests
- Expected effect:
  - Reduce raw path/header drift in scheduling admin UI.
- Risk:
  - Scheduling is operationally sensitive and date-boundary sensitive.
- Validation:
  - helper tests for query/date/path shape
  - focused shifts UI tests
  - `pnpm date-slices:check` if date logic is touched
  - cheap gates
- Rollback:
  - Revert per-helper commit.

### 5. Additive Count Metadata For Bounded Lists

- Candidate route families:
  - pharmacist shift templates
  - PCA pumps / rentals
  - UAT feedback
  - other bounded admin lists after inspection
- Expected effect:
  - Reduce false-empty and silent truncation.
- Risk:
  - Must be additive and backward-compatible.
  - Must not reveal PHI or alter filters.
- Validation:
  - route tests for total/visible/hidden/limit
  - UI tests if labels consume metadata
  - cheap gates
- Rollback:
  - Consumers should tolerate missing metadata; revert additive commit.

### 6. Patient/Report Share Helper Cleanup

- Status: partially completed on 2026-07-01 12:26 JST for communication-request
  collection paths, task collection paths, patient-share org headers, and
  report-share dot-segment patient-id fail-closed rendering. External-access
  grant path/header semantics and deeper QueryClient lifecycle coverage remain
  separate candidates.

- Files:
  - `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx`
  - `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx`
  - communication/tasks API path helpers
  - related tests
- Expected effect:
  - Reduce duplicate communication request/task path construction.
- Risk:
  - Patient/report sharing is PHI and external-access sensitive.
- Validation:
  - privacy and medical safety review
  - helper path tests
  - component tests
  - no external-send semantic changes
  - cheap gates
- Rollback:
  - Revert helper commit.

### 7. Medication Cycle History Helper

- Files:
  - `src/components/features/workflow/cycle-transition-query.ts`
  - existing or new `src/lib/medication-cycles/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize medication cycle history URL construction.
- Risk:
  - Medication workflow interpretation is safety-relevant.
- Validation:
  - medical safety review
  - helper tests for hostile IDs
  - workflow query tests
  - cheap gates
- Rollback:
  - Revert helper commit.

### 8. Large Module Pure Extraction

- Candidate modules:
  - `admin/drug-masters/drug-master-content.tsx`
  - schedule day/proposal components
  - prescription intake form
  - patient detail service modules
  - billing evidence core
  - daily job logic
- Expected effect:
  - Improve testability without changing JSX/hook order or server semantics.
- Risk:
  - Large modules are high-coupling and easy to break.
- Validation:
  - characterization test before movement
  - move only pure functions/types/constants
  - existing focused tests
  - cheap gates
- Rollback:
  - Revert extraction commit.

## First 10 Safe Candidates

1. Reports generate-from-visit path helper only.
2. Nav badge path helper only.
3. Admin notification settings path helper extraction only.
4. Admin capacity read fetch helper cleanup.
5. Admin realtime dashboard read fetch helper cleanup.
6. `/api/me/preferences` and `/api/me/sites` helper extraction only.
7. Admin shifts helper split A: pharmacy-sites/business-holidays read paths.
8. Interprofessional report share communication-request collection helper only.
9. Patient external share communication-request collection helper with privacy
   review.
10. Medication cycle history path helper with medical safety review.

## Validation Matrix

For every implementation slice:

- `git status --short --untracked-files=all`
- focused `rg` before/after
- focused Vitest for touched files
- `pnpm typecheck`
- `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`
- `pnpm lint`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`
- `git diff --check`

Additional gates by impact:

- Date/schedule: `pnpm date-slices:check`, `pnpm test:schedule-time:tz`
- EventBridge/scheduled jobs: `pnpm eventbridge-schedules:check`
- DB/RLS/migration: proposal first, then `pnpm db:e2e:prepare` and migration
  precondition checks after approval
- UI visible behavior: focused component tests, browser/Playwright evidence
- Medical/PHI surfaces: medical safety and privacy review, targeted E2E where
  feasible
- Large boundary or completion audit: `pnpm test`, `pnpm build`, impacted E2E

## Rollback Plan

- Keep each unit in one small commit or PR.
- Avoid migrations in normal refactor slices.
- For helper extraction, rollback is reverting the helper commit.
- For additive metadata, consumers must tolerate old responses and rollback must
  not require DB changes.
- For docs-only changes, rollback is a docs revert.
- For P0 proposals, no runtime rollback is needed because no implementation
  occurs before approval.

## Commit / PR Split

Recommended PR 1:

- Phase 0 docs and first helper convergence.
- Commits:
  - `docs(refactor): add phase zero inventory and plan`
  - `refactor(reports): centralize generate-from-visit api path`
  - `refactor(nav): centralize nav badge api path`
  - `docs(progress): record helper convergence validation`

Recommended PR 2:

- Admin helper convergence.
- Commits:
  - `refactor(admin): centralize notification settings api paths`
  - `refactor(admin-shifts): centralize pharmacy site and holiday paths`
  - `docs(progress): record admin helper validation`

Recommended PR 3:

- Additive count metadata after route inspection.
- Commits:
  - `fix(api): add shift template count metadata`
  - `fix(api): add pca equipment count metadata`
  - `fix(ui): surface hidden list counts where available`
  - `docs(progress): record count metadata validation`

Recommended PR 4:

- Patient/report/share helper cleanup with specialist review.
- Commits:
  - `refactor(reports): centralize interprofessional share api paths`
  - `refactor(patients): centralize external share api paths`
  - `docs(progress): record share helper validation`

Proposal-only PRs:

- DB schema/RLS/auth/audit/external-send/billing/medication identity changes.
- Must include acceptance criteria, impact radius, rollback, data-flow review,
  privacy review, and approval record.

## Required Reviewer / Subagent Routing

- Default planning: `implementation_planner`, `spec_guardian`
- API contract: `api_contract_reviewer`
- Patient/report/medication/schedule: `medical_safety_reviewer`,
  `privacy_compliance_reviewer`, `data_integrity_auditor`
- UI: `frontend_reviewer`, `accessibility_ux_reviewer`, `ui_flow_tester`
  when visible behavior changes
- Security/tenant/auth-adjacent: `security_critic`, `threat_modeler`,
  `privacy_compliance_reviewer`
- Final proof: `verifier`

## Completion Notes

The broad objective is not complete just because a small slice is green.
Completion requires requirement-by-requirement proof across the original
objective. Until then, continue using this plan to select and close bounded
behavior-preserving slices.
