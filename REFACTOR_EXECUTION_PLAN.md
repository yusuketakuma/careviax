# REFACTOR_EXECUTION_PLAN.md

Snapshot: 2026-07-02 JST

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
  - dashboard clerk-support route-local logger sanitizer converged on the
    shared safe structured logger overload, with sanitized patient/task BFF
    failure coverage
  - incident-reports route-local logger sanitizer converged on the shared safe
    structured logger overload, with sanitized GET/POST failure coverage and
    incident-event emitted-payload redaction coverage in the shared logger
    tests
  - dashboard monthly-stats route-local logger sanitizer converged on the
    shared safe structured logger overload, and shared structured error-name
    normalization now collapses custom domain error class names to built-in
    allowlisted names
  - shared logger string overload now rejects typed raw-error second arguments
    and runtime bypasses no longer emit raw error message, stack, or
    `String(error)` payloads
  - patient-self-reports route-local logger sanitizer converged on the shared
    safe structured logger object overload, with GET/POST sanitized failure and
    protected matrix coverage
  - inquiry-records collection/detail route-local logger sanitizers converged
    on the shared safe structured logger object overload, with GET/POST/PATCH
    sanitized failure and protected matrix coverage
  - medication-issues route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure and
    protected matrix coverage
  - medication-profiles route-local logger sanitizer converged on the shared
    safe structured logger object overload, with GET/POST sanitized failure and
    protected matrix coverage
  - residual-medications route-local logger sanitizer converged on the shared
    safe structured logger object overload, with GET/POST sanitized failure and
    protected matrix coverage
  - first-visit-documents collection route-local logger sanitizer converged on
    the shared safe structured logger object overload, with GET/POST sanitized
    failure and protected matrix coverage
  - first-visit-documents detail route-local logger sanitizer converged on the
    shared safe structured logger object overload, with PATCH sanitized failure
    and protected matrix coverage
  - first-visit-documents print-batch route-local logger sanitizer converged
    on the shared safe structured logger object overload, with POST sanitized
    failure and protected matrix coverage
  - dispense verify-barcode route-local logger sanitizer converged on the
    shared safe structured logger object overload, with POST sanitized failure,
    route-level auth/scope coverage, and barcode verification unit coverage
  - drug-master route-local logger sanitizers converged on the shared safe
    structured logger object overload across list, detail, batch, generic
    recommendation, ingredient group, and package-insert routes, with
    sanitized failure coverage
  - drug-master-import route-local logger sanitizers converged on the shared
    safe structured logger object overload across MHLW price/generic, HOT,
    SSK, PMDA, and manual clinical import routes, with sanitized failure
    coverage
  - consent-records route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure and
    protected matrix coverage
  - communication request responses route-local logger sanitizer converged on
    the shared safe structured logger object overload, with GET/POST sanitized
    failure and protected matrix coverage
  - comments route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure and
    protected matrix coverage
  - objective-required `ops/refactor` resume artifacts created for current
    state, code map, findings, plan, log, and verification tracking
  - billing-evidence analytics/stats/check route-local logger sanitizers
    converged on the shared safe structured logger object overload, with direct
    route sanitized failure coverage
  - staff-workload route-local logger sanitizer converged on the shared safe
    structured logger object overload, with sanitized failure coverage and
    protected GET matrix coverage
  - tracing-reports collection route-local logger sanitizer converged on the
    shared safe structured logger object overload, with GET/POST sanitized
    failure coverage and protected GET/POST matrix coverage
  - tracing-reports detail route-local logger sanitizer converged on the shared
    safe structured logger object overload, with PATCH/DELETE sanitized failure
    coverage
  - CDS check route-local logger sanitizer converged on the shared safe
    structured logger object overload, with POST sanitized failure coverage and
    protected POST matrix coverage
  - medication-cycle history route-local logger sanitizer converged on the
    shared safe structured logger object overload, with GET sanitized failure
    coverage
  - pharmacy stock usage-mismatch route-local logger sanitizer converged on
    the shared safe structured logger object overload, with GET sanitized
    failure coverage
  - pharmacy stock bulk route-local logger sanitizer converged on the shared
    safe structured logger object overload, with POST sanitized failure
    coverage
  - set-batches detail route-local logger sanitizer converged on the shared
    safe structured logger object overload, with GET/PATCH/DELETE sanitized
    failure coverage and protected matrix coverage
  - set-batches collection route-local logger sanitizer converged on the shared
    safe structured logger object overload, with GET/POST sanitized failure
    coverage and protected matrix coverage
  - set-plans collection route-local logger sanitizer converged on the shared
    safe structured logger object overload, with GET/POST sanitized failure
    coverage and protected matrix coverage
  - set-plans detail route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/PATCH sanitized failure
    coverage and protected matrix coverage
  - set-plans generate-batches route-local logger sanitizer converged on the
    shared safe structured logger object overload, with POST sanitized failure
    coverage and protected matrix coverage
  - set-audits route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure coverage
    and protected matrix coverage
  - dispense-audits route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure coverage
    and protected matrix coverage
  - dispense-results route-local logger sanitizer converged on the shared safe
    structured logger object overload, with POST sanitized failure coverage and
    protected matrix coverage
  - care-reports route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure coverage
    and protected matrix coverage
  - visit-billing-candidates summary route-local logger sanitizer converged on
    the shared safe structured logger object overload, with GET sanitized
    failure coverage
  - visit-records route-local logger sanitizer converged on the shared safe
    structured logger object overload, with GET/POST sanitized failure,
    patient-state snapshot failure, background handoff warning coverage, and
    protected matrix coverage
  - patient prescription route-local logger sanitizers converged on the shared
    safe structured logger object overload, with GET/POST sanitized failure
    coverage and protected GET matrix coverage
  - dashboard workflow/cockpit/medication-deadlines route-local logger
    sanitizers converged on the shared safe structured logger object overload,
    with GET sanitized failure coverage, protected GET matrix coverage, and a
    workflow route snapshot sync to the current workflow-dashboard section href
    contract
  - dashboard medication-deadlines query parsing moved from route-local strict
    single-param / exact integer helpers to `src/lib/api/search-params.ts`,
    with helper unit coverage and route validation coverage
  - interventions strict optional `patient_id` / `issue_id` filters moved from
    a route-local helper to `readStrictOptionalSearchParam`, preserving
    duplicate, blank, padded, and max-length field-error behavior
  - medication-issues strict optional `patient_id` / `case_id` / `status`
    filters moved from a route-local helper to `readStrictOptionalSearchParam`,
    preserving duplicate, blank, padded, max-length, and unsupported-status
    field-error behavior
  - residual-medications and first-visit-documents strict optional filters
    moved from route-local helpers to `readStrictOptionalSearchParam`,
    preserving duplicate, blank, padded, and max-length field-error behavior
  - medication-cycles strict optional `status` / `case_id` / `patient_id`
    filters moved from a route-local helper to `readStrictOptionalSearchParam`,
    preserving duplicate, blank, padded, max-length, and unsupported-status
    field-error behavior
  - dispense-tasks strict optional `status` / `cycle_id` / `assigned_to`
    filters moved from a route-local helper to `readStrictOptionalSearchParam`,
    preserving duplicate, blank, padded, max-length, and unsupported-status
    field-error behavior
  - Redis realtime adapter pending unsubscribe race and failed subscribe local
    state rollback fixed with mocked Redis regression tests
  - medication-history bulk-export immediate drain failures now emit a safe
    structured warning instead of being swallowed by an empty catch
  - notification realtime broadcast failures now emit a safe structured
    warning instead of being swallowed by an empty catch
  - voice memo manual transcript local-save `false` results now show the
    existing warning state instead of looking fully successful
  - presence realtime broadcast failures now emit a safe structured warning
    instead of being swallowed by `.catch(() => undefined)`
  - external-access fallback-audit rollback failures now emit a safe structured
    warning instead of silently swallowing a failed grant revocation
  - patient MCS failed-state persistence failures now emit a safe structured
    warning, and MCS identity conflict failures persist fixed operator-safe
    text instead of patient-name-bearing text
  - visit schedule proposal detail pharmacist enrichment failures now emit a
    safe structured warning instead of silently returning null enrichment
  - presence heartbeat client delivery failures now emit a throttled safe
    structured warning while preserving best-effort return behavior
  - collaboration room-token transient failures now emit throttled safe
    structured warnings while preserving retry/access-denied classification
  - PH-OS fee-rules Aurora rollback failures now emit a PH-OS structured
    warning while preserving original query error propagation and connection
    release behavior
  - external drug-master import response-stream cancel failures now emit a safe
    structured warning while preserving the original read/byte-limit error
  - configured RDS backup monitor SDK import failures now return `error` and
    aggregate `overall: error` instead of being cached as `skipped` and
    false-green.
  - `/api/health` backup-monitor rejection responses now return a fixed safe
    message instead of raw exception text, while preserving degraded/error
    status.
  - backup-monitor RDS/S3/audit/Cognito AWS check failures now return/log fixed
    safe messages instead of raw provider exception text.
  - generic backend health-check DB/S3 failures now return fixed safe messages
    instead of raw database/AWS exception text.
  - outbound webhook delivery results now return redacted display URLs and
    fixed safe dispatch failure messages instead of raw registered URL query
    secrets or raw fetch/runtime exception text.
  - job runner retry/final failure rows, admin notifications, and cleanup
    diagnostics now use fixed safe messages instead of raw caught job failure
    text.
  - CloudWatch metric send failures now log a fixed safe diagnostic instead of
    raw provider/runtime error text while preserving best-effort metric
    emission.
  - shared realtime stream listener failures now log fixed safe diagnostics
    instead of raw event/status listener exception text while preserving stream
    continuity.
  - offline sync unexpected queue failures now persist/log fixed safe diagnostics
    instead of raw exception text while preserving retry, HTTP status, conflict,
    and queue single-flight behavior.
  - visit schedule proposal candidate evaluation failures now return fixed
    diagnostics instead of raw upstream exception text while preserving
    `evaluation_error` classification.
  - expired generated-file cleanup results now return fixed safe deletion failure
    diagnostics instead of raw S3/DB exception text while preserving failure
    counts and cleanup pagination.
  - SSK import failed log rows now persist fixed safe diagnostics instead of raw
    fetch/ZIP/upsert exception text while preserving the original exception
    rethrow.

## Completed Slices

### 2026-07-02 04:50 JST: SSK Import Safe Error Log Fix

- Completed bug-fix follow-up:
  `SSK Import Safe Error Log Fix`.
- Files changed:
  - `src/server/services/drug-master-import/ssk.ts`
  - `src/server/services/drug-master-import/ssk.test.ts`
- Result:
  - `importSskDrugMaster()` now persists fixed `SSK取込に失敗しました` for failed
    import logs instead of arbitrary caught exception messages.
  - Running log creation, failed status update, original exception rethrow,
    successful source ZIP/hash logging, upserts, route behavior, and job wrapper
    behavior remain unchanged.
- Validation:
  - Focused red regression failed before the fix for raw persisted import error
    logs.
  - Focused safe-log regression passed.
  - Full SSK import suite passed `1` file / `9` tests.
  - SSK import route plus drug-master job tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.
  - gbrain FailurePattern write/readback passed.

### 2026-07-02 04:36 JST: File Storage Safe Cleanup Errors Fix

- Completed bug-fix follow-up:
  `File Storage Safe Cleanup Errors Fix`.
- Files changed:
  - `src/server/services/file-storage.ts`
  - `src/server/services/file-storage.test.ts`
- Result:
  - `cleanupExpiredGeneratedFiles().errors[]` now returns fixed
    `保持期限切れファイルの削除に失敗しました` entries instead of arbitrary caught
    deletion exception messages.
  - Failure counts, processed/scanned counts, pagination, deletion attempts, and
    safe structured partial-failure warnings remain unchanged.
- Validation:
  - Focused red regression failed before the fix for raw returned cleanup errors.
  - Focused safe-cleanup regression passed.
  - Full file-storage suite passed `1` file / `72` tests.
  - File-storage plus related PDF bulk-export service/route tests passed `3`
    files / `101` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `git diff --check` passed.
  - gbrain FailurePattern write/readback passed.

### 2026-07-02 04:29 JST: Visit Planner Safe Evaluation Diagnostics Fix

- Completed bug-fix follow-up:
  `Visit Planner Safe Evaluation Diagnostics Fix`.
- Files changed:
  - `src/server/services/visit-schedule-planner.ts`
  - `src/server/services/visit-schedule-planner.test.ts`
- Result:
  - Candidate evaluation failures still reject the candidate with
    `reason_code: evaluation_error`.
  - Rejected diagnostics now use fixed `評価中にエラーが発生しました` detail
    instead of raw upstream exception text.
  - Travel-limit classification, route ordering, scoring, and proposal generation
    behavior remain unchanged.
- Validation:
  - Focused red regression failed before the fix for raw rejected diagnostics.
  - Focused safe-diagnostic regression passed.
  - Full planner suite passed `1` file / `45` tests.
  - Planner plus visit-schedule-proposals route tests passed `3` files / `209`
    tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.

### 2026-07-02 04:17 JST: Offline Sync Safe Diagnostics Fix

- Completed bug-fix follow-up:
  `Offline Sync Safe Diagnostics Fix`.
- Files changed:
  - `src/lib/stores/sync-engine.ts`
  - `src/lib/stores/sync-engine.test.ts`
- Result:
  - Unexpected offline sync failures now persist fixed `同期に失敗しました`
    `lastError` text instead of arbitrary caught exception messages.
  - Automatic online-sync failures now warn with the same fixed safe message
    instead of the raw error object.
  - Malformed payload, HTTP status, conflict, retry, queue single-flight, and
    conflict-resolution behavior remain unchanged.
- Validation:
  - Focused red regressions failed before the fix for raw persisted/logged
    diagnostics.
  - Focused safe-diagnostic regressions passed.
  - Full sync-engine suite passed `1` file / `18` tests.
  - Related offline sync shared/offline-store tests passed `2` files / `15`
    tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.

### 2026-07-02 04:05 JST: Realtime Listener Safe Diagnostics Fix

- Completed bug-fix follow-up:
  `Realtime Listener Safe Diagnostics Fix`.
- Files changed:
  - `src/lib/realtime/shared-event-stream.ts`
  - `src/lib/realtime/shared-event-stream.test.ts`
- Result:
  - Event/status listener exceptions are still isolated so one broken consumer
    does not reconnect or break the shared SSE stream.
  - Console diagnostics now use fixed `Realtime listener failed` with a safe
    error kind instead of raw listener exception text.
- Validation:
  - Focused red regression failed before the fix for raw console diagnostics.
  - Focused safe-diagnostic regression passed.
  - Full shared realtime stream suite passed `1` file / `4` tests.
  - Shared stream plus related realtime hook tests passed `3` files / `14`
    tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.

### 2026-07-02 03:56 JST: CloudWatch Safe Metric Failure Log Fix

- Completed bug-fix follow-up:
  `CloudWatch Safe Metric Failure Log Fix`.
- Files changed:
  - `src/lib/aws/cloudwatch.ts`
  - `src/lib/aws/cloudwatch.test.ts`
- Result:
  - `putMetrics()` still swallows CloudWatch send failures so metrics cannot
    break request paths.
  - Console diagnostics now use fixed `CloudWatch metric emission failed`
    instead of raw provider/runtime failure text.
- Validation:
  - Focused red regression failed before the fix for raw console diagnostics.
  - Focused safe-log regression passed.
  - Full CloudWatch helper suite passed `1` file / `3` tests.
  - CloudWatch helper plus jobs/admin flush-metrics route tests passed `3`
    files / `8` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.

### 2026-07-02 03:45 JST: Job Runner Safe Failure Diagnostics Fix

- Completed bug-fix follow-up:
  `Job Runner Safe Failure Diagnostics Fix`.
- Files changed:
  - `src/server/jobs/runner.ts`
  - `src/server/jobs/runner.test.ts`
- Result:
  - Retry and final failed `integrationJob.error_log` writes use fixed
    `Job execution failed` diagnostics instead of raw caught failure text.
  - Admin job-failure notifications use a fixed Japanese execution-failure
    message instead of raw exception text.
  - Cleanup-failure console diagnostics remain actionable but no longer include
    raw cleanup or original failure messages.
  - The original thrown error is still preserved for callers after retries.
- Validation:
  - Focused red regressions failed before the fix for raw update payloads and
    cleanup diagnostics.
  - Focused safe-diagnostic regressions passed.
  - Full runner suite passed `1` file / `7` tests.
  - Runner plus jobs API route tests passed `3` files / `38` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.

### 2026-07-02 03:26 JST: Outbound Webhook Safe Result Fix

- Completed bug-fix follow-up:
  `Outbound Webhook Safe Result Fix`.
- Files changed:
  - `src/server/services/outbound-webhook.ts`
  - `src/server/services/outbound-webhook.test.ts`
- Result:
  - Returned delivery results use redacted display URLs while actual HTTP
    dispatch still uses the registered raw URL.
  - Dispatch exceptions now return and persist the fixed safe message
    `Webhook delivery failed`.
  - The regressions prove result JSON and persisted delivery update arguments
    exclude secret-like sentinels.
- Validation:
  - Focused red regressions failed before the fix for raw result URL and raw
    dispatch exception text.
  - Focused safe-result regressions passed.
  - Full outbound-webhook suite passed `1` file / `21` tests.
  - Outbound-webhook plus job route tests passed `2` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - Full `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.

### 2026-07-02 03:18 JST: Health-Check DB/S3 Safe Error Fix

- Completed bug-fix follow-up:
  `Health-Check DB/S3 Safe Error Fix`.
- Files changed:
  - `src/server/services/health-check.ts`
  - `src/server/services/health-check.test.ts`
- Result:
  - DB and S3 health check failures now return fixed safe messages while
    preserving `status: 'down'`.
  - Success, S3 unconfigured skip, S3 client reuse, and aggregate health status
    behavior remain unchanged.
  - The regression proves secret-like sentinels are absent from result JSON.
- Validation:
  - Focused regression failed before the fix on raw DB/S3 failure text; passed
    after the fix.
  - Full health-check suite passed `1` file / `7` tests.
  - Scoped ESLint, Prettier, full typecheck, no-unused, lint, format check,
    diff-check, production build, and gbrain put/get all passed.

### 2026-07-02 03:10 JST: Backup Monitor AWS Check Safe Error Fix

- Completed bug-fix follow-up:
  `Backup Monitor AWS Check Safe Error Fix`.
- Files changed:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
- Result:
  - RDS snapshot, S3 versioning, audit archive lifecycle, and Cognito Advanced
    Security check failures now return fixed safe messages.
  - Logger error arguments for these check failures are fixed-message `Error`
    objects, not raw provider errors.
  - The RDS SDK import failure path retains its dedicated fixed safe message.
- Validation:
  - Focused regression failed before the fix on raw AWS failure text; passed
    after the fix.
  - Full backup-monitor suite passed `1` file / `8` tests.
  - Backup-monitor plus health route tests passed `2` files / `13` tests.
  - Scoped ESLint, Prettier, full typecheck, no-unused, lint, format check,
    diff-check, production build, and gbrain put/get all passed.

### 2026-07-02 03:00 JST: Health Backup Monitor Raw Error Response Fix

- Completed bug-fix follow-up:
  `Health Backup Monitor Raw Error Response Fix`.
- Files changed:
  - `src/app/api/health/route.ts`
  - `src/app/api/health/route.test.ts`
- Result:
  - Authenticated admin health responses no longer expose raw
    `runBackupMonitorChecks()` exception messages.
  - Public liveness, DB check gating, backup check invocation timing, degraded
    status, and backup error status are preserved.
  - The regression proves a secret-like backup error sentinel is absent from
    the JSON response.
- Validation:
  - Focused regression failed before the fix on raw exception message
    exposure; passed after the fix.
  - Health route plus backup-monitor tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, full typecheck, no-unused, lint, format check,
    diff-check, production build, and gbrain put/get all passed.

### 2026-07-02 02:50 JST: Backup Monitor RDS Import Failure Fix

- Completed bug-fix follow-up:
  `Backup Monitor RDS Import Failure Fix`.
- Files changed:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
- Result:
  - Configured RDS backup monitoring no longer treats a dynamic
    `@aws-sdk/client-rds` import failure as an optional-dependency skip.
  - The failed RDS module promise is cleared so later checks can retry.
  - The unconfigured local-environment skip remains unchanged.
  - The regression proves the returned/logged failure uses a fixed safe message
    and that `runBackupMonitorChecks()` becomes `overall: 'error'`.
- Validation:
  - Focused regression failed before the fix on `status: 'skipped'`; passed
    after the fix.
  - Full backup-monitor suite passed `1` file / `7` tests.
  - Backup-monitor plus health route tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, full typecheck, no-unused, lint, format check,
    diff-check, production build, and gbrain put/get all passed.

### 2026-07-02 02:37 JST: Drug-Master Import Stream-Cancel Warning Fix

- Completed bug-fix follow-up:
  `Drug-Master Import Stream-Cancel Warning Fix`.
- Files changed:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
- Acceptance:
  - Preserved caller-visible read errors and streamed byte-limit errors from
    `readResponseBytes()`.
  - Added a shared safe logger warning when response body reader cancellation
    itself fails during cleanup.
  - Added regression coverage that failed before the fix because `logger.warn`
    had zero calls, and proves warning context excludes source URL and raw
    cancel error text.
- Validation:
  - Focused stream-cancel warning test passed.
  - Full drug-master import shared test file passed `1` file / `20` tests.
  - Shared import + shared logger tests passed `2` files / `31` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed shared/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain write/readback for
    `projects/careviax/failures/2026-07-02/drug-master-import-stream-cancel-silent-failure`
    passed.

### 2026-07-02 02:26 JST: PH-OS Fee-Rules Rollback Warning Fix

- Completed bug-fix follow-up:
  `PH-OS Fee-Rules Rollback Warning Fix`.
- Files changed:
  - `src/phos/backend/aurora-fee-rules-repository.ts`
  - `src/phos/backend/aurora-fee-rules-repository.test.ts`
- Acceptance:
  - Preserved `AuroraFeeRulesRepository.searchFeeRules()` original query error
    propagation and `connection.release()` behavior when rollback itself fails.
  - Added a PH-OS structured `WARNING` event with fixed route key, error code,
    and operation metadata.
  - Added regression coverage that failed before the fix because no structured
    warning was emitted, and proves the warning excludes raw rollback error
    text, database URLs, tenant ids, and user ids.
- Validation:
  - Focused rollback warning test passed.
  - Full Aurora fee-rules repository test file passed `1` file / `16` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed backend/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain write/readback for
    `projects/careviax/failures/2026-07-02/phos-fee-rules-rollback-silent-failure`
    passed.

### 2026-07-02 02:10 JST: Room Token Client Warning Fix

- Completed bug-fix follow-up:
  `Room Token Client Warning Fix`.
- Files changed:
  - `src/lib/collaboration/room-token-client.ts`
  - `src/lib/collaboration/room-token-client.test.ts`
- Acceptance:
  - Preserved `fetchCollaborationRoomToken()` result classification: rejected
    fetches, 429/5xx responses, malformed payloads, and expired payloads still
    return `transient-error`; denied responses still return `access-denied`.
  - Added throttled shared safe logger warnings for `FETCH_REJECTED`,
    `TRANSIENT_HTTP`, `MALFORMED_PAYLOAD`, and `EXPIRED_TOKEN`.
  - Added regression coverage that failed before the fix because `logger.warn`
    had zero calls, and proves warning context excludes entity id, patient
    name, and room-token sentinels.
- Validation:
  - Focused room-token client test passed `1` file / `7` tests.
  - Room-token client + collaborative form hook + Yjs provider + shared logger
    tests passed `4` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed client/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain write/readback for
    `projects/careviax/failures/2026-07-02/room-token-client-transient-silent-failure`
    passed.

### 2026-07-02 01:55 JST: Presence Heartbeat Client Warning Fix

- Completed bug-fix follow-up:
  `Presence Heartbeat Client Warning Fix`.
- Files changed:
  - `src/lib/collaboration/presence-api-client.ts`
  - `src/lib/hooks/use-presence-heartbeat.test.ts`
- Acceptance:
  - Preserved `postPresenceUpdate()` best-effort behavior: rejected fetches
    still resolve `undefined`, and non-ok responses still resolve the original
    `Response`.
  - Added throttled shared safe logger warnings for rejected fetches and non-ok
    `/api/presence` responses.
  - Added regression coverage that failed before the fix because `logger.warn`
    had zero calls, and proves warning context excludes entity id, patient
    name, phone, and token sentinels.
- Validation:
  - Focused presence heartbeat test passed `1` file / `6` tests.
  - Presence heartbeat + presence contract + shared logger tests passed `3`
    files / `24` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed client/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain write/readback for
    `projects/careviax/failures/2026-07-02/presence-heartbeat-client-silent-failure`
    passed.

### 2026-07-02 01:38 JST: Visit Proposal Pharmacist Enrichment Warning Fix

- Completed bug-fix follow-up:
  `Visit Proposal Pharmacist Enrichment Warning Fix`.
- Files changed:
  - `src/app/api/visit-schedule-proposals/[id]/route.ts`
  - `src/app/api/visit-schedule-proposals/[id]/route.test.ts`
- Acceptance:
  - Preserved existing `GET /api/visit-schedule-proposals/[id]` success
    response, no-store headers, route preview behavior, related proposal
    shape, auth behavior, and null-enrichment fallback.
  - Replaced the silent `.catch(() => [])` around optional pharmacist
    enrichment with a shared safe logger warning.
  - Added regression coverage that failed before the fix because `logger.warn`
    had zero calls, and proves the warning context excludes patient name,
    phone, token, and pharmacist-name sentinels.
- Validation:
  - Focused visit schedule proposal detail route test passed `1` file / `75`
    tests.
  - Route + shared logger tests passed `2` files / `86` tests.
  - Protected GET matrix for visit-schedule-proposals passed `6` tests / `369`
    skipped.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain write/readback for
    `projects/careviax/failures/2026-07-02/visit-schedule-proposal-pharmacist-enrichment-empty-catch`
    passed.

### 2026-07-02 01:23 JST: Patient MCS Failure Observability Fix

- Completed bug-fix follow-up:
  `Patient MCS Failure Observability Fix`.
- Files changed:
  - `src/server/services/patient-mcs.ts`
  - `src/server/services/patient-mcs.test.ts`
- Acceptance:
  - Failed-state `patientMcsLink.upsert` rejection is no longer silently
    swallowed.
  - The original `PatientMcsSyncError` remains the thrown error when recording
    failed state also fails.
  - Identity conflict `last_sync_error` uses fixed operator-safe text and does
    not persist local or remote patient-name text.
- Validation:
  - Focused patient MCS service test passed `1` file / `23` tests.
  - Patient MCS service + MCS API route + logger tests passed `4` files / `57`
    tests.
  - Scoped ESLint/Prettier/diff-check and full typecheck/no-unused/lint/format/
    diff/build gates passed.
  - gbrain put/get for the new FailurePattern passed.

### 2026-07-02 01:04 JST: External Access Rollback Warning Fix

- Completed bug-fix follow-up:
  `External Access Rollback Warning Fix`.
- Files changed:
  - `src/app/api/external-access/route.ts`
  - `src/app/api/external-access/route.test.ts`
- Acceptance:
  - Failed grant revocation after fallback audit persistence failure is no
    longer silently swallowed.
  - The route still returns the existing fail-closed no-store `500` without
    exposing token, OTP, or raw contact values.
  - Warning context excludes raw phone contact, token/JWT text, and OTP-shaped
    values.
- Validation:
  - Focused external-access route test passed `1` file / `35` tests.
  - External-access route + logger tests passed `2` files / `46` tests.
  - Scoped ESLint/Prettier/diff-check and full typecheck/no-unused/lint/format/
    diff/build gates passed.

### 2026-07-02 00:49 JST: Presence Realtime Warning Fix

- Completed bug-fix follow-up:
  `Presence Realtime Warning Fix`.
- Files changed:
  - `src/app/api/presence/route.ts`
  - `src/app/api/presence/route.test.ts`
- Acceptance:
  - `POST /api/presence` still returns a successful heartbeat response and
    writes the local presence store when realtime broadcast fails.
  - Realtime broadcast rejection now emits a safe structured warning.
  - Warning context excludes raw error text, active field, and display name.
- Validation:
  - Focused presence route test passed `1` file / `12` tests.
  - Presence route + logger tests passed `2` files / `23` tests.
  - Scoped ESLint/Prettier/diff-check and full typecheck/no-unused/lint/format/
    diff/build gates passed.

### 2026-07-02 00:31 JST: Voice Memo Manual Save Warning Fix

- Completed bug-fix follow-up:
  `Voice Memo Manual Save Warning Fix`.
- Files changed:
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.tsx`
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.test.tsx`
- Acceptance:
  - `saveVoiceMemoManualTranscript()` resolving `false` now warns the user that
    local encrypted draft persistence failed.
  - Immediate transcript reflection and visit-record append behavior remain
    unchanged.
  - The regression test failed before the fix on zero `toast.warning` calls and
    passed after the fix.
- Validation:
  - Focused voice memo content + offline draft tests passed `2` files / `11`
    tests.
  - Scoped ESLint/Prettier/diff-check and full typecheck/no-unused/lint/format/
    diff/build gates passed.

### 2026-07-02 00:15 JST: Notification Realtime Warning Fix

- Completed bug-fix follow-up:
  `Notification Realtime Warning Fix`.
- Files changed:
  - `src/server/services/notifications.ts`
  - `src/server/services/notifications.test.ts`
- Acceptance:
  - Realtime notification broadcast rejection is no longer silently swallowed.
  - Persisted notification creation and returned notification payloads remain
    unchanged.
  - Warning context excludes raw PHI/secret-bearing error text and relies on the
    shared safe logger overload.
- Validation:
  - Focused notification service test passed `1` file / `15` tests.
  - Notification service + logger tests passed `2` files / `26` tests.
  - Scoped ESLint/Prettier/diff-check and full typecheck/no-unused/lint/format/
    diff/build gates passed.

### 2026-07-02 00:00 JST: Bulk Export Drain Warning Fix

- Completed bug-fix follow-up:
  `Bulk Export Drain Warning Fix`.
- Files changed:
  - `src/app/api/patients/medications/bulk-export/route.ts`
  - `src/app/api/patients/medications/bulk-export/route.test.ts`
- Acceptance:
  - Immediate background drain rejection is no longer silently swallowed.
  - Response contract remains `202` with sensitive no-store headers when queue
    registration succeeds.
  - Warning context excludes raw PHI/secret-bearing error text and relies on the
    shared safe logger overload.
- Validation:
  - Focused bulk-export route test passed `1` file / `8` tests.
  - Bulk-export route + logger tests passed `2` files / `19` tests.
  - Scoped ESLint/Prettier/diff-check and full typecheck/no-unused/lint/format/
    diff/build gates passed.

### 2026-07-01 23:49 JST: Redis Realtime Subscribe Race Fix

- Completed bug-fix follow-up:
  `Redis Realtime Subscribe Race Fix`.
- Files changed:
  - `src/server/adapters/realtime/redis-adapter.ts`
  - `src/server/adapters/realtime/redis-adapter.test.ts`
- Acceptance:
  - New listeners wait for a same-channel pending Redis `unsubscribe()` and the
    adapter resubscribes if listeners were added during the unsubscribe window.
  - Failed Redis `subscribe()` calls roll back local subscribed state so later
    listeners can retry the real subscribe call.
  - Existing publish, parse, callback, and adapter selection contracts remain
    unchanged.
- Validation:
  - Focused Redis adapter tests passed `1` file / `4` tests.
  - Realtime policy + Redis adapter tests passed `2` files / `8` tests.
  - Scoped ESLint/Prettier and full typecheck/no-unused/lint/format/diff/build
    gates passed.

### 2026-07-01 23:32 JST: Dispense-Tasks Strict Query Helper

- Completed duplicate-helper refactor follow-up:
  `Dispense-Tasks Strict Query Helper`.
- Files changed:
  - `src/app/api/dispense-tasks/route.ts`
  - `src/app/api/dispense-tasks/route.test.ts`
- Acceptance:
  - Removed dispense-tasks route-local strict optional filter reader and its
    now-unused query-name alias.
  - Preserved duplicate, blank, padded, max-length, unsupported-status, auth,
    permission checks, assignment scope, cursor pagination, no-store, query,
    and response behavior.
- Validation:
  - Focused helper + route tests passed `2` files / `29` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier/ESLint/diff-check and full typecheck/no-unused/lint/
    format/diff/build gates passed.

### 2026-07-01 23:18 JST: Medication-Cycles Strict Query Helper

- Completed duplicate-helper refactor follow-up:
  `Medication-Cycles Strict Query Helper`.
- Files changed:
  - `src/app/api/medication-cycles/route.ts`
  - `src/app/api/medication-cycles/route.test.ts`
- Acceptance:
  - Removed medication-cycles route-local strict optional filter reader and its
    now-unused query-name alias.
  - Preserved duplicate, blank, padded, max-length, unsupported-status, auth,
    assignment scope, pagination, no-store, query, and response behavior.
- Validation:
  - Focused helper + route tests passed `2` files / `29` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier/ESLint/diff-check and full typecheck/no-unused/lint/
    format/diff/build gates passed.

### 2026-07-01 23:07 JST: Residual / First-Visit Strict Query Helper

- Completed duplicate-helper refactor follow-up:
  `Residual / First-Visit Strict Query Helper`.
- Files changed:
  - `src/app/api/residual-medications/route.ts`
  - `src/app/api/residual-medications/route.test.ts`
  - `src/app/api/first-visit-documents/route.ts`
- Acceptance:
  - Removed residual and first-visit route-local filter readers.
  - Preserved duplicate, blank, padded, max-length, auth, assignment/scope,
    no-store, query, and response behavior.
- Validation:
  - Focused helper + route tests passed `3` files / `53` tests.
  - Protected GET matrix passed `6` tests / `369` skipped.
  - Scoped Prettier/ESLint/diff-check and full typecheck/no-unused/lint/
    format/diff/build gates passed.

### 2026-07-01 22:56 JST: Medication-Issues Strict Query Helper

- Completed duplicate-helper refactor follow-up:
  `Medication-Issues Strict Query Helper`.
- Files changed:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/medication-issues/route.ts`
  - `src/app/api/medication-issues/route.test.ts`
- Acceptance:
  - Removed medication-issues route-local filter reader.
  - Preserved duplicate, blank, padded, max-length, unsupported-status, auth,
    assignment scope, no-store, query, and response behavior.
- Validation:
  - Focused helper + route tests passed `2` files / `25` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier/ESLint/diff-check and full typecheck/no-unused/lint/
    format/diff/build gates passed.

### 2026-07-01 22:47 JST: Interventions Strict Query Helper

- Completed duplicate-helper refactor follow-up:
  `Interventions Strict Query Helper`.
- Files changed:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/interventions/route.ts`
- Acceptance:
  - Added shared strict optional search-param helper.
  - Removed interventions route-local filter reader.
  - Preserved duplicate, blank, padded, max-length, auth, assignment scope,
    no-store, query, and response behavior.
- Validation:
  - Focused helper + route tests passed `2` files / `20` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier/ESLint and full typecheck/no-unused/lint/format/diff/build
    gates passed.

### 2026-07-01 22:37 JST: Dashboard Medication-Deadlines Query Helper

- Completed duplicate-helper refactor follow-up:
  `Dashboard Medication-Deadlines Query Helper`.
- Files changed:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
- Acceptance:
  - Extracted strict single search-param and exact integer parsing helper.
  - Removed medication-deadlines route-local parser helpers.
  - Preserved existing validation messages, no-store wrapping, auth/RLS
    context, schedule query shape, and response shape.
- Validation:
  - Focused helper + route tests passed `2` files / `24` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier/ESLint/diff-check and full typecheck/no-unused/lint/
    format/diff/build gates passed after a type narrowing fix.

### 2026-07-01 22:22 JST: Dashboard Routes Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dashboard Routes Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dashboard/workflow/route.ts`
  - `src/app/api/dashboard/workflow/route.test.ts`
  - `src/app/api/dashboard/workflow/__snapshots__/route.test.ts.snap`
  - `src/app/api/dashboard/cockpit/route.ts`
  - `src/app/api/dashboard/cockpit/route.test.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
  - `src/app/api/dashboard/medication-deadlines/route.test.ts`
- Acceptance:
  - Removed duplicated route-local `SAFE_ERROR_NAMES` / `safeErrorName`
    helpers.
  - Moved GET unexpected-error logging to
    `logger.error({ event, route, method, status }, err)`.
  - Preserved dashboard auth, query parsing, cache behavior, RLS/org context,
    no-store wrapping, and response shape.
  - Updated one stale workflow route snapshot to match the current
    workflow-dashboard section href contract.
- Validation:
  - Focused dashboard route/logger tests passed `4` files / `65` tests after
    updating the stale workflow snapshot.
  - Protected GET matrix passed `9` tests / `366` skipped.
  - Workflow-dashboard sections service test passed `1` file / `12` tests.
  - Route-local sanitizer grep now returns only the canonical shared logger
    implementation.
  - Scoped Prettier/ESLint/diff-check and full typecheck/no-unused/lint/
    format/diff/build gates passed.

### 2026-07-01 22:09 JST: Patient Prescriptions Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Patient Prescriptions Structured Logger Convergence`.
- Files changed:
  - `src/app/api/patients/[id]/prescriptions/route.ts`
  - `src/app/api/patients/[id]/prescriptions/route.test.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.test.ts`
- Validation:
  - Focused patient prescriptions + e-prescription route + shared logger suite
    passed `3` files / `53` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier, scoped ESLint, and scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - Prescription GET auth, route-param/query validation, patient/case access
    scope, pagination/cursor behavior, diff review construction, no-store
    wrapping, `unstable_rethrow`, and response shape were preserved.
  - E-prescription POST auth, body validation, writable-patient guard, adapter
    error handling, acceptable-status checks, idempotency behavior, cycle
    matching, intake creation, no-store wrapping, `unstable_rethrow`, and
    response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 21:59 JST: Visit-Records Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Visit-Records Structured Logger Convergence`.
- Files changed:
  - `src/app/api/visit-records/route.ts`
  - `src/app/api/visit-records/route.test.ts`
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Validation:
  - Focused visit-records route + shared logger suite passed `2` files / `91`
    tests.
  - Protected GET matrix passed `6` tests / `369` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier, scoped ESLint, and scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only logging call shape, shared warning raw-error support, and tests
    changed.
  - GET auth, query validation, pagination/cursor behavior, patient history and
    attachment response construction, RLS request context, no-store wrapping,
    `unstable_rethrow`, and response shape were preserved.
  - POST auth, request auth context, body validation, schedule/care-case/patient
    scope checks, transaction behavior, patient snapshot best-effort behavior,
    derived-data sync, operational task/billing side effects, background
    handoff extraction dispatch, no-store wrapping, `unstable_rethrow`, and
    response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 21:44 JST: Visit-Billing-Candidates Summary Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Visit-Billing-Candidates Summary Structured Logger Convergence`.
- Files changed:
  - `src/app/api/visit-billing-candidates/summary/route.ts`
  - `src/app/api/visit-billing-candidates/summary/route.test.ts`
- Validation:
  - Focused logger + visit-billing-candidates summary route suite passed `2`
    files / `18` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    the route-test assertion proving route context has no `error_name`.
  - Scoped Prettier, scoped ESLint, and scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET unexpected-error logging call shape and tests changed.
  - `canManageBilling` auth, request auth context, billing-month validation,
    optional search-param validation, RLS request context, partner visit record
    count queries, candidate query shape, summary arithmetic, no-store
    wrapping, `unstable_rethrow`, and response shape were preserved.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, validation failure, no-store behavior, and fixed
    sanitized 500 fallback.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 21:34 JST: Care-Reports Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Care-Reports Structured Logger Convergence`.
- Files changed:
  - `src/app/api/care-reports/route.ts`
  - `src/app/api/care-reports/route.test.ts`
- Validation:
  - Focused logger + care-reports route suite passed `2` files / `72` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier, scoped ESLint, and scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - Report auth, request auth context, query/body validation, access filtering,
    pagination/cursor behavior, delivery summaries, source validation,
    duplicate conflict handling, no-store wrapping, `unstable_rethrow`, and
    response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 21:26 JST: Dispense-Results Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dispense-Results Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dispense-results/route.ts`
  - `src/app/api/dispense-results/route.test.ts`
- Validation:
  - Focused logger + dispense-results route suite passed `2` files / `50`
    tests.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route context has no `error_name`.
  - Scoped Prettier, scoped ESLint, and scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only POST unexpected-error logging call shape and tests changed.
  - Auth context, request auth context, body validation, safety checklist
    enforcement, RLS request context, assignment scoping, transaction behavior,
    CDS checks, barcode verification, operational task creation,
    workflow/webhook notifications, no-store wrapping, `unstable_rethrow`, and
    response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 21:12 JST: Dispense-Audits Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dispense-Audits Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dispense-audits/route.ts`
  - `src/app/api/dispense-audits/route.test.ts`
- Validation:
  - Focused logger + dispense-audits route suite passed `2` files / `37`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canAuditDispense` auth, request auth context, assignment scoping, queue
    query shape, mutation transaction behavior, cycle transition, notification
    dispatch, workflow dashboard invalidation, no-store wrapping,
    `unstable_rethrow`, and response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:58 JST: Set-Audits Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Set-Audits Structured Logger Convergence`.
- Files changed:
  - `src/app/api/set-audits/route.ts`
  - `src/app/api/set-audits/route.test.ts`
- Validation:
  - Focused logger + set-audits route suite passed `2` files / `50` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canAuditSet` auth, request auth context, assignment scoping, queue query
    shape, checklist and carry-packet evidence validation, mutation
    transaction behavior, reject/cell audit state handling, cycle transition,
    workflow dashboard invalidation, no-store wrapping, `unstable_rethrow`, and
    response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:49 JST: Set-Plans Generate-Batches Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Set-Plans Generate-Batches Structured Logger Convergence`.
- Files changed:
  - `src/app/api/set-plans/[id]/generate-batches/route.ts`
  - `src/app/api/set-plans/[id]/generate-batches/route.test.ts`
- Validation:
  - Focused logger + set-plans generate-batches route suite passed `2` files /
    `37` tests.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only POST unexpected-error logging call shape and tests changed.
  - `canSet` auth, request auth context, assignment scoping, optional body
    validation, serializable transaction retry behavior, existing batch
    reuse/stale input checks, forced regeneration guards, packaging and
    controlled-handling tag resolution, history logging, workflow dashboard
    invalidation, no-store wrapping, `unstable_rethrow`, and response shape
    were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:40 JST: Set-Plans Detail Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Set-Plans Detail Structured Logger Convergence`.
- Files changed:
  - `src/app/api/set-plans/[id]/route.ts`
  - `src/app/api/set-plans/[id]/route.test.ts`
- Validation:
  - Focused logger + set-plans detail route suite passed `2` files / `27`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected PATCH matrix passed `3` tests / `74` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/PATCH unexpected-error logging call shape and tests changed.
  - `canSet` auth, request auth context, assignment scoping, detail select
    shape, stale-line calculation, update validation, packaging summary
    resolution, optimistic update/conflict handling, workflow dashboard
    invalidation, no-store wrapping, `unstable_rethrow`, and response shape
    were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:32 JST: Set-Plans Collection Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Set-Plans Collection Structured Logger Convergence`.
- Files changed:
  - `src/app/api/set-plans/route.ts`
  - `src/app/api/set-plans/route.test.ts`
- Validation:
  - Focused logger + set-plans collection route suite passed `2` files / `33`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canSet` auth, request auth context, assignment scoping, list filtering and
    select shape, create validation, existing-plan replay, duplicate create
    race convergence, packaging summary resolution, cycle transition
    rollback/conflict handling, workflow dashboard invalidation, no-store
    wrapping, `unstable_rethrow`, and response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:22 JST: Set-Batches Collection Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Set-Batches Collection Structured Logger Convergence`.
- Files changed:
  - `src/app/api/set-batches/route.ts`
  - `src/app/api/set-batches/route.test.ts`
- Validation:
  - Focused logger + set-batches collection route suite passed `2` files /
    `30` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canSet` auth, request auth context, assignment scoping, list ordering and
    include shape, create validation, serializable retry behavior, set-plan
    optimistic claim, duplicate/quantity checks, packaging tag resolution,
    history logging, workflow dashboard invalidation, no-store wrapping,
    `unstable_rethrow`, and response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:15 JST: Set-Batches Detail Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Set-Batches Detail Structured Logger Convergence`.
- Files changed:
  - `src/app/api/set-batches/[id]/route.ts`
  - `src/app/api/set-batches/[id]/route.test.ts`
- Validation:
  - Focused logger + set-batches detail route suite passed `2` files / `25`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected PATCH/DELETE matrix passed `6` tests / `71` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/PATCH/DELETE unexpected-error logging call shape and tests
    changed.
  - `canSet` auth, request auth context, assignment scoping, read include
    shape, update validation, optimistic locking, immutable status conflicts,
    set-batch history logging, workflow dashboard invalidation, delete version
    validation, no-store wrapping, `unstable_rethrow`, and response shape were
    preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 20:02 JST: Pharmacy Stock Bulk Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Pharmacy Stock Bulk Structured Logger Convergence`.
- Files changed:
  - `src/app/api/pharmacy-drug-stocks/bulk/route.ts`
  - `src/app/api/pharmacy-drug-stocks/bulk/route.test.ts`
- Validation:
  - Focused logger + pharmacy stock bulk route suite passed `2` files / `28`
    tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only POST unexpected-error logging call shape and tests changed.
  - `canAdmin` auth, request body handling, CSV parsing, row validation,
    pharmacy site lookup, drug-master matching, preferred generic validation,
    duplicate-row handling, dry-run preview, stock upserts, audit writes, RLS
    request context/timeouts, no-store wrapping, `unstable_rethrow`, and
    response shape were preserved.
  - No shared protected POST matrix entry exists for this route; direct route
    tests cover auth failure, validation failures, dry-run no-mutation
    behavior, apply/audit behavior, no-store behavior, and sanitized 500
    fallback.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:57 JST: Pharmacy Stock Usage-Mismatch Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Pharmacy Stock Usage-Mismatch Structured Logger Convergence`.
- Files changed:
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts`
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts`
- Validation:
  - Focused logger + pharmacy stock usage-mismatch route suite passed `2`
    files / `23` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET unexpected-error logging call shape and tests changed.
  - `canAdmin` auth, query bounds, pharmacy site lookup, QR draft reads,
    stocked drug reads, drug-master matching, ambiguous-code metadata, mismatch
    aggregation, list truncation/count metadata, RLS request context/timeouts,
    no-store wrapping, `unstable_rethrow`, and response shape were preserved.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, query validation, no-store behavior, and
    sanitized 500 fallback.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:48 JST: Medication-Cycle History Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Medication-Cycle History Structured Logger Convergence`.
- Files changed:
  - `src/app/api/medication-cycles/[id]/history/route.ts`
  - `src/app/api/medication-cycles/[id]/history/route.test.ts`
- Validation:
  - Focused logger + medication-cycle history route suite passed `2` files /
    `16` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET unexpected-error logging call shape and tests changed.
  - Auth audit path templating, `canViewDashboard` auth, request auth context,
    ID normalization, org/case assignment scope, transition log query,
    actor-name hydration, route performance wrapping, no-store wrapping,
    `unstable_rethrow`, and response shape were preserved.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, no-store behavior, blank ID rejection, not-found,
    and sanitized 500 fallback.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:41 JST: CDS Check Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `CDS Check Structured Logger Convergence`.
- Files changed:
  - `src/app/api/cds/check/route.ts`
  - `src/app/api/cds/check/route.test.ts`
- Validation:
  - Focused logger + CDS check route suite passed `2` files / `14` tests.
  - CDS check POST protected matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only POST unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, JSON body validation,
    medication-cycle org ownership lookup, patient scope derivation, CDS
    checker invocation, route performance wrapping, no-store wrapping,
    `unstable_rethrow`, and response shape were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:28 JST: Tracing Reports Detail Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Tracing Reports Detail Structured Logger Convergence`.
- Files changed:
  - `src/app/api/tracing-reports/[id]/route.ts`
  - `src/app/api/tracing-reports/[id]/route.test.ts`
- Validation:
  - Focused logger + tracing-reports detail route suite passed `2` files /
    `34` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only detail PATCH/DELETE unexpected-error logging call shape and tests
    changed.
  - `canAuthorReport` auth, ID normalization, sensitive no-store wrapping,
    `unstable_rethrow`, access filtering, rollback conflict behavior,
    optimistic update/delete predicates, communication request/event side
    effects, audit writes, default channel handling, PDF path encoding, RLS
    request context, and response DTOs were preserved.
  - Shared protected PATCH/DELETE matrix does not currently register this
    detail route; direct route tests now cover PATCH and DELETE auth failures,
    no-store behavior, sanitized 500 fallback, and no side effects before
    failing operations.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:19 JST: Tracing Reports Collection Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Tracing Reports Collection Structured Logger Convergence`.
- Files changed:
  - `src/app/api/tracing-reports/route.ts`
  - `src/app/api/tracing-reports/route.test.ts`
- Validation:
  - Focused logger + tracing-reports collection route suite passed `2` files /
    `27` tests.
  - Tracing-reports GET protected matrix passed `3` tests / `372` skipped.
  - Tracing-reports POST protected matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only collection GET/POST unexpected-error logging call shape and tests
    changed.
  - `canReport` / `canAuthorReport` auth, request auth context, sensitive
    no-store wrapping, `unstable_rethrow`, assignment access where, pagination,
    patient-name hydration, request body validation, medication issue
    attachment checks, `withOrgContext` request context, response DTOs, and
    fixed internal-error responses were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:12 JST: Staff Workload Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Staff Workload Structured Logger Convergence`.
- Files changed:
  - `src/app/api/staff-workload/route.ts`
  - `src/app/api/staff-workload/route.test.ts`
- Validation:
  - Focused logger + staff-workload route suite passed `2` files / `18` tests.
  - Staff-workload GET protected matrix passed `3` tests / `372` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    the route-test assertion proving route context has no `error_name`.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, date validation, no-store wrapping,
    `unstable_rethrow`, RLS `withOrgContext` request context, raw SQL task
    preview query, visit/dispense/task query shapes, role labels, sorting,
    response DTOs, and fixed internal-error response were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 19:02 JST: Billing Evidence Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Billing Evidence Structured Logger Convergence`.
- Files changed:
  - `src/app/api/billing-evidence/analytics/route.ts`
  - `src/app/api/billing-evidence/analytics/route.test.ts`
  - `src/app/api/billing-evidence/stats/route.ts`
  - `src/app/api/billing-evidence/stats/route.test.ts`
  - `src/app/api/billing-evidence/check/route.ts`
  - `src/app/api/billing-evidence/check/route.test.ts`
- Validation:
  - Focused logger + billing-evidence route suite passed `4` files / `24`
    tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting route files; scoped ESLint passed;
    scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET unexpected-error logging call shape and tests changed.
  - `canReport` auth, request auth context, sensitive no-store wrapping,
    `unstable_rethrow`, billing month calculations, all Prisma read query
    shapes, RLS `withOrgContext` timeout use in check, patient href encoding,
    today ops rail composition, response DTOs, invalid query behavior, and
    fixed internal-error response were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 18:51 JST: Ops Refactor Artifact Sync

- Completed docs/state follow-up:
  `Ops Refactor Artifact Sync`.
- Files changed:
  - `ops/refactor/STATE.md`
  - `ops/refactor/CODE_MAP.md`
  - `ops/refactor/BUG_FINDINGS.md`
  - `ops/refactor/INCONSISTENCY_FINDINGS.md`
  - `ops/refactor/DEAD_CODE_FINDINGS.md`
  - `ops/refactor/PERF_FINDINGS.md`
  - `ops/refactor/REFACTOR_PLAN.md`
  - `ops/refactor/REFACTOR_LOG.md`
  - `ops/refactor/VERIFICATION.md`
- Validation:
  - `ops/refactor` markdown Prettier passed.
  - Root report/progress markdown Prettier passed.
  - Changed-file format check passed.
  - Scoped `git diff --check` for `ops/refactor/*.md` and the updated progress
    ledgers passed.
- Behavior/safety note:
  - Documentation/state only. No runtime code, API contract, DB schema, RLS,
    auth/authz, audit, billing, medical workflow, external send, dependency,
    production config, deployment, or UI behavior changed.

### 2026-07-01 18:47 JST: Comments Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Comments Structured Logger Convergence`.
- Files changed:
  - `src/app/api/comments/route.ts`
  - `src/app/api/comments/route.test.ts`
- Validation:
  - Focused logger + comments route suite passed `2` files / `35` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `comments` logging returned only test assertions proving
    route contexts have no `error_name`.
  - Comments GET protected matrix passed `3` tests / `372` skipped.
  - Comments POST protected matrix passed `3` tests / `142` skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canViewDashboard` auth, request auth context, collaboration entity
    validation, per-entity access filtering, comment ordering, author-name
    hydration, mention normalization/deduplication, membership recipient
    validation, entity link generation, notification dispatch, realtime
    broadcast, no-store wrapping, and fixed internal-error response were
    preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 18:40 JST: Communication Request Responses Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Communication Request Responses Structured Logger Convergence`.
- Files changed:
  - `src/app/api/communication-requests/[id]/responses/route.ts`
  - `src/app/api/communication-requests/[id]/responses/route.test.ts`
- Validation:
  - Focused logger + communication-request responses route suite passed `2`
    files / `34` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `communication_request_responses` logging returned only
    test assertions proving route contexts have no `error_name`.
  - Communication-request responses GET protected matrix passed `3` tests /
    `372` skipped.
  - Communication-request responses POST protected matrix passed `3` tests /
    `142` skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canReport` auth, request auth context, route-param validation,
    patient/case access filtering, care-report view/write permission gates,
    response listing order, optimistic update conflict behavior, idempotent
    response upsert, audit entry redaction, no-store wrapping, and fixed
    internal-error response were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 18:33 JST: Consent Records Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Consent Records Structured Logger Convergence`.
- Files changed:
  - `src/app/api/consent-records/route.ts`
  - `src/app/api/consent-records/route.test.ts`
- Validation:
  - Focused logger + consent-records route suite passed `2` files / `23`
    tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `consent_records` logging returned only test assertions
    proving route contexts have no `error_name`.
  - Consent-records GET protected matrix passed `3` tests / `372` skipped.
  - Consent-records POST protected matrix passed `3` tests / `142` skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only GET/POST unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, pagination parsing, consent-type
    validation, patient/case assignment filtering, document URL/file
    validation, template selection, duplicate-active-consent guard, RLS org
    context, audit fail-closed behavior, no-store wrapping, and fixed
    internal-error response were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 18:27 JST: Drug Master Imports Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Drug Master Imports Structured Logger Convergence`.
- Files changed:
  - `src/app/api/drug-master-imports/mhlw-price/route.ts`
  - `src/app/api/drug-master-imports/mhlw-price/route.test.ts`
  - `src/app/api/drug-master-imports/mhlw-generic/route.ts`
  - `src/app/api/drug-master-imports/mhlw-generic/route.test.ts`
  - `src/app/api/drug-master-imports/hot/route.ts`
  - `src/app/api/drug-master-imports/hot/route.test.ts`
  - `src/app/api/drug-master-imports/ssk/route.ts`
  - `src/app/api/drug-master-imports/ssk/route.test.ts`
  - `src/app/api/drug-master-imports/pmda/route.ts`
  - `src/app/api/drug-master-imports/pmda/route.test.ts`
  - `src/app/api/drug-master-imports/manual-clinical/route.ts`
  - `src/app/api/drug-master-imports/manual-clinical/route.test.ts`
- Validation:
  - Focused logger + drug-master-import route suite passed `7` files / `86`
    tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `drug_master_imports` logging returned only test
    assertions proving route contexts have no `error_name`.
  - Protected route matrix search found no existing drug-master-import matrix
    entries.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only unexpected-error logging call shape and tests changed.
  - `canAdmin` auth, request auth context, JSON/body validation, allowed import
    source URL policies, dry-run preview branches, import service dispatch,
    manual clinical RLS org context, projected import-log metadata, no-store
    wrapping, and fixed internal-error response were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 18:16 JST: Drug Masters Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Drug Masters Structured Logger Convergence`.
- Files changed:
  - `src/app/api/drug-masters/route.ts`
  - `src/app/api/drug-masters/route.test.ts`
  - `src/app/api/drug-masters/[id]/route.ts`
  - `src/app/api/drug-masters/[id]/route.test.ts`
  - `src/app/api/drug-masters/batch/route.ts`
  - `src/app/api/drug-masters/batch/route.test.ts`
  - `src/app/api/drug-masters/[id]/generic-recommendations/route.ts`
  - `src/app/api/drug-masters/[id]/generic-recommendations/route.test.ts`
  - `src/app/api/drug-masters/[id]/ingredient-group/route.ts`
  - `src/app/api/drug-masters/[id]/ingredient-group/route.test.ts`
  - `src/app/api/drug-masters/[id]/package-insert/route.ts`
  - `src/app/api/drug-masters/[id]/package-insert/route.test.ts`
- Validation:
  - Focused logger + drug-master route suite passed `7` files / `62` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `drug_masters` logging returned only test assertions
    proving route contexts have no `error_name`.
  - Protected route matrix search found no existing drug-master matrix entries.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only unexpected-error logging call shape and tests changed.
  - Auth requirements, request auth context, parameter/query/body validation,
    RLS org context, site validation, drug lookup/search/batch logic, stock
    overlay logic, generic recommendation math, ingredient group summary,
    package insert formatting, no-store wrapping, and fixed internal-error
    response were preserved.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 18:06 JST: Dispense Task Verify Barcode Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dispense Task Verify Barcode Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dispense-tasks/[id]/verify-barcode/route.ts`
  - `src/app/api/dispense-tasks/[id]/verify-barcode/route.test.ts`
- Validation:
  - Focused logger + dispense verify-barcode route + barcode verification
    suite passed `3` files / `22` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `dispense_task_verify_barcode` logging returned only the
    test assertion proving route context has no `error_name`.
  - Protected route matrix search found no existing matrix entry for
    verify-barcode.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only verify-barcode POST unexpected-error logging call shape and tests
    changed.
  - `canDispense` auth, request auth context, route-param validation,
    JSON/body validation, assignment-scope task lookup, task-cycle
    prescription-line lookup, barcode parsing/verification behavior, no-store
    wrapping, and fixed internal-error response were preserved.
  - Sanitized 500 test now asserts the route-supplied logger context excludes
    raw patient, SQL/stack, GTIN, unsafe custom error-name sentinels, and
    route-local `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:59 JST: First Visit Documents Print Batch Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `First Visit Documents Print Batch Structured Logger Convergence`.
- Files changed:
  - `src/app/api/first-visit-documents/print-batch/route.ts`
  - `src/app/api/first-visit-documents/print-batch/route.test.ts`
- Validation:
  - Focused logger + first-visit-documents print-batch route suite passed `2`
    files / `16` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload print-batch `first_visit_documents_print_batch_post`
    logging returned only the test assertion proving route context has no
    `error_name`.
  - First visit documents print-batch POST protected matrix passed `3` tests /
    `142` skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only print-batch POST unexpected-error logging call shape and tests
    changed.
  - `canVisit` auth, request auth context, JSON/body validation,
    selected-document lookup, patient/case assignment filtering,
    print-readiness checks, generated print-batch ID behavior, save-copy URL
    update behavior, optimistic concurrency conflict handling, audit-log field
    shape, no-store wrapping, and fixed internal-error response were preserved.
  - Sanitized 500 test now asserts the route-supplied logger context excludes
    raw first-visit print-batch sentinels, patient-name sentinels, unsafe
    custom error names, and route-local `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:52 JST: First Visit Documents Detail Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `First Visit Documents Detail Structured Logger Convergence`.
- Files changed:
  - `src/app/api/first-visit-documents/[id]/route.ts`
  - `src/app/api/first-visit-documents/[id]/route.test.ts`
- Validation:
  - Focused logger + first-visit-documents detail route suite passed `2` files
    / `29` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload detail `first_visit_documents_id_patch` logging returned
    only the test assertion proving route context has no `error_name`.
  - First visit documents `[id]` PATCH protected matrix passed `6` tests /
    `71` skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only detail PATCH unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, route-param validation, JSON/body
    validation, document URL validation, patient/case assignment filtering,
    writable-patient guard, print-readiness checks, optimistic concurrency
    conflict handling, audit-log field shape, no-store wrapping, and fixed
    internal-error response were preserved.
  - Sanitized 500 test now asserts the route-supplied logger context excludes
    raw first-visit document patch sentinels, patient-name sentinels, unsafe
    custom error names, and route-local `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:44 JST: First Visit Documents Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `First Visit Documents Structured Logger Convergence`.
- Files changed:
  - `src/app/api/first-visit-documents/route.ts`
  - `src/app/api/first-visit-documents/route.test.ts`
- Validation:
  - Focused logger + first-visit-documents route suite passed `2` files / `36`
    tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload collection `first_visit_documents` logging returned no
    matches as expected.
  - First visit documents GET protected matrix passed `3` tests / `372`
    skipped.
  - First visit documents POST protected matrix passed `3` tests / `142`
    skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only collection route unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, patient/case assignment filtering,
    strict query validation, patient write guard, emergency-contact
    fallback/validation, template lookup, document URL validation, audit-log
    field shape, no-store wrapping, and fixed internal-error response were
    preserved.
  - Sanitized 500 tests now assert the route-supplied logger context excludes
    raw first-visit document sentinels, patient-name sentinels, unsafe custom
    error names, and route-local `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:36 JST: Residual Medications Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Residual Medications Structured Logger Convergence`.
- Files changed:
  - `src/app/api/residual-medications/route.ts`
  - `src/app/api/residual-medications/route.test.ts`
- Validation:
  - Focused logger + residual-medications route suite passed `2` files / `30`
    tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `residual_medications` logging returned no matches as
    expected.
  - Residual medications GET protected matrix passed `3` tests / `372`
    skipped.
  - Residual medications POST protected matrix passed `3` tests / `142`
    skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, visit-record assignment filters,
    strict query validation, bounded `limit` validation, inaccessible-scope
    behavior, DrugMaster identity validation, residual create calculations,
    no-store wrapping, and fixed internal-error response were preserved.
  - Sanitized 500 tests now assert the route-supplied logger context excludes
    raw residual medication sentinels, unsafe custom error names, and
    route-local `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:28 JST: Medication Profiles Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Medication Profiles Structured Logger Convergence`.
- Files changed:
  - `src/app/api/medication-profiles/route.ts`
  - `src/app/api/medication-profiles/route.test.ts`
- Validation:
  - Focused logger + medication-profiles route suite passed `2` files / `29`
    tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `medication_profiles` logging returned no matches as
    expected.
  - Medication profiles GET protected matrix passed `3` tests / `372`
    skipped.
  - Medication profiles POST protected matrix passed `3` tests / `142`
    skipped.
  - Scoped Prettier passed; scoped ESLint passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, patient assignment access filters,
    strict query validation, inaccessible-scope behavior, DrugMaster reference
    validation, blank DrugMaster normalization, date normalization,
    `withOrgContext` create behavior, no-store wrapping, and fixed
    internal-error response were preserved.
  - Sanitized 500 tests now assert the route-supplied logger context excludes
    raw medication profile sentinels, unsafe custom error names, and route-local
    `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:21 JST: Medication Issues Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Medication Issues Structured Logger Convergence`.
- Files changed:
  - `src/app/api/medication-issues/route.ts`
  - `src/app/api/medication-issues/route.test.ts`
- Validation:
  - Focused logger + medication-issues route suite passed `2` files / `29`
    tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `medication_issues` logging returned no matches as
    expected.
  - Medication issues GET protected matrix passed `3` tests / `372` skipped.
  - Medication issues POST protected matrix passed `3` tests / `142` skipped.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed; scoped diff-check passed.
  - Full typecheck passed; no-unused passed; full lint passed; full format
    check passed; full diff-check passed; production build passed.
- Behavior/safety note:
  - Only unexpected-error logging call shape and tests changed.
  - `canVisit` auth, request auth context, assignment-scope filters, strict
    query validation, status validation, org reference validation,
    inaccessible-scope behavior, create transaction behavior, no-store
    wrapping, and fixed internal-error response were preserved.
  - Sanitized 500 tests now assert the route-supplied logger context excludes
    raw medication issue sentinels, unsafe custom error names, and route-local
    `error_name`.
- Browser smoke:
  - Skipped intentionally because this slice changes server logging behavior
    and tests only, with no visible DOM layout, copy, or interaction-state
    change.

### 2026-07-01 17:12 JST: Inquiry Records Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Inquiry Records Structured Logger Convergence`.
- Files changed:
  - `src/app/api/inquiry-records/route.ts`
  - `src/app/api/inquiry-records/route.test.ts`
  - `src/app/api/inquiry-records/[id]/route.ts`
  - `src/app/api/inquiry-records/[id]/route.test.ts`
- Validation:
  - focused logger + inquiry-records route suite passed `3` files / `44`
    tests
  - inquiry-records GET protected matrix passed `3` tests / `372` skipped
  - inquiry-records POST protected matrix passed `3` tests / `142` skipped
  - inquiry-records `[id]` PATCH protected matrix passed `6` tests / `71`
    skipped
  - scoped Prettier check passed
  - scoped ESLint passed
  - full diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - production build passed
- Remaining follow-up:
  - Continue with small route-local logger convergence candidates in remaining
    PHI-bearing routes.

### 2026-07-01 17:04 JST: Patient Self Reports Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Patient Self Reports Structured Logger Convergence`.
- Files changed:
  - `src/app/api/patient-self-reports/route.ts`
  - `src/app/api/patient-self-reports/route.test.ts`
- Validation:
  - focused logger + patient-self-reports route suite passed `2` files / `26`
    tests
  - patient-self-reports GET protected matrix passed `3` tests / `372` skipped
  - patient-self-reports POST protected matrix passed `3` tests / `142`
    skipped
  - scoped Prettier check passed
  - scoped ESLint passed
  - full diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - production build passed
- Remaining follow-up:
  - Continue with small route-local logger convergence candidates in remaining
    PHI-bearing routes.

### 2026-07-01 16:55 JST: Shared Logger String Overload Error Redaction Hardening

- Completed observability/privacy refactor follow-up:
  `Shared Logger String Overload Error Redaction Hardening`.
- Files changed:
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Validation:
  - focused logger suite passed `1` file / `10` tests
  - TypeScript AST inventory found `125` `logger.error` calls and `0`
    string/template overload calls with a non-`undefined` second argument
  - neighboring dashboard logger-contract suite passed `5` files / `34` tests
  - scoped Prettier check passed
  - full diff whitespace check passed
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - production build passed
- Remaining follow-up:
  - The raw `Error.message` / `stack` footgun from the previous slice is now
    closed for typed calls and runtime raw-error bypasses.
  - Generic string-overload `ctx` remains intentionally less strict than the
    safe object overload; keep PHI-bearing raw-error logs on
    `logger.error({ event, ... }, err)`.

### 2026-07-01 16:19 JST: Dashboard Monthly Stats Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dashboard Monthly Stats Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dashboard/monthly-stats/route.ts`
  - `src/app/api/dashboard/monthly-stats/route.test.ts`
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Validation:
  - final focused logger + monthly-stats route suite passed `2` files / `19`
    tests
  - focused protected GET matrix for `dashboard/monthly-stats GET` passed `3`
    tests / `372` skipped
  - neighboring dashboard logger-contract suite passed `5` files / `33` tests
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
  - Privacy re-review found no remaining Medium/High issue in this diff and
    confirmed the prior custom-error-name finding is resolved.
  - The shared logger raw-error string-overload footgun was handled in the
    subsequent Shared Logger String Overload Error Redaction Hardening slice.

### 2026-07-01 15:20 JST: Incident Reports Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Incident Reports Structured Logger Convergence`.
- Files changed:
  - `src/app/api/incident-reports/route.ts`
  - `src/app/api/incident-reports/route.test.ts`
  - `src/lib/utils/logger.test.ts`
- Validation:
  - focused logger + incident-reports route suite passed `2` files / `14`
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
  - External observability backend behavior remains outside this code-diff
    scope; final emitted redaction is now also covered by an incident-specific
    shared logger test.
  - Continue with small, tested route-local logger convergence or backend/API
    safety candidates.

### 2026-07-01 15:08 JST: Dashboard Clerk Support Structured Logger Convergence

- Completed observability/privacy refactor follow-up:
  `Dashboard Clerk Support Structured Logger Convergence`.
- Files changed:
  - `src/app/api/dashboard/clerk-support/route.ts`
  - `src/app/api/dashboard/clerk-support/route.test.ts`
- Validation:
  - focused logger + dashboard clerk-support route suite passed `2` files /
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
  - External observability backend behavior remains outside this code-diff
    scope; safe emitted payload behavior remains covered by shared logger
    tests.
  - Continue with small, tested route-local logger convergence or backend/API
    safety candidates.

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

## Executed Slice: Rate Limit Safe Failure Log And Route Catalog Sync

- Timestamp: 2026-07-02 05:52 JST
- Change ID: `RR-BUG-20260702-0552-rate-limit-safe-failure-log`.
- Executed scope:
  - `src/lib/api/rate-limit.ts`
  - `src/lib/api/rate-limit.test.ts`
- Result:
  - DynamoDB rate-limit store failure logging no longer passes raw caught
    `Error` objects to `console.error`.
  - Production fail-closed and non-production memory fallback behavior are
    preserved.
  - `API_ROUTE_TEMPLATES` now includes the live
    `/api/visit-schedules/:id/conflict-reconfirmation` endpoint.
- Validation summary:
  - Red focused regression failed before the fix.
  - Full rate-limit test suite initially caught the missing route template, then
    passed after the catalog entry was added.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, and destructive operations proposal-only unless explicitly
    approved.

## Executed Slice: Daily Job Safe Error Results

- Timestamp: 2026-07-02 05:38 JST
- Change ID: `RR-BUG-20260702-0538-daily-job-safe-errors`.
- Executed scope:
  - `src/server/jobs/daily/shared.ts`
  - `src/server/jobs/daily/orchestrator.ts`
  - `src/server/jobs/daily/visits.ts`
  - `src/server/jobs/daily.test.ts`
- Result:
  - Daily orchestration now returns fixed safe error messages for rejected
    subtasks and fulfilled subtask `errors[]` entries.
  - Direct visit-demand generation job results now sanitize unexpected planner
    / persistence failures while preserving workflow-gate operational tasks.
  - Completed daily job output no longer carries raw PHI/secret-like diagnostic
    text.
- Validation summary:
  - Red focused regressions failed before the fix.
  - Focused safe-error regressions and the full daily job test file passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, and destructive operations proposal-only unless explicitly
    approved.

## Executed Slice: PDF Bulk Export Safe Failure Diagnostics

- Timestamp: 2026-07-02 05:20 JST
- Change ID: `RR-BUG-20260702-0520-pdf-bulk-export-safe-error-log`.
- Executed scope:
  - `src/server/services/pdf-bulk-export.ts`
  - `src/server/services/pdf-bulk-export.test.ts`
  - `src/app/api/jobs/[jobType]/route.ts`
  - `src/app/api/jobs/[jobType]/route.test.ts`
- Result:
  - Unexpected medication-history PDF bulk-export terminal failures now use
    fixed safe diagnostics for persisted failed job logs and requester failure
    notifications.
  - Drain service errors are sanitized, and the drain job API returns
    `errorCount` instead of raw `errors[]`.
  - Cleanup / notification / lock-loss failure paths now use shared safe
    structured logger metadata instead of raw `console.error(..., Error)`.
- Validation summary:
  - Red focused regressions failed before the fix.
  - Focused service/API bundle passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, and destructive operations proposal-only unless explicitly
    approved.

## Executed Slice: Shared Import Safe Error Log Fix

- Timestamp: 2026-07-02 05:05 JST
- Change ID: `RR-BUG-20260702-0505-shared-import-safe-error-log`.
- Executed scope:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
- Result:
  - `withImportLog()` now persists fixed
    `医薬品マスタ取込に失敗しました` text on failed generic drug-master imports
    instead of raw caught importer diagnostics.
  - Original importer exception propagation is preserved, including the edge
    case where failed-log recording itself rejects.
  - Failed failed-log recording emits only safe structured warning metadata.
- Validation summary:
  - Red focused regression failed before the fix.
  - Focused shared/logger tests passed.
  - MHLW/PMDA/HOT/manual service tests and import log/status/route API tests
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, and
    destructive operations proposal-only unless explicitly approved.

## Executed Slice: Secrets Manager Fallback Safe Log

- Timestamp: 2026-07-02 06:06 JST
- Change ID: `RR-BUG-20260702-0606-secrets-safe-fallback-log`.
- Executed scope:
  - `src/lib/config/secrets.ts`
  - `src/lib/config/secrets.test.ts`
- Result:
  - Secrets Manager fallback warnings now omit raw provider exception text and
    configured secret ids.
  - `getSecrets()` logs only fixed event/operation/error-name metadata before
    falling back to environment values.
  - `bootstrapSecretsIntoEnv()` uses the same safe metadata logging pattern for
    unexpected bootstrap failures.
- Validation summary:
  - Red focused regression failed before the fix.
  - Focused safe-log regression and the full secrets config test file passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, production config, and destructive operations proposal-only
    unless explicitly approved.

## Executed Slice: PHOS Lambda Observability Safe Log

- Timestamp: 2026-07-02 06:12 JST
- Change ID: `RR-BUG-20260702-0612-phos-lambda-safe-observability-log`.
- Executed scope:
  - `src/phos/backend/lambda-handler.ts`
  - `src/phos/backend/lambda-handler.test.ts`
  - `src/phos/backend/lambda-observability.ts`
  - `src/phos/backend/lambda-observability.test.ts`
- Result:
  - PHOS Lambda observability flush failures now log safe `error_name`
    metadata instead of raw provider/runtime messages.
  - PHOS security-event persistence failures now log safe `error_name`
    metadata instead of raw DynamoDB/runtime messages.
  - Tests assert that PHI-like and token-like failure text is not copied into
    console JSON.
- Validation summary:
  - Red focused regressions failed before the fix.
  - Focused safe-log regressions and full PHOS Lambda backend test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, production config, and destructive operations proposal-only
    unless explicitly approved.

## Executed Slice: PHOS Evidence Cleanup Safe Principal Log

- Timestamp: 2026-07-02 06:23 JST
- Change ID: `RR-BUG-20260702-0623-phos-evidence-cleanup-safe-principal-log`.
- Executed scope:
  - `src/phos/backend/evidence-upload-verification.ts`
  - `src/phos/backend/evidence-upload-verification.test.ts`
- Result:
  - Default S3 evidence cleanup failure logs now emit hash-only tenant/user
    identifiers instead of raw principal IDs.
  - Cleanup reporter failure logs reuse the same hash-only context.
  - Custom `on_cleanup_failure` callback payloads remain unchanged.
- Validation summary:
  - Red focused regression failed before the fix.
  - Focused safe-principal-log regression and full evidence verifier plus
    structured logger tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, production config, and destructive operations proposal-only
    unless explicitly approved.

## Executed Slice: Security Event Audit Failure Safe Log

- Timestamp: 2026-07-02 06:30 JST
- Change ID: `RR-BUG-20260702-0630-security-event-safe-failure-log`.
- Executed scope:
  - `src/lib/auth/security-events.ts`
  - `src/lib/auth/security-events.test.ts`
- Result:
  - Security-event AuditLog persistence failures now log through the shared safe
    logger object overload instead of legacy raw console arguments.
  - Raw request paths and raw caught database/provider errors are no longer
    copied to the fallback log.
  - Fire-and-forget behavior, deduplication, and AuditLog create payloads remain
    unchanged.
- Validation summary:
  - Red focused regression failed before the fix.
  - Focused safe-failure-log regression and related security-events/logger/auth/RLS
    tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, production config, and destructive operations proposal-only
    unless explicitly approved.

## Executed Slice: Me Profile MFA Failure Safe Log

- Timestamp: 2026-07-02 06:37 JST
- Change ID: `RR-BUG-20260702-0637-me-profile-mfa-safe-failure-log`.
- Executed scope:
  - `src/app/api/me/profile/route.ts`
  - `src/app/api/me/profile/route.test.ts`
- Result:
  - `/api/me/profile` Cognito MFA state lookup failures now log through the
    shared safe logger object overload instead of legacy `console.warn` raw
    errors.
  - Successful profile response behavior and `mfaEnabled: false` fallback remain
    unchanged.
- Validation summary:
  - Red focused regression failed before the fix.
  - Focused safe-failure-log regression and full profile route plus logger tests
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, production config, and destructive operations proposal-only
    unless explicitly approved.

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

## Executed Slice: My Day / Tasks Triage Admin Status Cache Guard

- Timestamp: 2026-07-02 15:46 JST
- Change ID:
  `RR-BUG-20260702-F16-F17-F29-F39-F51-my-day-task-triage`.
- Executed scope:
  - `src/app/(dashboard)/my-day/my-day-content.tsx`
  - `src/app/(dashboard)/my-day/my-day-content.test.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.test.tsx`
- Result:
  - My Day task fetch now requests `/api/tasks?status=open` for the current
    assignee and preserves the client open-status filter as a guard.
  - My Day status-change audit reads use encoded JST midnight date_from values
    and are only visible to admin-capable roles.
  - Status-change rows avoid patient-name audit payloads and encode patient
    links through the shared helper.
  - Tasks immediate summary now counts urgent and high priorities together.
- Validation summary:
  - Focused UI tests, related route tests, scoped lint/format/diff checks,
    full typecheck/no-unused/lint/format/build, and full test suite passed.
  - Full test suite: `1266` files passed / `1` skipped; `12592` tests passed /
    `2` skipped.
- Remaining direction:
  - Continue selecting current production bug/security/privacy/performance
    candidates with focused evidence.
  - Keep schema, RLS/auth semantics, external sends, migrations, billing
    semantics, production config, and destructive operations proposal-only
    unless explicitly approved.
