# REFACTOR_REPORT.md

Snapshot: 2026-07-02 JST

This is the running report for the behavior-preserving CareViaX / PH-OS
refactor loop. It records only work backed by current repository evidence and
validation output.

## Repository

- Repository: `careviax` / `ph-os`
- Refactor mode: behavior-preserving, small-slice execution
- Phase 0 artifacts:
  - `REFACTOR_REPOSITORY_INVENTORY.md`
  - `REFACTOR_RISK_MAP.md`
  - `REFACTOR_EXECUTION_PLAN.md`
  - `ops/refactor/*`

## Slice: Offline Lifecycle Sync Queue And Evidence Retry

- Timestamp: 2026-07-02 16:34 JST
- Purpose:
  - Make offline visit-record queue dedupe deterministic without losing
    residual-medication observations or conflict snapshots.
  - Make evidence draft retry reset/gallery retry tenant-scoped and recover
    retry-exhausted drafts safely.
- Changed files:
  - `src/lib/stores/offline-db.ts`
  - `src/lib/stores/sync-engine.ts`
  - `src/lib/stores/sync-engine.test.ts`
  - `src/lib/offline/evidence-drafts.ts`
  - `src/lib/offline/evidence-drafts.test.ts`
  - `src/app/(dashboard)/visits/evidence/evidence-gallery-content.tsx`
  - `src/app/(dashboard)/visits/evidence/evidence-gallery-content.test.tsx`
  - `src/app/(dashboard)/visits/[id]/capture/capture-content.tsx`
  - `src/app/(dashboard)/visits/[id]/capture/capture-content.test.tsx`
  - `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`
  - `src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`
- Change reason:
  - CE14 found same-schedule visit-record queue rows were append-only.
  - N25 found retry-exhausted evidence drafts had no recovery path.
  - Reviews found org-scoping, server refetch, active-run race, and tie-breaker
    test gaps that needed direct coverage.
- Commonized processing:
  - Added small scope-resolution helpers for sync queue enqueue behavior.
  - Added org-scoped evidence draft summary/sync/reset APIs and gallery retry
    orchestration.
- Safety:
  - Evidence draft list/sync/reset now requires exact org match; legacy
    org-missing drafts fail closed.
  - Capture does not persist evidence drafts without org identity.
  - Residual medication remains append-only and `server_conflict` rows are
    preserved.
  - Unexpected sync queue errors persist/log fixed generic text.
  - No auth, RLS, DB schema/migration, external send, billing, production
    config, secrets, deployment, dependency versions, or destructive operations
    changed.
- Performance:
  - No performance optimization claimed. Org filtering reuses existing indexes
    and predicates to avoid migration scope.
- Validation:
  - Focused offline/evidence/sync bundle passed `5` files / `65` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm build`: passed.
  - `pnpm format:check`: failed only on unrelated existing dirty
    `.agent-loop/FEATURE_QUEUE.md`; touched files passed scoped Prettier.
  - gbrain write/readback passed for
    `projects/careviax/decisions/2026-07-02/offline-lifecycle-sync-queue-evidence-retry`.
- Known risks:
  - Browser smoke was not run because this slice is covered by jsdom/unit
    regressions plus production build and changes no navigation route.
  - Sync queue rows still rely on runtime org context at drain time rather than
    row-level org metadata.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external send
    semantics, billing, medication identity, production config, secrets,
    deployment, dependency versions, and destructive operations.

## Slice: Rate Limit Safe Failure Log And Route Catalog Sync

- Timestamp: 2026-07-02 05:52 JST
- Purpose:
  - Prevent raw DynamoDB rate-limit failure diagnostics from being written to
    production logs.
  - Keep the rate-limit route template catalog synchronized with the current
    App Router API tree.
- Changed files:
  - `src/lib/api/rate-limit.ts`
  - `src/lib/api/rate-limit.test.ts`
- Change reason:
  - The production fail-closed DynamoDB rate-limit branch passed raw caught
    `Error` objects to `console.error`.
  - The existing route catalog sync regression showed that
    `/api/visit-schedules/[id]/conflict-reconfirmation` was live but missing
    from `API_ROUTE_TEMPLATES`.
- Deleted code:
  - Removed raw caught exception-object logging from DynamoDB rate-limit failure
    handling.
- Commonized processing:
  - Added a local Edge-compatible safe failure logger for rate-limit store
    failures. It records fixed event/operation fields and `error_name` only.
- Safety:
  - Production still denies requests when the distributed store is unavailable.
  - Non-production still falls back to the in-memory store.
  - Rate-limit quota values, proxy response shape, auth/authz semantics, route
    implementations, DB schema/migrations, external sends, billing, production
    config, secrets, deployment, and destructive operations remain unchanged.
- Performance:
  - Failure-path metadata construction only.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix.
  - Full rate-limit suite passed `1` file / `33` tests after the route catalog
    entry was added.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this proxy/rate-limit behavior fix changes
    no DOM layout, navigation, or human workflow shape.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external send
    semantics, billing, medication identity, production config, secrets,
    deployment, dependency versions, and destructive operations.

## Slice: Daily Job Safe Error Results

- Timestamp: 2026-07-02 05:38 JST
- Purpose:
  - Prevent raw caught daily job diagnostics from being returned or persisted in
    completed job `errors[]`.
  - Preserve daily job partial-failure visibility without exposing provider,
    Prisma, storage, token-like, infrastructure, or PHI-like details.
- Changed files:
  - `src/server/jobs/daily/shared.ts`
  - `src/server/jobs/daily/orchestrator.ts`
  - `src/server/jobs/daily/visits.ts`
  - `src/server/jobs/daily.test.ts`
- Change reason:
  - `runDailyOperations()` copied rejected subtask `Error.message` text into its
    aggregate `errors[]` and passed fulfilled subtask `errors[]` through
    unchanged.
  - `generateVisitDemands()` returned raw caught planner / persistence
    diagnostics in its direct job result.
  - Completed job results are persisted by `runJob()` and can be returned by
    `/api/jobs/[jobType]`.
- Deleted code:
  - Removed raw caught exception-message serialization from daily job returned
    error results.
- Commonized processing:
  - Added `getSafeDailyOperationErrorMessage()` in the daily shared job module.
  - Reused the fixed safe message for daily orchestration and unexpected visit
    demand generation errors.
- Safety:
  - Regression tests prove PHI/secret-like sentinels do not reach returned daily
    job result JSON.
  - The existing visit workflow-gate operational task path remains actionable.
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external
    sends, billing, production config, secrets, deployment, and destructive
    operations remain unchanged.
- Performance:
  - Failure-path string mapping only.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regressions failed before the fix.
  - Focused safe-error regressions passed.
  - Full daily job test file passed `1` file / `41` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this server job result fix changes no DOM
    layout, navigation, or human workflow shape.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external send
    semantics, billing, medication identity, production config, secrets,
    deployment, dependency versions, and destructive operations.

## Slice: PDF Bulk Export Safe Failure Diagnostics

- Timestamp: 2026-07-02 05:20 JST
- Purpose:
  - Prevent raw terminal medication-history PDF bulk-export exception text from
    being persisted, notified, returned by drain APIs, or printed to service
    logs.
  - Preserve expected workflow failure messages and original exception
    propagation.
- Changed files:
  - `src/server/services/pdf-bulk-export.ts`
  - `src/server/services/pdf-bulk-export.test.ts`
  - `src/app/api/jobs/[jobType]/route.ts`
  - `src/app/api/jobs/[jobType]/route.test.ts`
- Change reason:
  - The terminal export catch copied raw caught `Error.message` into
    `integrationJob.error_log` and failure notifications.
  - Queue drain returned raw failure messages in `errors[]`, and the job runner
    route spread those errors into API responses.
  - Cleanup and notification best-effort failures used raw
    `console.error(..., Error)` logging.
- Deleted code:
  - Removed raw caught exception-message serialization from unexpected PDF
    bulk-export terminal failure diagnostics.
  - Removed raw drain `errors[]` exposure from the medication-history
    bulk-export drain HTTP response.
- Commonized processing:
  - Added `getSafeBulkExportFailureMessage()` for safe persisted/returned
    messages.
  - Reused the existing shared safe structured logger overload for cleanup,
    lock-loss, ready-notification, and failure-notification diagnostics.
- Safety:
  - Regression tests prove PHI/secret/storage URL sentinels do not reach
    persisted failed job logs, notifications, drain service results, drain API
    responses, or structured logger context.
  - Expected `MedicationHistoryBulkExportError` messages remain user-actionable.
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external
    sends, billing, production config, secrets, deployment, and destructive
    operations remain unchanged.
- Performance:
  - Failure-path helper logic and logger calls only.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regressions failed before the fix.
  - Focused service/API bundle passed `4` files / `60` tests.
  - Scoped ESLint, Prettier, and diff-check for changed/adjacent files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this server/API diagnostics fix changes no
    DOM layout, navigation, or human workflow shape.
  - `/api/jobs/[jobType]` intentionally changed the bulk-export drain success
    body from raw `errors[]` to `errorCount`; focused API tests cover this.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external send
    semantics, billing, medication identity, production config, secrets,
    deployment, dependency versions, and destructive operations.

## Slice: Shared Import Safe Error Log Fix

- Timestamp: 2026-07-02 05:05 JST
- Purpose:
  - Prevent raw generic drug-master importer exception text from being
    persisted in `drugMasterImportLog.error_log`.
  - Preserve importer failure propagation, failed import status recording, and
    existing route/status/log API behavior.
- Changed files:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
- Change reason:
  - `withImportLog()` is shared by MHLW price/generic, PMDA, HOT, and manual
    clinical import services.
  - Its catch block copied raw `error.message` into the failed import log row,
    and that log data is operator/API-visible.
  - A secondary failed-log update rejection could also mask the original
    importer exception.
- Deleted code:
  - Removed raw caught exception-message serialization from generic persisted
    import failure logs.
- Commonized processing:
  - Added one fixed generic import failure diagnostic:
    `医薬品マスタ取込に失敗しました`.
  - Reused safe structured logger warning metadata when failed-log recording
    itself fails.
- Safety:
  - The regressions prove persisted failed import logs exclude secret-like /
    PHI-like sentinel values and preserve the original importer exception.
  - Failed failed-log update diagnostics include only event, operation,
    file-purpose, and provider metadata in logger context.
  - MHLW/PMDA/HOT/manual import success logging, source URL/hash metadata,
    record counts, route/status/log API contracts, DB schema/migrations/RLS,
    auth/authz logic, audit semantics, production config, secrets, deployment,
    and destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
  - The extra warning branch runs only if failed import-log recording itself
    rejects.
- Validation:
  - Initial focused regression failed before the fix because persisted
    `error_log` included secret-like / PHI-like importer failure text.
  - Focused shared import plus logger tests passed `2` files / `33` tests.
  - Shared/MHLW/PMDA/HOT/manual service plus logger tests passed `6` files /
    `83` tests.
  - Import log/status and MHLW/PMDA/HOT/manual route tests passed `7` files /
    `94` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/shared-import-log-raw-error-log`:
    passed.
- Known risks:
  - Browser smoke was not run because this service diagnostics fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, external sends, production config, secrets, deployment, and
    dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled rejection,
    stale listener, persisted-error privacy leaks, or query inefficiency.

## Slice: SSK Import Safe Error Log Fix

- Timestamp: 2026-07-02 04:50 JST
- Purpose:
  - Prevent raw SSK import/upsert exception text from being persisted in
    `drugMasterImportLog.error_log`.
  - Preserve import failure propagation and the existing job/route behavior.
- Changed files:
  - `src/server/services/drug-master-import/ssk.ts`
  - `src/server/services/drug-master-import/ssk.test.ts`
- Change reason:
  - `importSskDrugMaster()` caught import failures and copied
    `error.message` into the failed import log row.
  - SSK import failures can originate from external fetch, ZIP parsing, or DB
    upserts, so raw messages can include token-like, infrastructure, YJ-code, or
    PHI-like details.
- Deleted code:
  - Removed raw caught exception-message serialization from persisted SSK import
    failure logs.
- Commonized processing:
  - Added one fixed SSK import failure diagnostic:
    `SSK取込に失敗しました`.
- Safety:
  - The regression proves persisted failed import logs exclude secret-like /
    PHI-like sentinel values.
  - Running log creation, failed status update, original exception rethrow,
    successful import logging, source ZIP/hash handling, upsert behavior, DB
    schema/migrations/RLS, auth/authz logic, audit semantics, production config,
    secrets, deployment, and destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because persisted
    `error_log` included secret-like / PHI-like import failure text.
  - `pnpm vitest run src/server/services/drug-master-import/ssk.test.ts --testNamePattern "safe failure message" --reporter=dot --testTimeout=60000`:
    passed.
  - `pnpm vitest run src/server/services/drug-master-import/ssk.test.ts --reporter=dot --testTimeout=60000`:
    passed, `1` file / `9` tests.
  - `pnpm vitest run src/app/api/drug-master-imports/ssk/route.test.ts src/server/jobs/drug-master.test.ts --reporter=dot --testTimeout=60000`:
    passed, `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/ssk-import-raw-error-log`:
    passed.
- Known risks:
  - Browser smoke was not run because this service diagnostics fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled rejection,
    stale listener, persisted-error privacy leaks, or query inefficiency
    evidence.

## Slice: File Storage Safe Cleanup Errors Fix

- Timestamp: 2026-07-02 04:36 JST
- Purpose:
  - Prevent raw S3/DB deletion exception text from surfacing in expired
    generated-file cleanup results.
  - Preserve cleanup failure observability through failure counts and the
    existing safe structured warning.
- Changed files:
  - `src/server/services/file-storage.ts`
  - `src/server/services/file-storage.test.ts`
- Change reason:
  - `cleanupExpiredGeneratedFiles()` accumulated raw `Error.message` /
    `String(error)` text in its returned `errors[]`.
  - The helper is used by the medication-history bulk-export cleanup job
    wrapper, so operational callers could receive deletion exception details.
- Deleted code:
  - Removed raw caught deletion exception-message serialization from returned
    cleanup errors.
- Commonized processing:
  - Added one fixed cleanup failure diagnostic:
    `保持期限切れファイルの削除に失敗しました`.
- Safety:
  - The regression proves returned cleanup errors exclude secret-like / PHI-like
    sentinel values.
  - Cleanup pagination, deletion attempts, processed/scanned counts, warning
    counts, DB schema/migrations/RLS, auth/authz logic, audit semantics,
    production config, secrets, deployment, and destructive-operation boundaries
    remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because returned cleanup
    errors included secret-like / PHI-like deletion failure text.
  - `pnpm vitest run src/server/services/file-storage.test.ts --testNamePattern "sanitized partial failures" --reporter=dot --testTimeout=60000`:
    passed.
  - `pnpm vitest run src/server/services/file-storage.test.ts --reporter=dot --testTimeout=60000`:
    passed, `1` file / `72` tests.
  - `pnpm vitest run src/server/services/file-storage.test.ts src/server/services/pdf-bulk-export.test.ts src/app/api/patients/medications/bulk-export/route.test.ts --reporter=dot --testTimeout=60000`:
    passed, `3` files / `101` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/file-storage-raw-cleanup-errors`:
    passed.
- Known risks:
  - Browser smoke was not run because this server service diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
  - `pnpm build` was not rerun for this narrow backend-service slice; the latest
    full build evidence remains the preceding visit-planner slice.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled rejection,
    stale listener, persisted-error privacy leaks, or query inefficiency
    evidence.

## Slice: Visit Planner Safe Evaluation Diagnostics Fix

- Timestamp: 2026-07-02 04:29 JST
- Purpose:
  - Prevent raw road-routing or evaluation helper exception text from surfacing
    in visit schedule proposal rejected diagnostics.
  - Preserve candidate rejection classification and proposal generation behavior.
- Changed files:
  - `src/server/services/visit-schedule-planner.ts`
  - `src/server/services/visit-schedule-planner.test.ts`
- Change reason:
  - The candidate evaluation catch path appended raw `error.message` to
    `diagnostics.rejected[].detail` for `reason_code: evaluation_error`.
- Deleted code:
  - Removed raw caught evaluation exception-message serialization from planner
    diagnostics.
- Commonized processing:
  - Reused the fixed Japanese evaluation failure detail for all unexpected
    candidate evaluation exceptions.
- Safety:
  - The regression proves rejected diagnostics exclude secret-like / PHI-like
    sentinel values.
  - Candidate acceptance/rejection scoring, `reason_code`, `reason_label`, travel
    limit distinction, route ordering, proposal result shape, DB schema/migrations
    /RLS, auth/authz logic, audit semantics, production config, secrets,
    deployment, and destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job, broad
    scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because rejected diagnostics
    included secret-like / PHI-like evaluation failure text.
  - `pnpm vitest run src/server/services/visit-schedule-planner.test.ts --testNamePattern "evaluation_error" --reporter=dot --testTimeout=60000`:
    passed.
  - `pnpm vitest run src/server/services/visit-schedule-planner.test.ts --reporter=dot --testTimeout=60000`:
    passed, `1` file / `45` tests.
  - `pnpm vitest run src/server/services/visit-schedule-planner.test.ts src/app/api/visit-schedule-proposals/route.test.ts 'src/app/api/visit-schedule-proposals/[id]/route.test.ts' --reporter=dot --testTimeout=60000`:
    passed, `3` files / `209` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/visit-schedule-planner-raw-evaluation-diagnostics`:
    passed.
- Known risks:
  - Browser smoke was not run because this service diagnostics fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled rejection,
    stale listener, persisted-error privacy leaks, or query inefficiency
    evidence.

## Slice: Offline Sync Safe Diagnostics Fix

- Timestamp: 2026-07-02 04:17 JST
- Purpose:
  - Prevent raw unexpected offline sync failure text from being persisted in
    plaintext `syncQueue.lastError`.
  - Prevent automatic online-sync failures from logging raw error objects.
- Changed files:
  - `src/lib/stores/sync-engine.ts`
  - `src/lib/stores/sync-engine.test.ts`
- Change reason:
  - `processSyncQueueOnce()` used safe fixed strings for malformed payload, HTTP
    status, and conflict branches, but its broad catch persisted arbitrary
    `Error.message` text.
  - `setupAutoSync()` logged the raw caught error object.
- Deleted code:
  - Removed raw caught sync exception-message persistence and raw automatic sync
    warning output.
- Commonized processing:
  - Added a fixed `同期に失敗しました` diagnostic for unexpected offline sync
    queue failures.
- Safety:
  - The regressions prove persisted update payloads and console warnings exclude
    secret-like / PHI-like sentinels.
  - Retry counting, malformed payload handling, HTTP status/conflict handling,
    conflict snapshot encryption, queue single-flight behavior, UI display model
    pass-through, DB schema/migrations/RLS, auth/authz logic, audit semantics,
    production config, secrets, deployment, and destructive-operation boundaries
    remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job, broad
    scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regressions failed before the fix because `lastError` and
    `console.warn` contained secret-like / PHI-like failure text.
  - `pnpm vitest run src/lib/stores/sync-engine.test.ts --testNamePattern "generic lastError|safe automatic sync failure" --reporter=dot --testTimeout=30000`:
    passed.
  - `pnpm vitest run src/lib/stores/sync-engine.test.ts --reporter=dot --testTimeout=30000`:
    passed, `1` file / `18` tests.
  - `pnpm vitest run src/app/'(dashboard)'/offline-sync/offline-sync.shared.test.ts src/lib/stores/offline-store.test.ts --reporter=dot --testTimeout=30000`:
    passed, `2` files / `15` tests.
  - Scoped ESLint, Prettier, and diff-check for changed files: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/offline-sync-raw-diagnostics`:
    passed.
- Known risks:
  - Browser smoke was not run because this client utility diagnostics fix changes
    no visible DOM layout, copy, navigation, route contract shape, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled rejection,
    stale listener, persisted-error privacy leaks, or query inefficiency
    evidence.

## Slice: Realtime Listener Safe Diagnostics Fix

- Timestamp: 2026-07-02 04:05 JST
- Purpose:
  - Prevent raw shared realtime event/status listener failure text from being
    written to browser console diagnostics.
  - Preserve shared SSE stream continuity and listener isolation.
- Changed files:
  - `src/lib/realtime/shared-event-stream.ts`
  - `src/lib/realtime/shared-event-stream.test.ts`
- Change reason:
  - `logRealtimeListenerError()` correctly kept one throwing listener from
    breaking the shared stream, but logged `error.message` / `String(error)`
    directly.
- Deleted code:
  - Removed raw listener exception-message serialization from realtime shared
    stream diagnostics.
- Commonized processing:
  - Added a fixed realtime listener failure diagnostic for this shared stream
    helper.
- Safety:
  - The regression proves console diagnostics exclude secret-like / PHI-like
    listener failure text.
  - Shared stream URL construction, presence target serialization, reconnect
    timing, listener isolation, stream sharing, route behavior, DB schema
    /migrations/RLS, auth/authz logic, audit semantics, production config,
    secrets, deployment, and destructive-operation boundaries remain
    unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because console diagnostics
    included secret-like / PHI-like listener failure text.
  - `pnpm vitest run src/lib/realtime/shared-event-stream.test.ts --testNamePattern "isolates listener exceptions"`:
    passed.
  - `pnpm vitest run src/lib/realtime/shared-event-stream.test.ts`: passed,
    `1` file / `4` tests.
  - `pnpm vitest run src/lib/realtime/shared-event-stream.test.ts src/lib/hooks/use-realtime-events.test.ts src/lib/hooks/use-realtime-query.test.ts src/lib/hooks/use-realtime-invalidation.test.ts --reporter=dot --testTimeout=30000`:
    passed, `3` files / `14` tests.
  - Scoped ESLint, Prettier, and diff-check for changed helper/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/realtime-shared-stream-raw-listener-diagnostics`:
    passed.
- Known risks:
  - Browser smoke was not run because this shared client utility diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: CloudWatch Safe Metric Failure Log Fix

- Timestamp: 2026-07-02 03:56 JST
- Purpose:
  - Prevent raw CloudWatch/AWS/runtime metric send failure text from being
    written to console diagnostics.
  - Preserve best-effort metric emission so metrics failures never break
    request paths.
- Changed files:
  - `src/lib/aws/cloudwatch.ts`
  - `src/lib/aws/cloudwatch.test.ts`
- Change reason:
  - `putMetrics()` swallowed CloudWatch send errors as intended, but logged
    `err.message` / raw thrown values to `console.error`.
- Deleted code:
  - Removed raw CloudWatch send failure-message serialization from metrics
    helper console diagnostics.
- Commonized processing:
  - Added a fixed CloudWatch metric emission failure message for this helper.
- Safety:
  - The regression proves console diagnostics exclude secret-like provider
    failure text.
  - Metric batching, AWS regional client caching, timeout wrapper usage,
    caller-safe swallowing behavior, flush route behavior, DB schema/migrations
    /RLS, auth/authz logic, audit semantics, production config, secrets,
    deployment, and destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because console diagnostics
    included secret-like provider failure text.
  - `pnpm vitest run src/lib/aws/cloudwatch.test.ts --testNamePattern "swallows CloudWatch send errors"`:
    passed.
  - `pnpm vitest run src/lib/aws/cloudwatch.test.ts`: passed, `1` file / `3`
    tests.
  - `pnpm vitest run src/lib/aws/cloudwatch.test.ts src/app/api/jobs/flush-metrics/route.test.ts src/app/api/admin/flush-metrics/route.test.ts --reporter=dot --testTimeout=30000`:
    passed, `3` files / `8` tests.
  - Scoped ESLint, Prettier, and diff-check for changed helper/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/cloudwatch-metrics-raw-failure-log`:
    passed.
- Known risks:
  - Browser smoke was not run because this backend utility diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, request-path
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: Job Runner Safe Failure Diagnostics Fix

- Timestamp: 2026-07-02 03:45 JST
- Purpose:
  - Prevent raw background job failure text from being persisted in
    `integrationJob.error_log`, sent to admins, or printed in cleanup-failure
    diagnostics.
  - Preserve retry behavior and original error propagation to callers.
- Changed files:
  - `src/server/jobs/runner.ts`
  - `src/server/jobs/runner.test.ts`
- Change reason:
  - `runJobOnce()` derived `errorMessage` from `err.message` / `String(err)`
    and copied it into retry rows, final failed rows, admin notifications, and
    cleanup console output.
  - The jobs API route masked list responses, but runner persistence and
    notifications were still raw.
- Deleted code:
  - Removed raw caught job failure-message serialization from runner
    persistence, admin notifications, and cleanup diagnostics.
- Commonized processing:
  - Added fixed runner diagnostics for job execution failure, cleanup failure,
    and admin notification copy.
- Safety:
  - The regressions prove update payloads, admin notification payloads, and
    cleanup console diagnostics exclude secret-like / PHI-like sentinels.
  - `runJob()` still throws the original error after retries so route-level
    existing error handling remains authoritative.
  - Job creation, retry count, final failure status, locking, dedupe behavior,
    admin membership lookup, DB schema/migrations/RLS, auth/authz logic, audit
    semantics, external sends, production config, secrets, deployment, and
    destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because runner update
    payloads and cleanup logs contained raw secret-like / PHI-like text.
  - `pnpm vitest run src/server/jobs/runner.test.ts --testNamePattern "fixed job failure|cleanup status update"`:
    passed.
  - `pnpm vitest run src/server/jobs/runner.test.ts`: passed, `1` file / `7`
    tests.
  - `pnpm vitest run src/server/jobs/runner.test.ts 'src/app/api/jobs/[jobType]/route.test.ts' src/app/api/jobs/route.test.ts --reporter=dot --testTimeout=30000`:
    passed, `3` files / `38` tests.
  - Scoped ESLint, Prettier, and diff-check for changed runner/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/job-runner-raw-failure-diagnostics`:
    passed.
- Known risks:
  - Browser smoke was not run because this backend runner diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: Outbound Webhook Safe Result Fix

- Timestamp: 2026-07-02 03:26 JST
- Purpose:
  - Prevent outbound webhook delivery results, persisted delivery errors, and
    retry summaries from carrying raw registered URL query secrets or raw
    fetch/runtime exception text.
  - Preserve actual dispatch behavior and retry semantics.
- Changed files:
  - `src/server/services/outbound-webhook.ts`
  - `src/server/services/outbound-webhook.test.ts`
- Change reason:
  - `dispatchToEndpoint()` returned `WebhookDeliveryResult.url` as the raw
    registered webhook URL even though pending delivery persistence already
    redacted the display URL.
  - The catch path returned `err.message` / `String(err)` in `result.error` and
    persisted it through `recordWebhookDeliveryResult()`.
- Deleted code:
  - Removed raw registered webhook URL exposure from returned delivery results.
  - Removed raw dispatch exception-message serialization from returned and
    persisted delivery failures.
- Commonized processing:
  - Reused `redactWebhookUrlForDisplay()` for `WebhookDeliveryResult.url`.
  - Added a fixed safe dispatch failure message, `Webhook delivery failed`.
- Safety:
  - The regressions prove returned result JSON and persisted update arguments
    exclude secret-like sentinels.
  - HTTP dispatch still uses the registered raw URL, so partner endpoint
    compatibility is preserved.
  - Unsafe-destination blocking, redirect non-following, encrypted webhook
    secret signing, first-attempt concurrency, retry claiming, and blocked
    malformed persisted payload behavior remain unchanged.
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, external send
    decision semantics, production config, secrets, deployment, and
    destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because result URLs
    included query secrets and dispatch failures returned raw exception text.
  - `pnpm vitest run src/server/services/outbound-webhook.test.ts --testNamePattern "redacted delivery URLs|fixed delivery failure messages"`:
    passed.
  - `pnpm vitest run src/server/services/outbound-webhook.test.ts`: passed,
    `1` file / `21` tests.
  - `pnpm vitest run src/server/services/outbound-webhook.test.ts 'src/app/api/jobs/[jobType]/route.test.ts' --reporter=dot --testTimeout=30000`:
    passed, `2` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/outbound-webhook-raw-delivery-result`:
    passed.
- Known risks:
  - Browser smoke was not run because this backend service result-safety fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: Health-Check DB/S3 Safe Error Fix

- Timestamp: 2026-07-02 03:18 JST
- Purpose:
  - Keep backend health-check down status visible while preventing raw
    database/AWS/runtime exception messages from flowing into health results.
  - Preserve success and unconfigured skip behavior.
- Changed files:
  - `src/server/services/health-check.ts`
  - `src/server/services/health-check.test.ts`
- Change reason:
  - `checkDatabase()` and `checkS3()` returned `err.message` / `String(err)`
    directly in `CheckResult.message`.
- Deleted code:
  - Removed raw database/AWS/runtime error-message serialization from these
    health check results.
- Commonized processing:
  - Added fixed safe DB and S3 health-check failure messages.
  - Added regressions that assert sentinel strings are absent from result JSON.
- Safety:
  - Result status remains `down` on DB/S3 failure.
  - Successful DB/S3 checks, S3 unconfigured skip behavior, S3 regional client
    caching, and aggregate health status behavior remain unchanged.
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, AWS request
    semantics, external sends, production config, secrets, deployment, and
    destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because DB and S3 checks
    returned raw failure text.
  - `pnpm vitest run src/server/services/health-check.test.ts --testNamePattern "safe fixed"`: passed.
  - `pnpm vitest run src/server/services/health-check.test.ts`: passed,
    `1` file / `7` tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/health-check-db-s3-raw-error-message`: passed.
- Known risks:
  - Browser smoke was not run because this backend service response-safety fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: Backup Monitor AWS Check Safe Error Fix

- Timestamp: 2026-07-02 03:10 JST
- Purpose:
  - Keep backup monitor configured failure state visible while preventing raw
    AWS/runtime provider messages from flowing into check results or logger
    error objects.
  - Preserve success, warning, and unconfigured skip behavior.
- Changed files:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
- Change reason:
  - RDS, S3 versioning, audit archive lifecycle, and Cognito check catch blocks
    returned `err.message` / `String(err)` directly.
  - They also passed the raw provider error object to the logger.
- Deleted code:
  - Removed raw provider error-message serialization from backup monitor check
    results.
  - Removed raw provider error object logging from these check catch paths.
- Commonized processing:
  - Added fixed per-check safe messages and a small internal safe-error marker
    so the RDS SDK import failure can keep its dedicated fixed message.
  - Reused the existing log call shape while passing a new fixed-message
    `Error`.
- Safety:
  - The regression proves result messages and logger error arguments exclude
    secret-like sentinels.
  - Configured check failures still return `status: 'error'`, so aggregate
    backup health remains non-ok.
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, AWS request
    semantics, external sends, production config, secrets, deployment, and
    destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because RDS returned the
    raw AWS failure message.
  - `pnpm vitest run src/server/services/backup-monitor.test.ts --testNamePattern "safe fixed messages"`: passed.
  - `pnpm vitest run src/server/services/backup-monitor.test.ts`: passed,
    `1` file / `8` tests.
  - `pnpm vitest run src/server/services/backup-monitor.test.ts src/app/api/health/route.test.ts --reporter=dot --testTimeout=30000`: passed,
    `2` files / `13` tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/backup-monitor-aws-check-raw-error-message`: passed.
- Known risks:
  - Browser smoke was not run because this backend service response-safety fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: Health Backup Monitor Raw Error Response Fix

- Timestamp: 2026-07-02 03:00 JST
- Purpose:
  - Keep admin health backup failure status visible while preventing raw backup
    monitor exception messages from reaching route JSON.
  - Preserve public liveness and admin detail gating behavior.
- Changed files:
  - `src/app/api/health/route.ts`
  - `src/app/api/health/route.test.ts`
- Change reason:
  - The backup-monitor route catch returned `error.message` in
    `checks.backups.message`.
  - Admin-only diagnostics can still leak secret-like or infrastructure details
    if raw operational exceptions are serialized.
- Deleted code:
  - Removed direct `error.message` response serialization from the backup
    monitor catch.
- Commonized processing:
  - Added a route-local fixed safe message constant and used it for backup
    monitor rejection responses.
  - Updated the route regression to assert the raw sentinel is absent from the
    JSON response.
- Safety:
  - Public unauthenticated health remains cheap and does not run DB or backup
    checks.
  - Admin backup monitor failures still return degraded/error status with a
    fixed safe message.
  - DB readiness behavior, backup monitor invocation timing, route status-code
    behavior, DB schema/migrations/RLS, auth/authz logic, audit semantics,
    external sends, production config, secrets, deployment, and destructive
    operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused regression failed before the fix because the route returned
    the raw backup monitor exception message.
  - `pnpm vitest run src/app/api/health/route.test.ts --testNamePattern "raw backup monitor errors"`: passed.
  - `pnpm vitest run src/app/api/health/route.test.ts src/server/services/backup-monitor.test.ts --reporter=dot --testTimeout=30000`: passed,
    `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check for changed route/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/health-backup-monitor-raw-error-response`: passed.
- Known risks:
  - Browser smoke was not run because this API response-safety fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with raw operational
    error exposure, false-green health checks, empty catch, unhandled
    rejection, stale listener, persisted-error privacy leaks, or query
    inefficiency evidence.

## Slice: Backup Monitor RDS Import Failure Fix

- Timestamp: 2026-07-02 02:50 JST
- Purpose:
  - Keep unconfigured local backup checks cheap/skipped while ensuring a
    configured RDS backup monitor cannot go false-green when the RDS SDK fails
    to load.
  - Preserve the existing RDS snapshot query path when the SDK loads
    successfully.
- Changed files:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
- Change reason:
  - `loadRdsModule()` converted dynamic `@aws-sdk/client-rds` import failure
    to cached `null`.
  - `checkRdsSnapshot()` then returned `status: 'skipped'` /
    `@aws-sdk/client-rds not installed` even when `RDS_DB_INSTANCE_ID` was
    configured, allowing `runBackupMonitorChecks()` to stay `overall: 'ok'`.
- Deleted code:
  - Removed the `catch(() => null)` dependency-load fallback and the
    `!rdsModule || !client` skip branch for configured RDS monitoring.
- Commonized processing:
  - Kept failure handling inside the existing `checkRdsSnapshot()` error path.
  - Added an isolated module regression that mocks an RDS SDK load failure and
    proves the individual check and aggregate monitor both fail closed.
- Safety:
  - Missing `RDS_DB_INSTANCE_ID` still returns the original local-environment
    `skipped` result.
  - The regression proves returned/logged import failure diagnostics use a
    fixed safe message and do not include the raw token-like sentinel or the
    original import error object.
  - DB schema/migrations/RLS, auth/authz logic, audit semantics, AWS request
    semantics, external sends, production config, secrets, deployment, and
    destructive-operation boundaries remain unchanged.
- Performance:
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
  - Failed RDS module loads clear the cached promise so later checks can retry
    instead of permanently caching a skip.
- Validation:
  - Initial focused regression failed before the fix because configured RDS SDK
    import failure returned `status: 'skipped'`.
  - `pnpm vitest run src/server/services/backup-monitor.test.ts --testNamePattern "configured RDS monitoring cannot load"`: passed.
  - `pnpm vitest run src/server/services/backup-monitor.test.ts`: passed,
    `1` file / `7` tests.
  - `pnpm vitest run src/server/services/backup-monitor.test.ts src/app/api/health/route.test.ts --reporter=dot --testTimeout=30000`: passed,
    `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/backup-monitor-rds-import-false-green`: passed.
- Known risks:
  - Browser smoke was not run because this backend monitoring semantics fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with false-green health
    checks, raw operational error exposure, empty catch, unhandled rejection,
    stale listener, persisted-error privacy leaks, or query inefficiency
    evidence.

## Slice: Drug-Master Import Stream-Cancel Warning Fix

- Timestamp: 2026-07-02 02:37 JST
- Purpose:
  - Keep external drug-master import read/byte-limit behavior intact while
    making failed response-stream cleanup visible through safe diagnostics.
  - Preserve original read errors, timeout errors, and byte-limit errors.
- Changed files:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
- Change reason:
  - `readResponseBytes()` cancels the response body reader after body read
    errors and when streamed external imports exceed the byte limit.
  - Those cleanup attempts swallowed `reader.cancel()` failures with an empty
    catch, leaving stream cleanup failures invisible.
- Deleted code:
  - Removed the silent catch body around `reader.cancel()`.
- Commonized processing:
  - Added a small `cancelImportResponseReader()` helper that logs through the
    shared safe logger object overload only when cleanup cancellation fails.
  - Normalized import source names for safe logger values.
- Safety:
  - Existing URL validation, SSRF guardrails, redirect behavior, timeout
    handling, content-length and streamed byte-limit behavior, returned buffer
    contents, import route behavior, DB schema/migrations/RLS, auth/authz
    logic, external send behavior, secrets, deployment, and destructive
    operation boundaries remain unchanged.
  - The regression proves warning context excludes source URL and raw cancel
    error text.
- Performance:
  - Adds one warning only on cleanup cancellation failure after an existing
    read or byte-limit failure.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused test failed before the fix on zero `logger.warn` calls.
  - `pnpm vitest run src/server/services/drug-master-import/shared.test.ts --testNamePattern "logs a safe warning when oversized stream cancellation fails"`: passed.
  - `pnpm vitest run src/server/services/drug-master-import/shared.test.ts`: passed, `1` file / `20` tests.
  - `pnpm vitest run src/server/services/drug-master-import/shared.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `31` tests.
  - Scoped ESLint, Prettier, and diff-check for changed shared/test files:
    passed.
  - `pnpm typecheck`: passed after fixing the second shared helper call site in
    `fetchText()`.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/drug-master-import-stream-cancel-silent-failure`: passed.
- Known risks:
  - Browser smoke was not run because this backend cleanup observability fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener,
    persisted-error privacy leaks, or query inefficiency evidence.

## Slice: PH-OS Fee-Rules Rollback Warning Fix

- Timestamp: 2026-07-02 02:26 JST
- Purpose:
  - Keep PH-OS fee-rule search error behavior intact while making Aurora
    rollback cleanup failures visible through safe structured diagnostics.
  - Preserve original query error propagation, transaction boundaries, and
    connection release behavior.
- Changed files:
  - `src/phos/backend/aurora-fee-rules-repository.ts`
  - `src/phos/backend/aurora-fee-rules-repository.test.ts`
- Change reason:
  - `AuroraFeeRulesRepository.searchFeeRules()` attempted rollback after query
    failures, but rollback failures were swallowed with an empty catch.
  - If rollback itself failed, PH-OS operators had no structured signal that
    Aurora transaction cleanup failed.
- Deleted code:
  - Removed the silent rollback failure catch body.
- Commonized processing:
  - Reused PH-OS `buildLogEntry()` and `logPhosEvent()` for a structured
    `WARNING` event with fixed route key, error code, and operation metadata.
- Safety:
  - Existing query SQL, tenant filter, `set_config('app.tenant_id', ...)`,
    cursor behavior, query result shape, original error propagation,
    connection release behavior, DB schema/migrations/RLS, auth/authz logic,
    external sends, secrets, deployment, and destructive-operation boundaries
    remain unchanged.
  - The regression proves the warning excludes raw rollback error text,
    database URLs, tenant ids, and user ids.
- Performance:
  - Adds one structured warning only if rollback fails after a primary query
    failure.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused test failed before the fix on zero structured warning calls.
  - `pnpm vitest run src/phos/backend/aurora-fee-rules-repository.test.ts --testNamePattern "logs a structured warning when rollback fails"`: passed.
  - `pnpm vitest run src/phos/backend/aurora-fee-rules-repository.test.ts`: passed, `1` file / `16` tests.
  - Scoped ESLint, Prettier, and diff-check for changed backend/test files:
    passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/phos-fee-rules-rollback-silent-failure`: passed.
- Known risks:
  - Browser smoke was not run because this backend observability fix changes no
    visible DOM layout, copy, navigation, route contract, or interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, medical workflow semantics, billing, external send
    behavior, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener,
    persisted-error privacy leaks, or query inefficiency evidence.

## Slice: Room Token Client Warning Fix

- Timestamp: 2026-07-02 02:10 JST
- Purpose:
  - Keep collaboration room-token retry/access-denied behavior intact while
    making transient failures visible through safe diagnostics.
  - Preserve existing caller behavior for rejected fetches, 429/5xx responses,
    malformed payloads, expired payloads, and access-denied responses.
- Changed files:
  - `src/lib/collaboration/room-token-client.ts`
  - `src/lib/collaboration/room-token-client.test.ts`
- Change reason:
  - `fetchCollaborationRoomToken()` fed the then-existing collaborative form
    provider setup and token renewal.
  - Fetch rejection, transient HTTP responses, malformed payloads, and expired
    token payloads all collapsed to `transient-error` without an
    operator-visible signal.
- Deleted code:
  - Removed the silent catch body for rejected room-token fetches.
- Commonized processing:
  - Reused the shared safe logger object overload with fixed event/route/method
    metadata, operation, entity type, status when available, and failure code.
  - Added a small module-level throttle so repeated retry failures do not emit
    an unbounded warning stream.
- Safety:
  - Existing endpoint path, method, headers, request body, result
    classification, retry behavior, access-denied behavior, provider lifecycle,
    UI behavior, auth/RLS behavior, DB schema/migrations, audit semantics,
    external sends, secrets, deployment, and destructive-operation boundaries
    remain unchanged.
  - The regression tests prove warning context excludes entity id, patient
    name, and room-token sentinels.
- Performance:
  - Adds one throttled warning per entity type/failure-code/status class only
    when room-token fetch or payload validation fails.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused test failed before the fix on zero `logger.warn` calls.
  - `pnpm exec vitest run src/lib/collaboration/room-token-client.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `7` tests.
  - `pnpm exec vitest run src/lib/collaboration/room-token-client.test.ts src/lib/hooks/use-collaborative-form.test.tsx src/lib/collaboration/yjs-provider.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed against the then-existing collaborative form/provider tests, `4` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check for changed client/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/room-token-client-transient-silent-failure`: passed.
- Known risks:
  - Browser smoke was not run because this client observability fix changes no
    visible DOM layout, copy, navigation, route contract, or interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    audit semantics, billing, external send behavior, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener,
    persisted-error privacy leaks, or query inefficiency evidence.

## Slice: Presence Heartbeat Client Warning Fix

- Timestamp: 2026-07-02 01:55 JST
- Purpose:
  - Keep collaboration presence heartbeat best-effort while making delivery
    failures visible through safe diagnostics.
  - Preserve existing caller behavior for rejected fetches and non-ok
    responses.
- Changed files:
  - `src/lib/collaboration/presence-api-client.ts`
  - `src/lib/hooks/use-presence-heartbeat.test.ts`
- Change reason:
  - `postPresenceUpdate()` is used by patient collaboration and card workspace
    presence heartbeat paths.
  - Fetch rejection was caught with `.catch(() => undefined)`, and non-ok
    `/api/presence` responses resolved normally, so presence could disappear
    without an operator-visible signal.
- Deleted code:
  - Removed the silent failure catch body for rejected presence heartbeat
    fetches.
- Commonized processing:
  - Reused the shared safe logger object overload with fixed event/route/method
    metadata, operation, entity type, and response status when available.
  - Added a small module-level throttle so repeated heartbeat failures do not
    emit an unbounded warning stream.
- Safety:
  - Existing endpoint path, method, body shape, caller behavior, query keys,
    realtime payloads, UI behavior, auth/RLS behavior, no-store behavior, DB
    schema/migrations, audit semantics, external sends, secrets, deployment,
    and destructive-operation boundaries remain unchanged.
  - The regression tests prove warning context excludes entity id, patient
    name, phone, and token sentinels.
- Performance:
  - Adds one throttled warning per entity type/status class only when heartbeat
    delivery fails.
  - No new request, DB query, dependency, polling interval, background job,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused test failed before the fix on zero `logger.warn` calls.
  - `pnpm exec vitest run src/lib/hooks/use-presence-heartbeat.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `6` tests.
  - `pnpm exec vitest run src/lib/hooks/use-presence-heartbeat.test.ts src/lib/collaboration/presence.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `3` files / `24` tests.
  - Scoped ESLint, Prettier, and diff-check for changed client/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/presence-heartbeat-client-silent-failure`: passed.
- Known risks:
  - Browser smoke was not run because this client observability fix changes no
    visible DOM layout, copy, navigation, route contract, or interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    audit semantics, billing, external send behavior, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener,
    persisted-error privacy leaks, or query inefficiency evidence.

## Slice: Visit Proposal Pharmacist Enrichment Warning Fix

- Timestamp: 2026-07-02 01:38 JST
- Purpose:
  - Keep visit schedule proposal detail success semantics intact while making
    optional pharmacist enrichment read failures visible to operators.
  - Preserve the existing no-store response and `proposed_pharmacist: null`
    fallback when enrichment cannot be loaded.
- Changed files:
  - `src/app/api/visit-schedule-proposals/[id]/route.ts`
  - `src/app/api/visit-schedule-proposals/[id]/route.test.ts`
- Change reason:
  - `GET /api/visit-schedule-proposals/[id]` loads proposal detail, related
    proposals, route-day schedules, creation diagnostics, and proposed
    pharmacist records.
  - The optional pharmacist enrichment query used `.catch(() => [])`, so DB
    or read failures were silently converted into missing pharmacist data.
- Deleted code:
  - Removed the silent empty-array catch body around the pharmacist enrichment
    query.
- Commonized processing:
  - Reused the shared safe logger object overload with fixed event/route/method
    metadata, org id, proposal id, entity type, count, and sanitized error
    metadata.
- Safety:
  - Existing auth, proposal lookup, related proposal shape, route preview,
    contact/finalization workflows, sensitive no-store response boundary, DB
    schema/migrations, RLS, audit semantics, external sends, secrets,
    deployment, and destructive-operation boundaries remain unchanged.
  - The regression test proves warning context excludes patient name, phone,
    token, and pharmacist-name sentinels.
- Performance:
  - Adds one warning call only when optional pharmacist enrichment itself
    fails.
  - No new request, DB query count, dependency, polling, background job, broad
    scan, render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused route test failed before the fix on zero `logger.warn`
    calls for rejected pharmacist enrichment.
  - `pnpm exec vitest run 'src/app/api/visit-schedule-proposals/[id]/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `1` file / `75` tests.
  - `pnpm exec vitest run 'src/app/api/visit-schedule-proposals/[id]/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `86` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "visit-schedule-proposals/\\[id\\] GET|visit-schedule-proposals GET" --reporter=dot --testTimeout=60000`: passed, `6` tests / `369` skipped.
  - Scoped ESLint, Prettier, and diff-check for changed route/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/visit-schedule-proposal-pharmacist-enrichment-empty-catch`: passed.
- Known risks:
  - Browser smoke was not run because this server route observability fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    audit semantics, billing, external send behavior, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener,
    persisted-error privacy leaks, or query inefficiency evidence.

## Slice: Patient MCS Failure Observability Fix

- Timestamp: 2026-07-02 01:23 JST
- Purpose:
  - Keep patient MCS sync failure semantics intact while making failed-state
    persistence failures visible to operators.
  - Prevent patient-name-bearing identity conflict text from being persisted in
    `last_sync_error` and returned through the authorized MCS overview payload.
- Changed files:
  - `src/server/services/patient-mcs.ts`
  - `src/server/services/patient-mcs.test.ts`
- Change reason:
  - `syncPatientMcsTimeline` records `last_sync_status: 'failed'` when the
    primary sync fails.
  - If that failure-state upsert also failed, the code swallowed the secondary
    rejection with `.catch(() => undefined)`, so the persisted sync state could
    be stale without any safe operational signal.
  - MCS identity conflict errors embedded local/remote patient-name text in
    the message that was then persisted to `last_sync_error`.
- Deleted code:
  - Removed the silent catch body for failed-state persistence failure.
- Commonized processing:
  - Reused the shared safe logger object overload with fixed event/operation,
    org id, actor id, entity type, and sanitized error metadata.
  - Reused fixed operator-safe conflict text for identity mismatches before
    persistence.
- Safety:
  - Existing patient lookup, MCS URL normalization, scrape flow, success
    persistence, summary persistence, route status mapping, response envelope,
    no-store headers, auth/RLS behavior, DB schema/migrations, external sends,
    secrets, deployment, and destructive-operation boundaries remain
    unchanged.
  - The regression tests prove the warning context excludes raw patient/error
    text and persisted identity conflict text excludes local and remote
    patient-name sentinels.
- Performance:
  - Adds one warning call only when failed-state persistence itself fails.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused service test failed before the warning fix on zero
    `logger.warn` calls.
  - Initial identity-conflict regression failed before the fixed conflict
    message because the thrown/persisted message contained patient-name text.
  - `pnpm exec vitest run src/server/services/patient-mcs.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `23` tests.
  - `pnpm exec vitest run src/server/services/patient-mcs.test.ts 'src/app/api/patients/[id]/mcs/route.test.ts' 'src/app/api/patients/[id]/mcs-sync/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `4` files / `57` tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this service failure-handling/privacy fix
    changes no DOM layout, navigation, or workflow shape.
  - Future UI copy may show less identifying MCS sync failure text for
    identity conflicts; this is an intentional PHI minimization.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    audit semantics, billing, external send behavior, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener,
    persisted-error privacy leaks, or query inefficiency evidence.

## Slice: External Access Rollback Warning Fix

- Timestamp: 2026-07-02 01:04 JST
- Purpose:
  - Keep the existing fail-closed `POST /api/external-access` fallback-audit
    error response while making failed grant rollback visible to operators.
  - Preserve OTP/JWT redaction and sensitive no-store response boundaries.
- Changed files:
  - `src/app/api/external-access/route.ts`
  - `src/app/api/external-access/route.test.ts`
- Change reason:
  - When SMS OTP delivery fell back to manual handling and the fallback audit
    write failed, the route attempted to revoke the newly created grant.
  - Revocation failure was caught with `.catch(() => undefined)`, so an
    unrevoked external-access grant could remain without a safe operational
    signal.
- Deleted code:
  - Removed the silent catch body for the rollback revocation failure path.
- Commonized processing:
  - Reused the shared safe logger object overload with event, route, method,
    operation, org id, actor id, entity type, target grant id, and sanitized
    error metadata.
- Safety:
  - Existing auth, patient access, consent checks, grant creation, JWT/token
    hash update, audit creation, SMS fallback behavior, fail-closed `500`
    response, sensitive no-store headers, DB schema/migrations, RLS, external
    send semantics, secrets, deployment, and destructive-operation boundaries
    remain unchanged.
  - The regression test proves raw phone contact, token/JWT text, and
    OTP-shaped values are not placed in the response or structured warning
    context.
- Performance:
  - Adds one warning call only when the cleanup rollback itself fails.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused route test failed before the fix on zero `logger.warn`
    calls for a rejected rollback revocation.
  - `pnpm exec vitest run src/app/api/external-access/route.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `35` tests.
  - `pnpm exec vitest run src/app/api/external-access/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `46` tests.
  - Scoped ESLint, Prettier, and diff-check for changed route/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this server route observability fix
    changes no visible DOM layout, navigation, route contract, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    audit semantics, billing, external send behavior, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener, or
    query inefficiency evidence.

## Slice: Presence Realtime Warning Fix

- Timestamp: 2026-07-02 00:49 JST
- Purpose:
  - Keep `POST /api/presence` heartbeat success behavior while making
    best-effort realtime broadcast failures visible to operators.
  - Preserve the local presence store write and client response.
- Changed files:
  - `src/app/api/presence/route.ts`
  - `src/app/api/presence/route.test.ts`
- Change reason:
  - The route updated the in-memory presence store, then broadcast a realtime
    `presence_update`.
  - Broadcast rejection was caught with `.catch(() => undefined)`, so
    Redis/adapter delivery failures were completely silent.
- Deleted code:
  - Removed the silent catch body for the presence realtime broadcast.
- Commonized processing:
  - Reused the shared safe logger object overload with event, route, method,
    operation, org id, entity type, and sanitized error metadata.
- Safety:
  - Existing auth, entity access checks, presence store update, channel naming,
    realtime payload shape, status/body response contract, DB schema/migrations,
    RLS, audit semantics, external sends, secrets, deployment, and destructive
    operations remain unchanged.
  - The regression test proves raw error text, active field, and display name
    are not placed in the structured warning context.
- Performance:
  - Adds one warning call only on realtime broadcast failure.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused route test failed before the fix on zero `logger.warn`
    calls for a rejected realtime broadcast.
  - `pnpm exec vitest run src/app/api/presence/route.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `12` tests.
  - `pnpm exec vitest run src/app/api/presence/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `23` tests.
  - Scoped ESLint, Prettier, and diff-check for changed route/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this server route observability fix
    changes no visible DOM layout, navigation, route contract, or interaction
    state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    audit semantics, billing, external send behavior, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener, or
    query inefficiency evidence.

## Slice: Voice Memo Manual Save Warning Fix

- Timestamp: 2026-07-02 00:31 JST
- Purpose:
  - Warn when a hand-entered voice memo transcript is reflected in the UI but
    cannot be saved to the local encrypted voice memo draft.
  - Preserve the immediate transcript reflection and visit-record append
    workflow.
- Changed files:
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.tsx`
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.test.tsx`
- Change reason:
  - `saveVoiceMemoManualTranscript()` returns `false` for non-throwing local
    persistence failures such as missing a matching voice memo draft.
  - `VoiceMemoContent` only handled rejected promises, so the `false` result
    looked fully successful to the user.
- Deleted code:
  - None.
- Commonized processing:
  - Reused the existing voice memo warning copy for both rejected saves and
    `false` save results.
- Safety:
  - Existing manual transcript normalization, visible transcript reflection,
    visit-record append behavior, offline encrypted draft storage contract,
    route/API behavior, DB schema/migrations, auth/RLS, external sends,
    secrets, deployment, and destructive-operation boundaries remain
    unchanged.
  - The new component regression proves the warning state appears when the
    local save helper resolves `false`.
- Performance:
  - Adds one boolean-result branch after the existing local save attempt.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Initial focused component test failed before the fix on zero
    `toast.warning` calls for a `false` local-save result.
  - `pnpm exec vitest run 'src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.test.tsx' src/lib/offline/voice-memo-drafts.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `11` tests.
  - Scoped ESLint, Prettier, and diff-check for changed component/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this toast-only state fix changes no DOM
    layout, navigation, route contract, or business workflow shape. The visible
    warning state is covered by jsdom component regression.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    server-side visit-record update semantics, external STT/send behavior,
    billing, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with boolean-return
    persistence helpers, empty catch, unhandled rejection, stale listener, or
    query inefficiency evidence.

## Slice: Notification Realtime Warning Fix

- Timestamp: 2026-07-02 00:15 JST
- Purpose:
  - Replace an empty catch in best-effort realtime notification broadcast with
    safe operational logging.
  - Preserve persisted notification behavior; stored rows remain the source of
    truth.
- Changed files:
  - `src/server/services/notifications.ts`
  - `src/server/services/notifications.test.ts`
- Change reason:
  - `broadcastPersistedNotifications` caught realtime broadcast failures with
    an empty catch.
  - This made immediate realtime delivery failures invisible even though users
    could later recover the persisted notification rows.
- Deleted code:
  - Removed the empty catch body around realtime notification broadcast.
- Commonized processing:
  - Reused the shared safe logger object overload so the warning includes only
    event, entity type, operation, count, and sanitized error metadata.
- Safety:
  - Existing notification row creation, returned notification payloads, channel
    recipient resolution, external SMS/LINE/Web Push scheduling, auth/RLS/DB
    behavior, migrations, and secret handling remain unchanged.
  - The regression test proves raw PHI/secret-bearing error text is not placed
    in the structured warning context.
- Performance:
  - Adds one warning call only on realtime broadcast failure.
  - No new request, DB query, dependency, polling, background job, broad scan,
    or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/server/services/notifications.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `15` tests.
  - `pnpm exec vitest run src/server/services/notifications.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `26` tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this server service error-handling fix
    changes no visible UI, copy, or interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior,
    notification payload semantics, external sends, billing, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with empty catch,
    unhandled rejection, stale listener, or queryFn undefined evidence.

## Slice: Bulk Export Drain Warning Fix

- Timestamp: 2026-07-02 00:00 JST
- Purpose:
  - Replace an empty catch in immediate medication-history bulk-export drain
    startup with safe operational logging.
  - Preserve external response behavior and queued-job recovery semantics.
- Changed files:
  - `src/app/api/patients/medications/bulk-export/route.ts`
  - `src/app/api/patients/medications/bulk-export/route.test.ts`
- Change reason:
  - When a bulk export started immediately, the route triggered
    `drainMedicationHistoryBulkExportQueue` in the background.
  - A rejection from that background drain was caught by an empty catch, hiding
    immediate startup failures from operators even though the queued job could
    remain pending for the job endpoint.
- Deleted code:
  - Removed the empty catch body around the background drain promise.
- Commonized processing:
  - Reused the shared safe logger object overload so the warning includes only
    event, org id, job id, job type, operation, and sanitized error metadata.
- Safety:
  - Existing auth permission, request validation, queue registration, duplicate
    patient-id compaction, `202` response shape, no-store headers, job-endpoint
    recovery path, DB schema, migrations, external sends, and secret handling
    remain unchanged.
  - The regression test proves raw PHI/secret-bearing error text is not placed
    in the structured warning context.
- Performance:
  - Adds one warning call only on background drain failure.
  - No new request, DB query, dependency, polling, background job, broad scan,
    or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/app/api/patients/medications/bulk-export/route.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `8` tests.
  - `pnpm exec vitest run src/app/api/patients/medications/bulk-export/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `19` tests.
  - Scoped ESLint, Prettier, and diff-check for changed route/test files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Browser smoke was not run because this server route error-handling fix
    changes no visible UI, copy, or interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior, PHI
    payload fields, external sends, billing, medication identity, production
    config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt for current production code paths with empty catch,
    unhandled rejection, stale listener, or queryFn undefined evidence.

## Slice: Redis Realtime Subscribe Race Fix

- Timestamp: 2026-07-01 23:49 JST
- Purpose:
  - Fix Redis realtime adapter subscription state races that can drop active
    listeners after mount/unmount churn.
  - Preserve the existing public realtime adapter API and message payload
    contract.
- Changed files:
  - `src/server/adapters/realtime/redis-adapter.ts`
  - `src/server/adapters/realtime/redis-adapter.test.ts`
- Change reason:
  - `unsubscribeFromChannel` deleted local subscribed state before Redis
    `unsubscribe()` settled. A same-channel subscribe during that window could
    be followed by the older unsubscribe completing, leaving new listeners
    locally registered but no longer subscribed in Redis.
  - Failed Redis `subscribe()` calls also left local state marked subscribed,
    so later listeners could skip the real Redis subscribe call.
- Deleted code:
  - None.
- Commonized processing:
  - Added a small `subscribeRedisChannel` helper so Redis subscribe state is
    added and rolled back consistently.
  - Added per-channel pending-unsubscribe tracking and resubscribe-after-race
    reconciliation.
- Safety:
  - Existing Redis URL handling, publish behavior, listener isolation, JSON
    message parsing, callback contract, and in-memory adapter selection remain
    unchanged.
  - Tests mock Redis and cover both the unsubscribe/resubscribe race and failed
    subscribe state rollback.
- Performance:
  - Adds only bounded per-channel pending promise tracking during unsubscribe
    windows.
  - No new request, DB query, dependency, polling, background job, broad scan,
    or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/server/adapters/realtime/redis-adapter.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `4` tests.
  - `pnpm exec vitest run src/server/adapters/realtime/redis-adapter.test.ts src/server/services/org-realtime-policy.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `8` tests.
  - Scoped ESLint and Prettier for changed adapter/test files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - No browser smoke was run because this server adapter fix changes no visible
    UI, copy, or interaction state.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior, PHI
    payload fields, external sends, billing, medication identity, production
    config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue bug-hunt and duplicate-helper cleanup with focused evidence before
    editing.

## Slice: Dispense-Tasks Strict Query Helper

- Timestamp: 2026-07-01 23:32 JST
- Purpose:
  - Extract strict optional query filter parsing from `/api/dispense-tasks`
    into the shared search-param helper.
  - Preserve existing duplicate, blank, padded, max-length, and status
    validation behavior.
- Changed files:
  - `src/app/api/dispense-tasks/route.ts`
  - `src/app/api/dispense-tasks/route.test.ts`
- Change reason:
  - `/api/dispense-tasks` duplicated the same strict optional filter reader
    shape already captured by `readStrictOptionalSearchParam`.
- Deleted code:
  - Removed dispense-tasks route-local `readStrictOptionalDispenseTaskFilter`.
  - Removed the now-unneeded `DispenseTaskQueryName` alias.
- Commonized processing:
  - `readStrictOptionalSearchParam` now covers dispense-tasks `status`,
    `cycle_id`, and `assigned_to` filter parsing before the route's enum
    validation.
- Safety:
  - Preserved dispense-tasks GET auth, permission checks, assignment access
    scoping, cursor pagination, validation response shape, no-store wrapping,
    query shape, unsupported status rejection, and POST behavior.
  - Existing route tests plus expanded malformed-filter cases prove invalid
    filters reject before dispense-task queries.
- Performance:
  - No runtime performance improvement is claimed.
  - Adds no DB query, dependency, network call, polling, cache behavior,
    response DTO change, or unbounded loop.
- Validation:
  - Focused helper + dispense-tasks route tests passed `2` files / `29` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Known risks:
  - Additional route-local query readers remain candidates only when exact
    blank/trimming/max-length/message semantics are proven.
- Next improvements:
  - Continue query-param helper convergence only for route families whose
    current semantics can be locked with focused tests.

## Slice: Medication-Cycles Strict Query Helper

- Timestamp: 2026-07-01 23:18 JST
- Purpose:
  - Extract strict optional query filter parsing from `/api/medication-cycles`
    into the shared search-param helper.
  - Preserve existing duplicate, blank, padded, max-length, and status
    validation behavior.
- Changed files:
  - `src/app/api/medication-cycles/route.ts`
  - `src/app/api/medication-cycles/route.test.ts`
- Change reason:
  - `/api/medication-cycles` duplicated the same strict optional filter reader
    shape already captured by `readStrictOptionalSearchParam`.
- Deleted code:
  - Removed medication-cycles route-local
    `readStrictOptionalMedicationCycleFilter`.
  - Removed the now-unneeded `MedicationCycleQueryName` alias.
- Commonized processing:
  - `readStrictOptionalSearchParam` now covers medication-cycles `status`,
    `case_id`, and `patient_id` filter parsing before the route's enum
    validation.
- Safety:
  - Preserved medication-cycles GET auth, assignment access scoping,
    pagination, validation response shape, no-store wrapping, query shape,
    unsupported status rejection, and POST behavior.
  - Existing route tests plus one added overlong-status case prove invalid
    filters reject before cycle queries.
- Performance:
  - No runtime performance improvement is claimed.
  - Adds no DB query, dependency, network call, polling, cache behavior,
    response DTO change, or unbounded loop.
- Validation:
  - Focused helper + medication-cycles route tests passed `2` files / `29`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier, ESLint, and diff-check passed after formatting the route
    test table.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Known risks:
  - Additional route-local query readers remain candidates only when exact
    blank/trimming/max-length/message semantics are proven.
- Next improvements:
  - Continue query-param helper convergence only for route families whose
    current semantics can be locked with focused tests.

## Slice: Residual / First-Visit Strict Query Helper

- Timestamp: 2026-07-01 23:07 JST
- Purpose:
  - Extract strict optional query filter parsing from `/api/residual-medications`
    and `/api/first-visit-documents` into the shared search-param helper.
  - Preserve existing duplicate, blank, padded, and max-length validation
    messages.
- Changed files:
  - `src/app/api/residual-medications/route.ts`
  - `src/app/api/residual-medications/route.test.ts`
  - `src/app/api/first-visit-documents/route.ts`
- Change reason:
  - Both routes duplicated the same strict optional filter reader shape already
    captured by `readStrictOptionalSearchParam`.
- Deleted code:
  - Removed residual route-local `readStrictOptionalIdFilter`.
  - Removed first-visit route-local `readOptionalFirstVisitDocumentFilter` and
    its now-unneeded filter-name alias.
- Commonized processing:
  - `readStrictOptionalSearchParam` now covers residual `patient_id` /
    `visit_record_id` and first-visit `patient_id` / `case_id` filter parsing.
- Safety:
  - Preserved residual and first-visit GET auth, scope/access checks,
    validation response shape, no-store wrapping, query shape, and POST
    behavior.
  - Existing route tests plus residual overlong-id cases prove invalid filters
    reject before DB/scope resolution.
- Performance:
  - No runtime performance improvement is claimed.
  - Adds no DB query, dependency, network call, polling, cache behavior,
    response DTO change, or unbounded loop.
- Validation:
  - Focused helper + residual + first-visit route tests passed `3` files /
    `53` tests.
  - Protected GET matrix passed `6` tests / `369` skipped.
  - Scoped Prettier, ESLint, and diff-check passed after formatting the
    residual route test table.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Known risks:
  - Additional route-local query readers remain candidates only when exact
    blank/trimming/max-length/message semantics are proven.
- Next improvements:
  - Continue query-param helper convergence only for route families whose
    current semantics can be locked with focused tests.

## Slice: Medication-Issues Strict Query Helper

- Timestamp: 2026-07-01 22:56 JST
- Purpose:
  - Extract strict optional query filter parsing from `/api/medication-issues`
    into the shared search-param helper.
  - Preserve existing duplicate, blank, padded, max-length, and status
    validation behavior.
- Changed files:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/medication-issues/route.ts`
  - `src/app/api/medication-issues/route.test.ts`
- Change reason:
  - `/api/medication-issues` duplicated the same strict optional filter reader
    shape already captured by `readStrictOptionalSearchParam`.
- Deleted code:
  - Removed medication-issues route-local
    `readStrictOptionalMedicationIssueFilter`.
- Commonized processing:
  - `readStrictOptionalSearchParam` now covers medication-issues
    `patient_id`, `case_id`, and `status` filter parsing before the route's
    enum validation.
- Safety:
  - Preserved medication-issues GET auth, assignment access scoping, validation
    response shape, no-store wrapping, query shape, unsupported status
    rejection, and POST behavior.
  - Existing route tests plus one added overlong-id case prove invalid filters
    reject before patient/case/assignment scope resolution.
- Performance:
  - No runtime performance improvement is claimed.
  - Adds no DB query, dependency, network call, polling, cache behavior,
    response DTO change, or unbounded loop.
- Validation:
  - Focused helper + medication-issues route tests passed `2` files / `25`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Known risks:
  - Additional route-local query readers remain candidates only when exact
    blank/trimming/max-length/message semantics are proven.
- Next improvements:
  - Continue query-param helper convergence only for route families whose
    current semantics can be locked with focused tests.

## Slice: Interventions Strict Query Helper

- Timestamp: 2026-07-01 22:47 JST
- Purpose:
  - Extract strict optional query filter parsing from `/api/interventions` into
    the shared search-param helper.
  - Preserve existing duplicate, blank, padded, and max-length validation
    messages.
- Changed files:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/interventions/route.ts`
- Change reason:
  - `/api/interventions` duplicated the same strict optional filter reader
    shape now suitable for shared helper convergence after the dashboard
    medication-deadlines helper slice proved the module boundary.
- Deleted code:
  - Removed interventions route-local `readStrictOptionalInterventionFilter`.
- Commonized processing:
  - `readStrictOptionalSearchParam` preserves missing-as-undefined behavior and
    field-specific duplicate, blank, invalid, and max-length messages.
- Safety:
  - Preserved interventions GET auth, assignment access scoping, validation
    response shape, no-store wrapping, query shape, and POST behavior.
  - Existing route tests prove invalid filters reject before patient/assignment
    scope resolution.
- Performance:
  - No runtime performance improvement is claimed.
  - Adds no DB query, dependency, network call, polling, cache behavior,
    response DTO change, or unbounded loop.
- Validation:
  - Focused helper + interventions route tests passed `2` files / `20` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier and ESLint checks passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Known risks:
  - This helper should only be reused where blank, trimming, max-length, and
    field-message semantics exactly match the existing route contract.
- Next improvements:
  - Continue query-param helper convergence only for route families whose
    current semantics can be locked with focused tests.

## Slice: Dashboard Medication-Deadlines Query Helper

- Timestamp: 2026-07-01 22:37 JST
- Purpose:
  - Extract strict single-query-param and exact integer query parsing from
    `/api/dashboard/medication-deadlines` into a shared helper.
  - Preserve every observable validation message and response behavior.
- Changed files:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
- Change reason:
  - After route-local logger sanitizer convergence, the next re-audit found
    route-local query parsing helpers duplicating strict duplicate-param and
    exact integer validation behavior.
- Deleted code:
  - Removed medication-deadlines route-local `parseSingleSearchParam`.
  - Removed medication-deadlines route-local `parseExactIntegerParam`.
- Commonized processing:
  - `readSingleSearchParam` preserves missing/null vs empty-string behavior and
    duplicate-param field messages.
  - `parseExactIntegerSearchParam` rejects padded and malformed integer strings
    without trimming, preserving medication-deadlines route behavior.
- Safety:
  - Preserved validation responses for duplicate `within_days`, `limit`, `q`,
    blank `q`, padded `q`, padded integers, malformed integers, out-of-range
    limits, and overlong `q`.
  - Preserved dashboard auth, request auth context, org/RLS context, schedule
    query shape, deadline classification, no-store wrapping, `unstable_rethrow`,
    and response shape.
- Performance:
  - No runtime performance improvement is claimed.
  - Adds no DB query, dependency, network call, polling, cache behavior,
    response DTO change, or unbounded loop.
- Validation:
  - Focused helper + medication-deadlines route tests passed `2` files / `24`
    tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier/ESLint/diff-check passed.
  - Full typecheck initially exposed a union-narrowing issue, fixed before
    final gates.
  - Final typecheck, no-unused, lint, format check, diff check, and production
    build passed.
- Known risks:
  - This slice intentionally applies the new helper to one route only. Other
    route-local query readers have similar shapes but may intentionally differ
    in blank/trimming/message semantics.
- Next improvements:
  - Continue exact query-param helper convergence only for route families whose
    current semantics can be locked with focused tests.

## Slice: Dashboard Routes Structured Logger Convergence

- Timestamp: 2026-07-01 22:22 JST
- Purpose:
  - Routes `/api/dashboard/workflow`, `/api/dashboard/cockpit`, and
    `/api/dashboard/medication-deadlines` GET unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Keep dashboard BFF response contracts stable while syncing a stale
    workflow route snapshot to the current workflow-dashboard section href
    contract.
- Changed files:
  - `src/app/api/dashboard/workflow/route.ts`
  - `src/app/api/dashboard/workflow/route.test.ts`
  - `src/app/api/dashboard/workflow/__snapshots__/route.test.ts.snap`
  - `src/app/api/dashboard/cockpit/route.ts`
  - `src/app/api/dashboard/cockpit/route.test.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
  - `src/app/api/dashboard/medication-deadlines/route.test.ts`
- Change reason:
  - These operational dashboard routes still carried duplicated
    `SAFE_ERROR_NAMES` / `safeErrorName()` plus string-overload logging
    context after the shared logger became the canonical PHI/secret-safe
    redaction boundary.
  - The workflow route snapshot lagged the service-level
    workflow-dashboard section href expectations.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    three dashboard routes.
- Commonized processing:
  - Dashboard GET unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved dashboard workflow auth, view parsing, cache key behavior,
    assignment scope fingerprinting, workflow core/dependent query flow,
    no-store wrapping, `unstable_rethrow`, and response shape.
  - Preserved dashboard cockpit auth, scope parsing, cache behavior, task and
    audit queue aggregation, team capacity projection, no-store wrapping,
    `unstable_rethrow`, and response shape.
  - Preserved medication-deadlines auth, query parsing, org/RLS context,
    schedule deadline classification, no-store wrapping, `unstable_rethrow`,
    and response shape.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, cache behavior, assignment predicate, response DTO, or
    unbounded loop.
- Validation:
  - Initial focused dashboard/logger suite failed only on a stale workflow
    route snapshot; no logger expectation failed.
  - Workflow route snapshot update passed `1` file / `20` tests.
  - Focused dashboard route/logger tests passed `4` files / `65` tests.
  - Protected GET matrix passed `9` tests / `366` skipped.
  - Workflow-dashboard sections service test passed `1` file / `12` tests.
  - Route-local sanitizer grep returned only the canonical shared logger
    implementation.
  - Scoped Prettier passed for changed dashboard route/test files. A direct
    check including `.snap` failed because Prettier could not infer a parser;
    snapshot integrity was verified by Vitest and `git diff --check`.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET unexpected-error logging call
    shape, tests, and one stale snapshot. Dashboard runtime response DTOs and
    operational behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and test contract only, with no visible DOM layout, copy, or
    interaction state change.
- Next improvements:
  - Re-audit for the next evidence-backed refactor candidate now that the
    route-local `SAFE_ERROR_NAMES` / `safeErrorName` inventory is exhausted
    outside the shared logger contract.

## Slice: Patient Prescriptions Structured Logger Convergence

- Timestamp: 2026-07-01 22:09 JST
- Purpose:
  - Route `/api/patients/[id]/prescriptions` GET unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Route `/api/patients/[id]/prescriptions/e-prescription` POST
    unexpected-error logs through the same shared logger contract.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve patient prescription list and e-prescription intake behavior.
- Changed files:
  - `src/app/api/patients/[id]/prescriptions/route.ts`
  - `src/app/api/patients/[id]/prescriptions/route.test.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.test.ts`
- Change reason:
  - These patient medication routes handle PHI-heavy prescription and
    e-prescription workflows while still carrying duplicated
    `SAFE_ERROR_NAMES` / `safeErrorName()` plus string-overload logging
    context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from both
    routes.
- Commonized processing:
  - Prescription GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - E-prescription POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved patient prescription GET auth, route-param validation, case
    filter validation, patient/case access scope, pagination/cursor behavior,
    diff review construction, sensitive no-store wrapping, `unstable_rethrow`,
    and fixed `INTERNAL_ERROR` response.
  - Preserved e-prescription POST auth, request body validation, writable
    patient guard, adapter error handling, acceptable-status checks,
    idempotency behavior, medication-cycle matching, intake creation,
    sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` response.
  - Shared protected GET matrix entry still passes for the prescriptions route.
  - No shared protected POST matrix entry exists for e-prescription; direct
    route tests cover auth, input, adapter, idempotent replay, no-store, and
    fixed sanitized 500 behavior.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, validation rule change, patient/case predicate change,
    adapter behavior change, intake transaction change, response DTO change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run 'src/app/api/patients/[id]/prescriptions/route.test.ts' 'src/app/api/patients/[id]/prescriptions/e-prescription/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `3` files / `53` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "patients/\\[id\\]/prescriptions GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/POST unexpected-error logging
    call shape and tests; prescription list and e-prescription intake semantics
    and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue route-local logger convergence with the remaining dashboard
    workflow/cockpit/medication-deadlines routes.

## Slice: Visit-Records Structured Logger Convergence

- Timestamp: 2026-07-01 21:59 JST
- Purpose:
  - Route `/api/visit-records` GET/POST unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Route patient-state snapshot failure logs through the same shared logger
    raw-error redaction contract.
  - Add shared logger support for `logger.warn({ ... }, err)` so background
    handoff extraction warnings no longer need route-local error-name
    sanitization.
  - Preserve visit-record list/create auth, validation, transaction, handoff,
    no-store, and response behavior.
- Changed files:
  - `src/app/api/visit-records/route.ts`
  - `src/app/api/visit-records/route.test.ts`
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Change reason:
  - The visit-records route handles PHI-heavy visit list/create workflows,
    patient-state snapshots, and background handoff extraction warnings while
    still carrying duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` plus
    string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Patient-state snapshot failure logging now calls
    `logger.error({ event, route, operation }, snapshotError)`.
  - Background handoff extraction warning now calls
    `logger.warn({ event, route, operation, targetId }, cause)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved visit-record GET auth, strict query parsing, pagination/cursor
    behavior, patient history/attachment selection, RLS request context,
    sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` response.
  - Preserved visit-record POST auth, request auth context, body validation,
    schedule/care-case/patient scope checks, transaction behavior, patient
    snapshot best-effort behavior, derived-data sync, operational task/billing
    evidence side effects, background handoff extraction dispatch,
    sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` response.
  - Shared protected GET and POST matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, query/body validation rule, transaction/mutation change,
    snapshot algorithm change, handoff extraction behavior change, response DTO
    change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/visit-records/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `91` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "visit-records GET" --reporter=dot --testTimeout=60000`: passed, `6` tests / `369` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "visit-records POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only logging call shape, shared warning
    raw-error support, and tests; visit list/create semantics, transaction
    behavior, background handoff dispatch, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially patient prescription and dashboard
    workflow/cockpit/deadline routes.

## Slice: Visit-Billing-Candidates Summary Structured Logger Convergence

- Timestamp: 2026-07-01 21:44 JST
- Purpose:
  - Route `/api/visit-billing-candidates/summary` GET unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve monthly visit billing summary auth, validation, count/query
    behavior, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/visit-billing-candidates/summary/route.ts`
  - `src/app/api/visit-billing-candidates/summary/route.test.ts`
- Change reason:
  - The visit-billing-candidates summary route handles visit and billing
    operational aggregate data and still carried duplicated `SAFE_ERROR_NAMES`
    / `safeErrorName()` plus string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route test asserts only minimal operational context is supplied by the
    route and delegates raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canManageBilling` auth, request auth context, billing-month
    validation, optional search-param validation, RLS `withOrgContext` request
    context, partner visit record count queries, candidate query shape,
    summary arithmetic, sensitive no-store wrapping, `unstable_rethrow`, and
    fixed `INTERNAL_ERROR` response.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, validation failure, no-store behavior, and
    sanitized fixed 500 fallback.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, billing-month parsing change, filter validation change,
    count/query shape change, arithmetic change, response DTO change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/visit-billing-candidates/summary/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `18` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    the route-test assertion proving route context has no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET unexpected-error logging call
    shape and tests; visit/billing summary semantics and response DTO are
    unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially visit-records, patient prescription, and
    dashboard workflow/cockpit/deadline routes.

## Slice: Care-Reports Structured Logger Convergence

- Timestamp: 2026-07-01 21:34 JST
- Purpose:
  - Route `/api/care-reports` GET/POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve report list/create auth, access scope, source validation, no-store
    wrapping, and response behavior.
- Changed files:
  - `src/app/api/care-reports/route.ts`
  - `src/app/api/care-reports/route.test.ts`
- Change reason:
  - The care-reports route handles PHI-heavy report list/create workflows and
    still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` plus
    string-overload logging context across GET/POST.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canViewReport` / `canAuthorReport` auth, request auth context,
    query/body validation, access filtering, pagination/cursor behavior,
    delivery summary behavior, source validation, duplicate conflict handling,
    RLS `withOrgContext`, sensitive no-store wrapping, `unstable_rethrow`, and
    fixed `INTERNAL_ERROR` responses.
  - Shared protected GET and POST matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, access predicate change, report source validation change,
    transaction/mutation change, delivery summary change, response DTO change,
    or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/care-reports/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `72` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "care-reports GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "care-reports POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/POST unexpected-error logging
    call shape and tests; report list/create semantics, access scope, source
    validation, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially visit, patient prescription, and dashboard
    workflow/cockpit/deadline routes.

## Slice: Dispense-Results Structured Logger Convergence

- Timestamp: 2026-07-01 21:26 JST
- Purpose:
  - Route `/api/dispense-results` POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve dispense-result create auth, validation, safety checks, transaction
    behavior, notifications, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/dispense-results/route.ts`
  - `src/app/api/dispense-results/route.test.ts`
- Change reason:
  - The dispense-results route handles medication dispensing result writes and
    still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` plus
    string-overload logging context on POST failures.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route test asserts only minimal operational context is supplied by the
    route and delegates raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved auth context, `runWithRequestAuthContext`, body validation,
    safety checklist enforcement, RLS `withOrgContext`, medication-cycle
    assignment scope, transaction behavior, CDS checks, barcode verification,
    cycle transition handling, operational task creation, workflow/webhook
    notifications, sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` response.
  - Shared protected POST matrix entry still passes.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, validation rule change, assignment predicate change,
    transaction/mutation change, CDS invocation change, notification change,
    response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/dispense-results/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `50` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "dispense-results POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route context has no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only POST unexpected-error logging call
    shape and tests; medication dispensing workflow semantics, transaction
    writes, notifications, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially care-report, visit, patient prescription, and
    dashboard workflow/cockpit/deadline routes.

## Slice: Dispense-Audits Structured Logger Convergence

- Timestamp: 2026-07-01 21:12 JST
- Purpose:
  - Route `/api/dispense-audits` GET/POST unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve dispense-audit queue and mutation auth, assignment scope, cycle
    transition, notification dispatch, workflow notification, no-store
    wrapping, and response behavior.
- Changed files:
  - `src/app/api/dispense-audits/route.ts`
  - `src/app/api/dispense-audits/route.test.ts`
- Change reason:
  - The dispense-audits route handles medication dispense audit workflow state
    and still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` plus
    string-overload logging context across GET/POST.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canAuditDispense` auth, `runWithRequestAuthContext`, assignment
    filtering, RLS `withOrgContext` request context, queue query shape,
    annotate/sort behavior, mutation transaction behavior, cycle transition,
    notification dispatch, workflow dashboard invalidation, sensitive no-store
    wrapping, `unstable_rethrow`, and fixed `INTERNAL_ERROR` responses.
  - Shared protected GET and POST matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, queue query shape change,
    transaction/mutation change, cycle transition change, notification change,
    workflow notification change, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/dispense-audits/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `37` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "dispense-audits GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "dispense-audits POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file.
  - Scoped ESLint passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/POST unexpected-error logging
    call shape and tests; dispense-audit queue/mutation semantics, cycle
    transitions, notifications, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially dispense-results, care-report, visit, patient
    prescription, and dashboard workflow/cockpit/deadline routes.

## Slice: Set-Audits Structured Logger Convergence

- Timestamp: 2026-07-01 20:58 JST
- Purpose:
  - Route `/api/set-audits` GET/POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve set-audit queue and mutation auth, assignment scope, checklist
    and carry-packet evidence validation, status transition, workflow
    notification, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/set-audits/route.ts`
  - `src/app/api/set-audits/route.test.ts`
- Change reason:
  - The set-audits route handles medication audit workflow state and still
    carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` plus
    string-overload logging context across GET/POST.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canAuditSet` auth, `runWithRequestAuthContext`, assignment
    filtering, RLS `withOrgContext` request context, queue query include/select
    shape, checklist validation, carry-packet evidence validation, outside-med
    evidence classification, mutation transaction behavior, reject/cell audit
    state handling, cycle transition, workflow dashboard invalidation,
    sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` responses.
  - Shared protected GET and POST matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, queue query shape change,
    transaction/mutation change, evidence validation change, cycle transition
    change, workflow notification change, response DTO change, or unbounded
    loop.
- Validation:
  - `pnpm exec vitest run src/app/api/set-audits/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `50` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "set-audits GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "set-audits POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file.
  - Scoped ESLint passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/POST unexpected-error logging
    call shape and tests; set-audit queue/mutation semantics, cycle
    transitions, workflow notifications, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially dispense audit/result, care-report, visit,
    patient prescription, and dashboard workflow/cockpit/deadline routes.

## Slice: Set-Plans Generate-Batches Structured Logger Convergence

- Timestamp: 2026-07-01 20:49 JST
- Purpose:
  - Route `/api/set-plans/[id]/generate-batches` POST unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve set-batch generation auth, assignment scope, serializable retry,
    existing-batch reuse/stale-input checks, force guards, batch generation,
    history logging, workflow notification, no-store wrapping, and response
    behavior.
- Changed files:
  - `src/app/api/set-plans/[id]/generate-batches/route.ts`
  - `src/app/api/set-plans/[id]/generate-batches/route.test.ts`
- Change reason:
  - The generate-batches route handles medication set generation and still
    carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` plus
    string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`, including the
    local custom `SetBatchGenerateRetryLimitError` allowlist entry.
- Commonized processing:
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canSet` auth, `runWithRequestAuthContext`, assignment where
    filtering, RLS `withOrgContext` request context, optional body parsing,
    force/`expected_updated_at` validation, serializable transaction retry and
    retry-limit conflict response, audit-ready status guards, existing batch
    reuse/stale input checks, plan packaging snapshot update, force delete and
    regeneration before-snapshots, audited dispense result usage, controlled
    handling tag resolution, set-batch createMany payload, change-log creation,
    workflow dashboard invalidation, sensitive no-store wrapping,
    `unstable_rethrow`, and fixed `INTERNAL_ERROR` responses.
  - Shared protected POST matrix entry still passes.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, transaction retry change,
    stale-input algorithm change, batch generation payload change, history
    snapshot change, workflow notification change, response DTO change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run 'src/app/api/set-plans/[id]/generate-batches/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `37` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "set-plans/\\[id\\]/generate-batches POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only POST unexpected-error logging call
    shape and tests; set-batch generation semantics, retry behavior,
    workflow notifications, history logs, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set-audits, dispense audit/result, care-report,
    visit, patient prescription, and dashboard workflow/cockpit/deadline
    routes.

## Slice: Set-Plans Detail Structured Logger Convergence

- Timestamp: 2026-07-01 20:40 JST
- Purpose:
  - Route `/api/set-plans/[id]` GET/PATCH unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve set-plan detail/update auth, assignment scope, stale-line
    detection, optimistic update, packaging summary refresh, workflow
    notification, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/set-plans/[id]/route.ts`
  - `src/app/api/set-plans/[id]/route.test.ts`
- Change reason:
  - The set-plans detail route handles medication set workflow state and still
    carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context across GET/PATCH.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/PATCH unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canSet` auth, `runWithRequestAuthContext`, assignment where
    filtering, RLS `withOrgContext` request context, detail select shape,
    stale-line calculation, non-object/malformed body handling, freshness token
    validation, target period validation, packaging method/profile summary
    resolution, optimistic update claim/conflict behavior, workflow dashboard
    invalidation, sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` responses.
  - Shared protected GET and PATCH matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, detail select shape change,
    stale-line algorithm change, transaction/update shape change, packaging
    summary change, workflow notification change, response DTO change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run 'src/app/api/set-plans/[id]/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `27` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "set-plans/\\[id\\] GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-patch-delete-routes.test.ts -t "set-plans/\\[id\\] PATCH" --reporter=dot --testTimeout=60000`: passed, `3` tests / `74` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/PATCH unexpected-error logging
    call shape and tests; set-plan lookup/update semantics, stale-line
    detection, workflow notifications, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set-plans generate-batches, set-audits,
    dispense audit/result, care-report, visit, patient prescription, and
    dashboard workflow/cockpit/deadline routes.

## Slice: Set-Plans Collection Structured Logger Convergence

- Timestamp: 2026-07-01 20:32 JST
- Purpose:
  - Route `/api/set-plans` GET/POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve set-plan list/create auth, assignment scope, query validation,
    duplicate/race convergence, cycle status transition rollback/conflict
    behavior, workflow notification, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/set-plans/route.ts`
  - `src/app/api/set-plans/route.test.ts`
- Change reason:
  - The set-plans collection route handles medication set workflow state and
    still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context across GET/POST.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canSet` auth, `runWithRequestAuthContext`, assignment where
    filtering, RLS `withOrgContext` request context, list filtering/order and
    select shape, non-object/malformed body handling, create validation,
    idempotent existing-plan replay, concurrent duplicate create convergence,
    packaging method/profile summary resolution, cycle transition rollback and
    conflict handling, workflow dashboard invalidation, sensitive no-store
    wrapping, `unstable_rethrow`, and fixed `INTERNAL_ERROR` responses.
  - Shared protected GET and POST matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, transaction/create shape
    change, status transition change, packaging summary change, workflow
    notification change, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/set-plans/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `33` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "set-plans GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "set-plans POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/POST unexpected-error logging
    call shape and tests; set-plan listing/creation semantics, cycle
    transition behavior, workflow notifications, and response DTOs are
    unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set-audits, set-plans detail/generate-batches,
    dispense audit/result, care-report, visit, patient prescription, and
    dashboard workflow/cockpit/deadline routes.

## Slice: Set-Batches Collection Structured Logger Convergence

- Timestamp: 2026-07-01 20:22 JST
- Purpose:
  - Route `/api/set-batches` GET/POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve set-batch list/create auth, assignment scope, serializable
    creation retry behavior, set-plan optimistic claim, validation, history
    logging, workflow notification, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/set-batches/route.ts`
  - `src/app/api/set-batches/route.test.ts`
- Change reason:
  - The set-batches collection route handles medication set workflow state and
    still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context across GET/POST.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canSet` auth, `runWithRequestAuthContext`, assignment where
    filtering, RLS `withOrgContext` request context, list ordering/include
    shape, non-object/malformed body handling, create validation, serializable
    retry behavior, stale plan/version conflicts, duplicate and quantity
    checks, packaging settings/tag resolution, narcotic handling tags,
    set-batch history snapshots/change logs, workflow dashboard invalidation,
    sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` responses.
  - Shared protected GET and POST matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, transaction/update/create
    shape change, retry policy change, packaging resolution change, history
    snapshot change, workflow notification change, response DTO change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/set-batches/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `30` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "set-batches GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "set-batches POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/POST unexpected-error logging
    call shape and tests; set-batch listing/creation semantics, history logs,
    workflow notifications, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set-audits, set-plans
    collection/detail/generate-batches, dispense audit/result, care-report,
    visit, patient prescription, and dashboard workflow/cockpit/deadline
    routes.

## Slice: Set-Batches Detail Structured Logger Convergence

- Timestamp: 2026-07-01 20:15 JST
- Purpose:
  - Route `/api/set-batches/[id]` GET/PATCH/DELETE unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve set-batch detail auth, assignment scope, optimistic locking,
    status conflict handling, history logging, workflow notification, no-store
    wrapping, and response behavior.
- Changed files:
  - `src/app/api/set-batches/[id]/route.ts`
  - `src/app/api/set-batches/[id]/route.test.ts`
- Change reason:
  - The set-batches detail route handles medication set workflow state and
    still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context across GET/PATCH/DELETE.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET/PATCH/DELETE unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canSet` auth, `runWithRequestAuthContext`, assignment where
    filtering, RLS `withOrgContext` request context, read include shape,
    malformed body handling, update validation, optimistic lock predicates,
    immutable cycle-status conflicts, set-batch history snapshots/change logs,
    workflow dashboard invalidation, delete version validation, sensitive
    no-store wrapping, `unstable_rethrow`, and fixed `INTERNAL_ERROR`
    responses.
  - Shared protected GET and PATCH/DELETE matrix entries still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, assignment predicate change, transaction/update/delete
    shape change, history snapshot change, workflow notification change,
    response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run 'src/app/api/set-batches/[id]/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `25` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "set-batches/\\[id\\] GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-patch-delete-routes.test.ts -t "set-batches/\\[id\\]" --reporter=dot --testTimeout=60000`: passed, `6` tests / `71` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET/PATCH/DELETE unexpected-error
    logging call shape and tests; set-batch lookup/update/delete semantics,
    history logs, workflow notifications, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially remaining set routes, dispense audit/result,
    care-report, visit, patient prescription, and dashboard
    workflow/cockpit/deadline routes.

## Slice: Pharmacy Stock Bulk Structured Logger Convergence

- Timestamp: 2026-07-01 20:02 JST
- Purpose:
  - Route `/api/pharmacy-drug-stocks/bulk` POST unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve pharmacy stock bulk import auth, JSON/CSV parsing, validation,
    dry-run preview, stock upsert, audit, RLS context, no-store wrapping, and
    response behavior.
- Changed files:
  - `src/app/api/pharmacy-drug-stocks/bulk/route.ts`
  - `src/app/api/pharmacy-drug-stocks/bulk/route.test.ts`
- Change reason:
  - The pharmacy stock bulk route handles medication formulary import/update
    data and still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()`
    and string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canAdmin` auth, non-object/malformed JSON handling, 1000-row
    cap, row-level reorder point validation, pharmacy site lookup, drug-master
    matching, preferred generic validation, duplicate-row detection, dry-run
    preview/no-mutation behavior, stock upsert, summary audit writes, RLS
    `withOrgContext` request context/timeouts, sensitive no-store wrapping,
    `unstable_rethrow`, and fixed `INTERNAL_ERROR` responses.
  - No shared protected POST matrix entry exists for this route; direct tests
    cover auth failure, validation, dry-run no-mutation behavior, apply/audit
    behavior, no-store behavior, and sanitized 500 fallback.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, parser behavior change, resolver change, validation
    change, transaction/update shape change, audit payload change, response DTO
    change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/pharmacy-drug-stocks/bulk/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `28` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only POST unexpected-error logging call
    shape and tests; stock import parsing, validation, DB writes, audit writes,
    dry-run semantics, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, dispense audit/result, care-report, visit,
    patient prescription, and dashboard workflow/cockpit/deadline routes.

## Slice: Pharmacy Stock Usage-Mismatch Structured Logger Convergence

- Timestamp: 2026-07-01 19:57 JST
- Purpose:
  - Route `/api/pharmacy-drug-stocks/usage-mismatch` GET unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve pharmacy stock mismatch auth, query validation, RLS context,
    QR-draft/stock reads, drug identity resolution, aggregation, no-store
    wrapping, and response behavior.
- Changed files:
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts`
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts`
- Change reason:
  - The usage-mismatch route handles QR-derived medication usage and pharmacy
    formulary stock data, but still carried duplicated `SAFE_ERROR_NAMES` /
    `safeErrorName()` and string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canAdmin` auth, query bounds, pharmacy site lookup, QR draft
    reads, stocked drug reads, drug-master matching, ambiguous-code metadata,
    mismatch aggregation, list truncation/count metadata, RLS `withOrgContext`
    request context/timeouts, sensitive no-store wrapping, `unstable_rethrow`,
    and fixed `INTERNAL_ERROR` responses.
  - No shared protected GET matrix entry exists for this route; direct tests
    cover auth failure, query validation, no-store behavior, and sanitized 500
    fallback.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, query predicate change, resolver change, aggregation
    change, sorting/truncation change, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `23` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET unexpected-error logging call
    shape and tests; stock mismatch calculation, query scope, drug identity
    resolution, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, dispense audit/result, care-report, visit,
    patient prescription, and dashboard workflow/cockpit/deadline routes.

## Slice: Medication-Cycle History Structured Logger Convergence

- Timestamp: 2026-07-01 19:48 JST
- Purpose:
  - Route `/api/medication-cycles/[id]/history` GET unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve medication-cycle history auth, org/case assignment scope, log
    loading, actor-name hydration, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/medication-cycles/[id]/history/route.ts`
  - `src/app/api/medication-cycles/[id]/history/route.test.ts`
- Change reason:
  - The medication-cycle history route handles patient medication timeline data
    and still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved auth audit path templating, `canViewDashboard` auth, request auth
    context, ID normalization, org/case assignment scope, cycle lookup,
    transition log query, actor-name hydration, route performance wrapping,
    sensitive no-store wrapping, `unstable_rethrow`, and fixed
    `INTERNAL_ERROR` responses.
  - No shared protected GET matrix entry exists for this route; direct tests
    cover auth failure, no-store behavior, blank ID rejection, not-found, and
    sanitized 500 fallback.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, auth audit path change, assignment predicate change,
    ordering change, actor hydration change, response DTO change, or unbounded
    loop.
- Validation:
  - `pnpm exec vitest run 'src/app/api/medication-cycles/[id]/history/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `16` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only GET unexpected-error logging call
    shape and tests; medication-cycle history authorization, query scope,
    ordering, actor-name mapping, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, dispense audit/result, care-report, visit,
    patient prescription, pharmacy stock, and dashboard
    workflow/cockpit/deadline routes.

## Slice: CDS Check Structured Logger Convergence

- Timestamp: 2026-07-01 19:41 JST
- Purpose:
  - Route `/api/cds/check` POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve CDS safety-check auth, validation, patient scope derivation,
    checker invocation, no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/cds/check/route.ts`
  - `src/app/api/cds/check/route.test.ts`
- Change reason:
  - The CDS check route handles patient medication safety alerts and still
    carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, JSON body validation,
    medication-cycle org ownership lookup, patient scope derivation from the
    cycle, CDS checker invocation, route performance wrapping, sensitive
    no-store wrapping, `unstable_rethrow`, and fixed `INTERNAL_ERROR`
    responses.
  - Protected POST matrix cases still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, validation change, checker argument change, request auth
    context change, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/cds/check/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `14` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "cds/check POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only POST unexpected-error logging call
    shape and tests; CDS clinical alert logic, permission, patient scope, and
    checker inputs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, dispense audit/result, care-report, visit,
    patient prescription, pharmacy stock, dashboard workflow/cockpit/deadline,
    and medication-cycle history routes.

## Slice: Tracing Reports Detail Structured Logger Convergence

- Timestamp: 2026-07-01 19:28 JST
- Purpose:
  - Route detail `/api/tracing-reports/[id]` PATCH/DELETE unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve tracing report lifecycle auth, access filtering, optimistic
    mutation claims, communication side effects, audit writes, no-store
    wrapping, and response behavior.
- Changed files:
  - `src/app/api/tracing-reports/[id]/route.ts`
  - `src/app/api/tracing-reports/[id]/route.test.ts`
- Change reason:
  - The tracing-reports detail route handles patient-linked lifecycle status
    changes, report deletion, physician names, communication requests/events,
    and audit logs, but still carried duplicated `SAFE_ERROR_NAMES` /
    `safeErrorName()` and string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    detail route.
- Commonized processing:
  - PATCH/DELETE unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canAuthorReport` auth, ID normalization, sensitive no-store
    wrapping, `unstable_rethrow`, access filtering,
    `TracingReportPatchRollback` conflict behavior, optimistic update/delete
    predicates, communication request status synchronization, communication
    event creation, audit log writes, default channel handling, PDF path
    encoding, RLS `withOrgContext` request context, response DTOs, and fixed
    `INTERNAL_ERROR` responses.
  - Direct route tests now cover PATCH and DELETE auth failures, sanitized 500
    fallbacks, PHI/SQL/stack/custom-error-name exclusion, and no side effects
    before failing lookups.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, access predicate change, transaction shape change,
    optimistic claim predicate change, audit payload change, communication
    side-effect change, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run 'src/app/api/tracing-reports/[id]/route.test.ts' src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `34` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Shared protected PATCH/DELETE matrix does not currently register this
    detail route; direct route tests now cover the relevant auth/no-store/500
    paths for this logger slice.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, dispense audit/result, care-report, visit,
    patient prescription, pharmacy stock, dashboard workflow/cockpit/deadline,
    and CDS routes.

## Slice: Tracing Reports Collection Structured Logger Convergence

- Timestamp: 2026-07-01 19:19 JST
- Purpose:
  - Route collection `/api/tracing-reports` GET/POST unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve tracing report list/create auth, access filtering, validation,
    no-store wrapping, and response behavior.
- Changed files:
  - `src/app/api/tracing-reports/route.ts`
  - `src/app/api/tracing-reports/route.test.ts`
- Change reason:
  - The tracing-reports collection route handles patient-linked report content,
    status filters, patient access predicates, and creation payloads, but still
    carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    collection route.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canReport` / `canAuthorReport` auth, request auth context,
    sensitive no-store wrapping, `unstable_rethrow`, assignment access where,
    pagination, patient-name hydration, request body validation, medication
    issue attachment checks, `withOrgContext` request context, response DTOs,
    and fixed `INTERNAL_ERROR` responses.
  - Protected GET and POST matrix cases still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, access predicate change, pagination change, request body
    validation change, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/tracing-reports/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `27` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "tracing-reports GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "tracing-reports POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting the route file.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only collection GET/POST unexpected-error
    logging call shape and tests; detail `[id]` tracing-report lifecycle route
    was handled separately in the 2026-07-01 19:28 JST detail slice above.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially tracing-reports `[id]`, set, dispense
    audit/result, care-report, and visit routes.

## Slice: Staff Workload Structured Logger Convergence

- Timestamp: 2026-07-01 19:12 JST
- Purpose:
  - Route `/api/staff-workload` GET unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve staff workload auth/date/RLS/query/response behavior.
- Changed files:
  - `src/app/api/staff-workload/route.ts`
  - `src/app/api/staff-workload/route.test.ts`
- Change reason:
  - The staff-workload route handles patient-linked visit names, staff/task
    workload titles, and raw SQL task previews, but still carried duplicated
    `SAFE_ERROR_NAMES` / `safeErrorName()` and string-overload logging context.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, date validation, no-store
    wrapping, `unstable_rethrow`, RLS `withOrgContext` request context, raw SQL
    task preview query, visit/dispense/task query shapes, role labels, sorting,
    response DTOs, and fixed `INTERNAL_ERROR` response.
  - Direct route tests cover auth failure, invalid date filters, duplicate date
    rejection, no-store wrapping, sanitized 500, and response contracts.
  - Protected GET matrix cases still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, raw SQL query change, RLS request-context change, date
    parsing change, response DTO change, sorting change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/staff-workload/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `18` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "staff-workload GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    the route-test assertion proving route context has no `error_name`.
  - Scoped Prettier passed after formatting the route file.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; staff workload calculations, tenant scope, response DTOs, and
    auth/date validation behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially tracing-report, set, dispense audit/result,
    care-report, and visit routes.

## Slice: Billing Evidence Structured Logger Convergence

- Timestamp: 2026-07-01 19:02 JST
- Purpose:
  - Route `/api/billing-evidence/analytics`, `/api/billing-evidence/stats`,
    and `/api/billing-evidence/check` GET unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve billing KPI/analytics/check read-only behavior, auth, no-store,
    RLS request context, query shapes, and fixed internal-error responses.
- Changed files:
  - `src/app/api/billing-evidence/analytics/route.ts`
  - `src/app/api/billing-evidence/analytics/route.test.ts`
  - `src/app/api/billing-evidence/stats/route.ts`
  - `src/app/api/billing-evidence/stats/route.test.ts`
  - `src/app/api/billing-evidence/check/route.ts`
  - `src/app/api/billing-evidence/check/route.test.ts`
- Change reason:
  - Billing evidence routes handle patient-linked billing KPI and review data,
    but still carried route-local error-name sanitizers and string-overload
    logger contexts after the shared logger became the stricter canonical
    PHI/secret-safe route logger.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from
    analytics.
  - Removed route-local regex `safeErrorName()` helpers from stats and check.
- Commonized processing:
  - All three GET unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to shared logger contract tests.
- Safety:
  - Preserved `canReport` auth, request auth context, sensitive no-store
    wrapping, `unstable_rethrow`, billing month calculations, Prisma read query
    shapes, RLS `withOrgContext` timeout usage in check, patient href encoding,
    today ops rail composition, KPI/analytics DTOs, invalid query behavior, and
    fixed `INTERNAL_ERROR` response.
  - Direct route tests cover auth failure/no-store/sanitized 500; protected GET
    matrix currently has no billing-evidence analytics/stats/check entries.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, RLS timeout change, billing month calculation change,
    query predicate change, Promise.all structure change, response DTO change,
    or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/billing-evidence/analytics/route.test.ts src/app/api/billing-evidence/stats/route.test.ts src/app/api/billing-evidence/check/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `4` files / `24` tests.
  - Route-local sanitizer grep returned only shared logger contract lines and
    test assertions proving route contexts have no `error_name`.
  - Scoped Prettier passed after formatting route files.
  - Scoped ESLint passed.
  - Scoped `git diff --check` passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; billing calculations, tenant scope, response DTOs, and auth
    behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially staff-workload, set, care-report, visit,
    tracing-report, dashboard workflow/cockpit/deadline, and patient
    prescription routes.

## Slice: Ops Refactor Artifact Sync

- Timestamp: 2026-07-01 18:51 JST
- Purpose:
  - Create the objective-required `ops/refactor` state files so the broad
    refactor loop can be resumed from repository artifacts rather than
    conversation state.
  - Record the current code map, findings, plan, log, verification evidence,
    remaining logger convergence candidates, and proposal-only safety
    boundaries.
- Changed files:
  - `ops/refactor/STATE.md`
  - `ops/refactor/CODE_MAP.md`
  - `ops/refactor/BUG_FINDINGS.md`
  - `ops/refactor/INCONSISTENCY_FINDINGS.md`
  - `ops/refactor/DEAD_CODE_FINDINGS.md`
  - `ops/refactor/PERF_FINDINGS.md`
  - `ops/refactor/REFACTOR_PLAN.md`
  - `ops/refactor/REFACTOR_LOG.md`
  - `ops/refactor/VERIFICATION.md`
- Change reason:
  - The active refactor objective requires resumable state files under
    `ops/refactor/`; only the root `REFACTOR_*` artifacts existed before this
    slice.
- Safety:
  - Documentation/state only.
  - No runtime code, API contract, DB schema, RLS, auth/authz, audit, billing,
    medical workflow, external send, dependency, production config, deployment,
    or UI behavior changed.
- Performance:
  - No runtime performance change claimed.
- Validation:
  - `pnpm exec prettier --check ops/refactor/*.md`: passed.
  - `pnpm exec prettier --check ops/refactor/*.md CODEX_GOAL_PROGRESS.md REFACTOR_REPORT.md REFACTOR_EXECUTION_PLAN.md`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check -- ops/refactor/*.md`: passed.
  - `git diff --check -- ops/refactor/*.md CODEX_GOAL_PROGRESS.md REFACTOR_REPORT.md REFACTOR_EXECUTION_PLAN.md .codex/ralph-state.md`: passed.
- Next improvements:
  - Continue with a small route-local logger convergence candidate, likely
    billing-evidence, staff-workload, set, care-report, or visit routes.

## Slice: Comments Structured Logger Convergence

- Timestamp: 2026-07-01 18:47 JST
- Purpose:
  - Route `/api/comments` GET/POST unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve comment thread listing, comment creation, mention validation,
    notification dispatch, realtime broadcast, no-store responses, and fixed
    internal-error behavior.
- Changed files:
  - `src/app/api/comments/route.ts`
  - `src/app/api/comments/route.test.ts`
- Change reason:
  - Comments handle patient-linked collaboration entities, comment content,
    mention recipients, notification messages, and realtime refreshes, but
    still carried duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and
    string-overload logging contexts.
  - The shared logger now provides the stricter canonical PHI/secret-safe
    object overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    comments route.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canViewDashboard` auth, request auth context, collaboration
    entity validation, per-entity access filtering, comment ordering,
    author-name hydration, mention normalization/deduplication, membership
    recipient validation, entity link generation, notification dispatch,
    realtime broadcast, no-store wrapping, and fixed `INTERNAL_ERROR`
    response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw patient/comment sentinels, unsafe custom error names,
    and route-local `error_name`.
  - Protected GET/POST route matrix cases still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, notification dispatch change, realtime broadcast change,
    response DTO change, mention validation change, ordering change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/comments/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `35` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `comments` logging: expected only test assertions proving
    route contexts have no `error_name`.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "comments GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "comments POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed comments files: passed.
  - Scoped ESLint for changed comments files: passed.
  - Scoped `git diff --check` for comments files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; comment list/create semantics, mention side effects,
    notification/realtime behavior, response DTOs, and auth behavior are
    unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, collaboration
    access semantics, notification/realtime semantics, response contracts,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially billing-evidence, set, care-report, staff-workload,
    and visit routes.

## Slice: Communication Request Responses Structured Logger Convergence

- Timestamp: 2026-07-01 18:40 JST
- Purpose:
  - Route `/api/communication-requests/[id]/responses` GET/POST
    unexpected-error logs through the shared PHI/secret-safe structured logger
    object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve response listing/create auth, patient/case access checks,
    care-report permission gates, idempotent response writes, audit payload
    redaction, no-store responses, and fixed internal-error behavior.
- Changed files:
  - `src/app/api/communication-requests/[id]/responses/route.ts`
  - `src/app/api/communication-requests/[id]/responses/route.test.ts`
- Change reason:
  - Communication response routes handle patient-linked request state,
    responder names, response content, care-report permissions, and audit
    metadata, but still carried duplicated `SAFE_ERROR_NAMES` /
    `safeErrorName()` and string-overload logging contexts.
  - The shared logger now provides the stricter canonical PHI/secret-safe
    object overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    communication request responses route.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canReport` auth, request auth context, route-param validation,
    patient/case access filtering, care-report view/write permission gates,
    response listing order, optimistic update conflict behavior, idempotent
    response upsert, audit entry redaction, no-store wrapping, and fixed
    `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw patient/response-content sentinels, unsafe custom
    error names, and route-local `error_name`.
  - Protected GET/POST route matrix cases still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, audit write change, transaction change, response DTO
    change, ordering change, idempotency change, conflict behavior change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts 'src/app/api/communication-requests/[id]/responses/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `2` files / `34` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `communication_request_responses` logging: expected only
    test assertions proving route contexts have no `error_name`.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "communication-requests/\\[id\\]/responses GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "communication-requests/\\[id\\]/responses POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed communication-response files: passed.
  - Scoped ESLint for changed communication-response files: passed.
  - Scoped `git diff --check` for communication-response files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; communication response listing/write semantics, access checks,
    audit behavior, idempotency, response DTOs, and auth behavior are
    unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, communication
    request workflow semantics, response/audit payload semantics, response
    contracts, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially comments, billing-evidence, set, care-report, and
    visit routes.

## Slice: Consent Records Structured Logger Convergence

- Timestamp: 2026-07-01 18:33 JST
- Purpose:
  - Route `/api/consent-records` GET/POST unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve consent list/create auth, patient/case scope checks, audit
    fail-closed behavior, document URL/file validation, no-store responses, and
    fixed internal-error behavior.
- Changed files:
  - `src/app/api/consent-records/route.ts`
  - `src/app/api/consent-records/route.test.ts`
- Change reason:
  - Consent records handle patient-linked consent state, consent document URLs,
    uploaded consent document files, and audit failure paths, but still carried
    duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` and string-overload
    logging contexts.
  - The shared logger now provides the stricter canonical PHI/secret-safe
    object overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    consent records route.
- Commonized processing:
  - GET/POST unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, pagination parsing,
    consent-type validation, patient/case assignment filtering, document
    URL/file validation, template selection, duplicate-active-consent guard,
    RLS org context, audit fail-closed behavior, no-store wrapping, and fixed
    `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw consent document URL sentinels, unsafe custom error
    names, and route-local `error_name`.
  - Protected GET/POST route matrix cases still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, audit write change, transaction change, response DTO
    change, document URL normalization change, pagination change, or unbounded
    loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/consent-records/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `23` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `consent_records` logging: expected only test assertions
    proving route contexts have no `error_name`.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "consent-records GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "consent-records POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed consent-record files: passed.
  - Scoped ESLint for changed consent-record files: passed.
  - Scoped `git diff --check` for consent-record files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; consent list/create query semantics, access checks, audit
    fail-closed behavior, response DTOs, and auth behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, consent/audit
    semantics, document URL/file semantics, response contracts, production
    config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, care-report, communication, billing-evidence,
    and visit routes.

## Slice: Drug Master Imports Structured Logger Convergence

- Timestamp: 2026-07-01 18:27 JST
- Purpose:
  - Route `/api/drug-master-imports/mhlw-price`,
    `/api/drug-master-imports/mhlw-generic`,
    `/api/drug-master-imports/hot`, `/api/drug-master-imports/ssk`,
    `/api/drug-master-imports/pmda`, and
    `/api/drug-master-imports/manual-clinical` unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve import auth, source URL validation, request body validation,
    dry-run preview behavior, import service calls, no-store responses, and
    fixed internal-error behavior.
- Changed files:
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
- Change reason:
  - Drug master import routes handle external workbook/zip/file source URLs,
    drug master import metadata, package inserts, generic mappings, and manual
    clinical rules, but still carried duplicated `SAFE_ERROR_NAMES` /
    `safeErrorName()` copies and string-overload logging contexts.
  - The shared logger now provides the stricter canonical PHI/secret-safe
    object overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the six
    drug-master-import routes.
- Commonized processing:
  - Unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canAdmin` auth, request auth context, JSON/body validation,
    allowed import source URL policies, dry-run preview branches, import
    service dispatch, manual clinical RLS org context, projected import-log
    metadata, no-store wrapping, and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw import/preview error sentinels, unsafe custom error
    names, and route-local `error_name`.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, import parser change, service call change, transaction
    change, response DTO change, source URL policy change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/app/api/drug-master-imports/mhlw-price/route.test.ts src/app/api/drug-master-imports/mhlw-generic/route.test.ts src/app/api/drug-master-imports/hot/route.test.ts src/app/api/drug-master-imports/ssk/route.test.ts src/app/api/drug-master-imports/pmda/route.test.ts src/app/api/drug-master-imports/manual-clinical/route.test.ts src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `7` files / `86` tests.
  - Route-local sanitizer grep for `SAFE_ERROR_NAMES`, `safeErrorName`, and
    string-overload `drug_master_imports` logging: expected only test
    assertions proving route contexts have no `error_name`.
  - `rg -n "drug-master-imports|drugMasterImports|drug_master_imports" src/app/api/__tests__/protected-*.test.ts src/app/api/__tests__ -g '*.test.ts'`: no protected route matrix entry exists for these routes.
  - Scoped Prettier check for changed drug-master-import files: passed.
  - Scoped ESLint for changed drug-master-import files: passed.
  - Scoped `git diff --check` for drug-master-import files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; import URL policy, external parser/service semantics, dry-run
    previews, import log projection, response DTOs, and auth behavior are
    unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
  - There is no protected-route matrix entry for these routes today; existing
    route tests cover admin auth/no-store and sanitized 500 behavior.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, medication
    identity semantics, import parser/service semantics, external sends,
    response contracts, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, care-report, consent, communication, and
    visit routes.

## Slice: Drug Masters Structured Logger Convergence

- Timestamp: 2026-07-01 18:16 JST
- Purpose:
  - Route `/api/drug-masters`, `/api/drug-masters/[id]`,
    `/api/drug-masters/batch`,
    `/api/drug-masters/[id]/generic-recommendations`,
    `/api/drug-masters/[id]/ingredient-group`, and
    `/api/drug-masters/[id]/package-insert` unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve drug search, detail, batch lookup, generic recommendation,
    ingredient group, package-insert, no-store response, and fixed
    internal-error behavior.
- Changed files:
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
- Change reason:
  - Drug master routes handle drug names, YJ/receipt/HOT/JAN codes, package
    insert safety sections, interactions, generic mapping, pharmacy stock
    overlays, and batch identifiers, but still carried duplicated
    `SAFE_ERROR_NAMES` / `safeErrorName()` copies and string-overload logging
    contexts.
  - The shared logger now provides the stricter canonical PHI/secret-safe
    object overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the six
    drug-master routes.
- Commonized processing:
  - Unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved auth requirements, request auth context, parameter/query/body
    validation, RLS org context, site validation, drug lookup/search/batch
    logic, stock overlay logic, generic recommendation math, ingredient group
    summary, package insert formatting, no-store wrapping, and fixed
    `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw drug-master error sentinels, unsafe custom error
    names, and route-local `error_name`.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, sort behavior,
    response DTO change, package-insert formatting change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/drug-masters/route.test.ts 'src/app/api/drug-masters/[id]/route.test.ts' src/app/api/drug-masters/batch/route.test.ts 'src/app/api/drug-masters/[id]/generic-recommendations/route.test.ts' 'src/app/api/drug-masters/[id]/ingredient-group/route.test.ts' 'src/app/api/drug-masters/[id]/package-insert/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `7` files / `62` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('drug_masters|error_name" src/app/api/drug-masters --glob 'route.ts' --glob '*.test.ts'`: expected only test assertions proving route contexts have no `error_name`.
  - `rg -n "drug-masters|drugMasters|drug_masters" src/app/api/__tests__/protected-*.test.ts src/app/api/__tests__ -g '*.test.ts'`: no protected route matrix entry exists for these routes.
  - Scoped Prettier check for changed drug-master/logger files: passed.
  - Scoped ESLint for changed drug-master files: passed.
  - Scoped `git diff --check` for drug-master files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only unexpected-error logging call shape
    and tests; drug-master query semantics, safety-section formatting,
    generic/ingredient grouping, batch lookup, response DTOs, and auth behavior
    are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
  - There is no protected-route matrix entry for these routes today; existing
    route tests cover auth/no-store and sanitized 500 behavior.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, medication
    identity semantics, package-insert safety semantics, response contracts,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially set, care-report, consent, communication, and
    visit routes.

## Slice: Dispense Task Verify Barcode Structured Logger Convergence

- Timestamp: 2026-07-01 18:06 JST
- Purpose:
  - Route `/api/dispense-tasks/[id]/verify-barcode` POST unexpected-error
    logs through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve dispense permission checks, assignment scope filtering, request
    validation, task/line lookups, barcode verification, no-store responses,
    and fixed internal-error behavior.
- Changed files:
  - `src/app/api/dispense-tasks/[id]/verify-barcode/route.ts`
  - `src/app/api/dispense-tasks/[id]/verify-barcode/route.test.ts`
- Change reason:
  - The dispense barcode verification route handles patient-linked dispense
    tasks, prescription lines, drug codes/names, and GTIN barcode data, but
    still carried a duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` copy and
    string-overload logging context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    dispense barcode verification route.
- Commonized processing:
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - The route test asserts only minimal operational context is supplied by the
    route and delegates raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canDispense` auth, request auth context, route-param
    validation, JSON/body validation, assignment-scope task lookup, task-cycle
    prescription-line lookup, barcode parsing/verification behavior, no-store
    wrapping, and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 test proves the HTTP body and route-supplied logger
    context exclude raw patient, SQL/stack, GTIN, unsafe custom error-name
    sentinels, and route-local `error_name`.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, response DTO
    change, barcode parsing change, assignment-scope behavior change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts 'src/app/api/dispense-tasks/[id]/verify-barcode/route.test.ts' src/lib/dispensing/dispense-barcode-verification.test.ts --reporter=dot --testTimeout=60000`: passed, `3` files / `22` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('dispense_task_verify_barcode_unhandled_error|error_name" 'src/app/api/dispense-tasks/[id]/verify-barcode/route.ts' 'src/app/api/dispense-tasks/[id]/verify-barcode/route.test.ts'`: expected only the test assertion proving route context has no `error_name`.
  - `rg -n "dispense-tasks/.+verify-barcode|verifyBarcode|verify-barcode" src/app/api/__tests__/protected-*.test.ts src/app/api/__tests__ -g '*.test.ts'`: no protected route matrix entry exists for this route.
  - Scoped Prettier check for changed verify-barcode/logger/barcode files:
    passed.
  - Scoped ESLint for changed verify-barcode/barcode files: passed.
  - Scoped `git diff --check` for verify-barcode files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only POST unexpected-error logging call
    shape and tests; dispense permission semantics, assignment-scope filtering,
    task/line lookup behavior, barcode verification semantics, and response
    DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
  - There is no protected-route matrix entry for this route today; existing
    route tests cover auth/permission, no-store, malformed input, assignment
    scope, line-scope, and sanitized 500 behavior.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, medication identity semantics, barcode parsing semantics,
    response contracts, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially drug-master, set, care-report, consent,
    communication, and visit routes.

## Slice: First Visit Documents Print Batch Structured Logger Convergence

- Timestamp: 2026-07-01 17:59 JST
- Purpose:
  - Route `/api/first-visit-documents/print-batch` POST unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve first-visit print-batch validation, selected-document lookup,
    patient/case access checks, print-readiness blocking, copy URL updates,
    optimistic concurrency handling, audit logging, no-store responses, and
    fixed internal-error behavior.
- Changed files:
  - `src/app/api/first-visit-documents/print-batch/route.ts`
  - `src/app/api/first-visit-documents/print-batch/route.test.ts`
- Change reason:
  - The print-batch route handles patient-linked document IDs, generated print
    copy URLs, delivery recipients, and audit history, but still carried a
    duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` copy and string-overload
    logging context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    first-visit documents print-batch route.
- Commonized processing:
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - The route test asserts only minimal operational context is supplied by the
    route and delegates raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, JSON/body validation,
    selected-document lookup, patient/case assignment filtering, print
    readiness checks, generated print-batch ID behavior, save-copy URL update
    behavior, optimistic concurrency conflict handling, audit-log field shape,
    no-store wrapping, and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 test proves the HTTP body and route-supplied logger
    context exclude raw first-visit print-batch sentinels, patient-name
    sentinels, unsafe custom error names, and route-local `error_name`.
  - Protected POST matrix cases for first-visit document print-batch still
    pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, response DTO change, audit write change, print-readiness behavior
    change, copy URL behavior change, optimistic-lock behavior change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/first-visit-documents/print-batch/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `16` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('first_visit_documents_print_batch_post_unhandled_error|error_name" src/app/api/first-visit-documents/print-batch/route.ts src/app/api/first-visit-documents/print-batch/route.test.ts`: expected only the test assertion proving route context has no `error_name`.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "first-visit-documents/print-batch POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed first-visit-documents print-batch/logger
    files: passed.
  - Scoped ESLint for changed first-visit-documents print-batch files: passed.
  - Scoped `git diff --check` for first-visit-documents print-batch files:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only print-batch POST unexpected-error
    logging call shape and tests; print-batch document selection, copy URL
    writes, readiness blocking, optimistic locking, audit semantics, response
    DTOs, and auth behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, first-visit document business semantics, print-readiness
    semantics, audit meaning, transaction side effects, response contracts,
    external sends, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially dispense, drug-master, set, care-report, consent,
    and communication routes.

## Slice: First Visit Documents Detail Structured Logger Convergence

- Timestamp: 2026-07-01 17:52 JST
- Purpose:
  - Route `/api/first-visit-documents/[id]` PATCH unexpected-error logs
    through the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve first-visit document update validation, writable-patient guard,
    print-readiness blocking, optimistic concurrency handling, audit logging,
    no-store responses, and fixed internal-error behavior.
- Changed files:
  - `src/app/api/first-visit-documents/[id]/route.ts`
  - `src/app/api/first-visit-documents/[id]/route.test.ts`
- Change reason:
  - The first-visit document detail route handles patient-linked signed
    document URLs, delivery targets, print history, and audit changes, but
    still carried a duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` copy and
    string-overload logging context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    first-visit documents detail route.
- Commonized processing:
  - PATCH unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - The route test asserts only minimal operational context is supplied by the
    route and delegates raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, route-param validation,
    JSON/body validation, document URL validation, patient/case assignment
    filtering, writable-patient guard, print-readiness checks, optimistic
    concurrency conflict handling, audit-log field shape, no-store wrapping,
    and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 test proves the HTTP body and route-supplied logger
    context exclude raw first-visit document patch sentinels, patient-name
    sentinels, unsafe custom error names, and route-local `error_name`.
  - Protected PATCH matrix cases for first-visit document detail still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, response DTO change, audit write change, print-readiness behavior
    change, optimistic-lock behavior change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts 'src/app/api/first-visit-documents/[id]/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `2` files / `29` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('first_visit_documents_id_patch_unhandled_error|error_name" 'src/app/api/first-visit-documents/[id]/route.ts' 'src/app/api/first-visit-documents/[id]/route.test.ts'`: expected only the test assertion proving route context has no `error_name`.
  - `pnpm exec vitest run src/app/api/__tests__/protected-patch-delete-routes.test.ts -t "first-visit-documents/\\[id\\] PATCH" --reporter=dot --testTimeout=60000`: passed, `6` tests / `71` skipped.
  - Scoped Prettier check for changed first-visit-documents detail/logger
    files: passed.
  - Scoped ESLint for changed first-visit-documents detail files: passed.
  - Scoped `git diff --check` for first-visit-documents detail files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only detail PATCH unexpected-error logging
    call shape and tests; first-visit document update semantics, print
    readiness, optimistic locking, audit semantics, response DTOs, and auth
    behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, first-visit document business semantics, print-readiness
    semantics, audit meaning, transaction side effects, response contracts,
    external sends, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially first-visit-documents print-batch, dispense,
    drug-master, and set routes.

## Slice: First Visit Documents Structured Logger Convergence

- Timestamp: 2026-07-01 17:44 JST
- Purpose:
  - Route `/api/first-visit-documents` GET/POST unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve first-visit document filters, assignment/case access checks,
    patient write guard, contact/template derivation, audit logging, no-store
    responses, and fixed internal-error behavior.
- Changed files:
  - `src/app/api/first-visit-documents/route.ts`
  - `src/app/api/first-visit-documents/route.test.ts`
- Change reason:
  - First-visit documents include patient-linked emergency contact details,
    template metadata, document URLs, and generated audit entries, but the
    collection route still carried a duplicated `SAFE_ERROR_NAMES` /
    `safeErrorName()` copy and string-overload logging context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    first-visit documents collection route.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, patient/case assignment
    filtering, strict query validation, patient write guard, emergency-contact
    fallback/validation, template lookup, document URL validation, audit-log
    field shape, no-store wrapping, and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw first-visit document error sentinels, patient-name
    sentinels, unsafe custom error names, and route-local `error_name`.
  - Protected GET/POST matrix cases for first-visit documents still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, response DTO change, audit write change, contact/template fallback
    change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/first-visit-documents/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `36` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('first_visit_documents_(get|post)_unhandled_error" src/app/api/first-visit-documents/route.ts src/app/api/first-visit-documents/route.test.ts`: expected no matches.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "first-visit-documents GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "first-visit-documents POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed first-visit-documents/logger files:
    passed.
  - Scoped ESLint for changed first-visit-documents files: passed.
  - Scoped `git diff --check` for first-visit-documents files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only collection route logging call shape
    and tests; first-visit document persistence, patient/case access semantics,
    contact/template derivation, audit semantics, response DTOs, and auth
    behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, first-visit document business semantics, contact/template
    semantics, audit meaning, transaction side effects, response contracts,
    external sends, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially first-visit-documents `[id]` / print-batch,
    dispense, drug-master, and set routes.

## Slice: Residual Medications Structured Logger Convergence

- Timestamp: 2026-07-01 17:36 JST
- Purpose:
  - Route `/api/residual-medications` GET/POST unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve residual medication filters, assignment access checks,
    DrugMaster identity validation, create behavior, no-store responses, and
    fixed internal-error behavior.
- Changed files:
  - `src/app/api/residual-medications/route.ts`
  - `src/app/api/residual-medications/route.test.ts`
- Change reason:
  - Residual medications contain patient-linked visit records, drug names,
    quantities, and reduction-target indicators, but the route still carried a
    duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` copy and string-overload
    logging context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    residual medications route.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, visit-record assignment
    filtering, strict `visit_record_id` / `patient_id` validation, bounded
    `limit` validation, inaccessible visit-record empty-list/404 behavior,
    DrugMaster identity validation, residual create calculations, no-store
    wrapping, and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw residual medication error sentinels, unsafe custom
    error names, and route-local `error_name`.
  - Protected GET/POST matrix cases for residual medications still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, response DTO change, limit behavior change, residual calculation
    change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/residual-medications/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `30` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('residual_medications" src/app/api/residual-medications/route.ts src/app/api/residual-medications/route.test.ts`: expected no matches.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "residual-medications GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "residual-medications POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed residual-medications/logger files:
    passed.
  - Scoped ESLint for changed residual-medications files: passed.
  - Scoped `git diff --check` for residual-medications files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only route logging call shape and tests;
    residual medication persistence, visit-record assignment semantics,
    DrugMaster identity semantics, limit validation, residual calculations,
    response DTOs, and auth behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, residual medication business semantics, DrugMaster identity
    semantics, audit meaning, transaction side effects, response contracts,
    external sends, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially first-visit-documents, dispense, drug-master,
    and set routes.

## Slice: Medication Profiles Structured Logger Convergence

- Timestamp: 2026-07-01 17:28 JST
- Purpose:
  - Route `/api/medication-profiles` GET/POST unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve medication profile filters, patient access checks, DrugMaster
    reference validation, create behavior, no-store responses, and fixed
    internal-error behavior.
- Changed files:
  - `src/app/api/medication-profiles/route.ts`
  - `src/app/api/medication-profiles/route.test.ts`
- Change reason:
  - Medication profiles contain patient-linked drug names, dose/frequency, and
    prescriber fields, but the collection route still carried a duplicated
    `SAFE_ERROR_NAMES` / `safeErrorName()` copy and string-overload logging
    context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    medication profiles route.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, patient assignment access
    filtering, strict `patient_id` / `is_current` query validation,
    inaccessible-patient empty-list behavior, inaccessible create 404
    behavior, DrugMaster id validation, blank DrugMaster normalization,
    date normalization, `withOrgContext` create behavior, no-store wrapping,
    and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw medication profile error sentinels, unsafe custom
    error names, and route-local `error_name`.
  - Protected GET/POST matrix cases for medication profiles still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, response DTO change, pagination change, date conversion change, or
    unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/medication-profiles/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `29` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('medication_profiles" src/app/api/medication-profiles/route.ts src/app/api/medication-profiles/route.test.ts`: expected no matches.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "medication-profiles GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "medication-profiles POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed medication-profiles/logger files:
    passed.
  - Scoped ESLint for changed medication-profiles files: passed.
  - Scoped `git diff --check` for medication-profiles files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only route logging call shape and tests;
    medication profile persistence, patient access semantics, DrugMaster
    reference semantics, pagination, date conversion, response DTOs, and auth
    behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, medication profile business semantics, DrugMaster identity
    semantics, audit meaning, transaction side effects, response contracts,
    external sends, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially residual-medications, first-visit-documents,
    dispense, drug-master, and set routes.

## Slice: Medication Issues Structured Logger Convergence

- Timestamp: 2026-07-01 17:21 JST
- Purpose:
  - Route `/api/medication-issues` GET/POST unexpected-error logs through the
    shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve medication issue filters, access-scope checks, validation,
    create transaction behavior, no-store responses, and fixed internal-error
    behavior.
- Changed files:
  - `src/app/api/medication-issues/route.ts`
  - `src/app/api/medication-issues/route.test.ts`
- Change reason:
  - Medication issues contain patient-linked medication problem narratives and
    assignment-sensitive data, but the collection route still carried a
    duplicated `SAFE_ERROR_NAMES` / `safeErrorName()` copy and string-overload
    logging context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` and `safeErrorName()` from the
    medication issues collection route.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the
    route and delegate raw `Error` redaction to the shared logger contract
    tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, patient/case assignment
    filtering, strict query validation, status validation, org reference
    validation, inaccessible-patient empty-list behavior, inaccessible create
    404 behavior, `withOrgContext` create behavior, no-store wrapping, and
    fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw medication issue error sentinels, unsafe custom error
    names, and route-local `error_name`.
  - Protected GET/POST matrix cases for medication issues still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, response DTO change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/medication-issues/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `29` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('medication_issues" src/app/api/medication-issues/route.ts src/app/api/medication-issues/route.test.ts`: expected no matches.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "medication-issues GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "medication-issues POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - Scoped Prettier check for changed medication-issues/logger files: passed
    after formatting `src/app/api/medication-issues/route.ts`.
  - Scoped ESLint for changed medication-issues files: passed.
  - Scoped `git diff --check` for medication-issues files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`:
    passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only route logging call shape and tests;
    medication issue persistence, assignment-scope semantics, status defaults,
    response DTOs, and auth behavior are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, medication issue business semantics, audit meaning, transaction
    side effects, response contracts, external sends, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially medication-profiles, residual-medications,
    first-visit-document, dispense, drug-master, and set routes.

## Slice: Inquiry Records Structured Logger Convergence

- Timestamp: 2026-07-01 17:12 JST
- Purpose:
  - Route `/api/inquiry-records` GET/POST and
    `/api/inquiry-records/[id]` PATCH unexpected-error logs through the shared
    PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve inquiry record filters, validation, medication-cycle assignment
    scope, transaction side effects, audit changes, no-store responses, and
    fixed internal-error behavior.
- Changed files:
  - `src/app/api/inquiry-records/route.ts`
  - `src/app/api/inquiry-records/route.test.ts`
  - `src/app/api/inquiry-records/[id]/route.ts`
  - `src/app/api/inquiry-records/[id]/route.test.ts`
- Change reason:
  - Inquiry records include patient-linked prescription questions, physician
    inquiry content, medication line updates, and operational-task side
    effects, but both collection and detail routes still carried duplicated
    `SAFE_ERROR_NAMES` / `safeErrorName()` copies and string-overload logging
    context.
  - The shared logger now provides the stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed route-local `SAFE_ERROR_NAMES` sets and `safeErrorName()` helpers
    from both inquiry record route files.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - PATCH unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by routes
    and delegate raw `Error` redaction to the shared logger contract tests.
- Safety:
  - Preserved `canVisit` auth, request auth context, patient/cycle assignment
    filtering, status/limit parsing, blank filter validation, non-object and
    malformed body validation, create transaction side effects, PATCH conflict
    handling, guarded prescription-line update behavior, task resolution,
    communication request closing, audit-log field shape, no-store wrapping,
    and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove HTTP bodies and route-supplied logger
    contexts exclude raw inquiry error sentinels, unsafe custom error names,
    and route-local `error_name`.
  - Protected GET/POST/PATCH matrix cases for inquiry records still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, transaction
    branch, audit write, operational-task behavior, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/inquiry-records/route.test.ts 'src/app/api/inquiry-records/[id]/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `3` files / `44` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('inquiry" src/app/api/inquiry-records/route.ts src/app/api/inquiry-records/[id]/route.ts src/app/api/inquiry-records/route.test.ts src/app/api/inquiry-records/[id]/route.test.ts`: expected no matches.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "inquiry-records GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "inquiry-records POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-patch-delete-routes.test.ts -t "inquiry-records/\\[id\\] PATCH" --reporter=dot --testTimeout=60000`: passed, `6` tests / `71` skipped.
  - Scoped Prettier check for changed inquiry/logger files: passed.
  - Scoped ESLint for changed inquiry files: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only route logging call shape and tests;
    inquiry persistence, medication line updates, communication events,
    operational tasks, audit semantics, and response DTOs are unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, prescription/medication semantics, audit meaning, transaction
    side effects, response contracts, external sends, production config,
    secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially medication, dispense, drug-master, and
    first-visit-document routes.

## Slice: Patient Self Reports Structured Logger Convergence

- Timestamp: 2026-07-01 17:04 JST
- Purpose:
  - Route `/api/patient-self-reports` GET/POST unexpected-error logs through
    the shared PHI/secret-safe structured logger object overload.
  - Remove route-local `safeErrorName()` duplication now that the shared logger
    owns safe error-name normalization and raw `Error` redaction.
  - Preserve patient self-report auth, assignment-scope checks, no-store
    behavior, validation responses, audit minimization, response DTOs, and fixed
    internal-error behavior.
- Changed files:
  - `src/app/api/patient-self-reports/route.ts`
  - `src/app/api/patient-self-reports/route.test.ts`
- Change reason:
  - Patient self reports contain patient/family narratives and callback
    preferences, but the route still carried a local `SAFE_ERROR_NAMES` /
    `safeErrorName()` copy and string-overload logging context.
  - The shared logger now provides a stricter canonical PHI-safe object
    overload for raw errors.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()`.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert the route supplies only minimal operational context and
    delegates raw `Error` redaction to the shared logger contract tests.
- Safety:
  - Preserved `canReport` auth for GET/POST, `runWithRequestAuthContext`,
    assignment-scope filtering, explicit empty filter validation, status schema
    validation, non-object/malformed body validation, unassigned-patient 404,
    `withOrgContext`, audit-log minimized `changes`, clerk masking, response
    serialization, no-store wrapping, and fixed `INTERNAL_ERROR` response.
  - Updated sanitized 500 tests prove the HTTP body and route-supplied logger
    context exclude raw self-report error sentinels, unsafe custom error names,
    and route-local `error_name`.
  - Protected GET/POST matrix cases for `patient-self-reports` still pass.
- Performance:
  - Logging call-shape and duplicated helper removal only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, query predicate, response
    serialization change, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/patient-self-reports/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `26` tests.
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName|logger\\.error\\('patient_self_reports" src/app/api/patient-self-reports/route.ts src/app/api/patient-self-reports/route.test.ts`: expected no matches.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "patient-self-reports GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts -t "patient-self-reports POST" --reporter=dot --testTimeout=60000`: passed, `3` tests / `142` skipped.
  - `pnpm exec prettier --check src/app/api/patient-self-reports/route.ts src/app/api/patient-self-reports/route.test.ts src/lib/utils/logger.ts src/lib/utils/logger.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/patient-self-reports/route.ts src/app/api/patient-self-reports/route.test.ts`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - This slice intentionally changes only route logging call shape and tests;
    persisted self-report content, audit semantics, and response DTOs are
    unchanged.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, audit meaning, patient self-report persistence, response
    contracts, external sends, production config, secrets, deployment, and
    dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates with existing
    focused tests, especially remaining PHI-bearing self-report/detail,
    inquiry, medication, and dispense routes.

## Slice: Shared Logger String Overload Error Redaction Hardening

- Timestamp: 2026-07-01 16:55 JST
- Purpose:
  - Close the Low follow-up from monthly-stats privacy review where the legacy
    `logger.error(string, error, ctx)` runtime path could emit raw
    `Error.message`, `stack`, or raw non-Error values.
  - Preserve existing typed string-overload call sites that use
    `logger.error('event', undefined, ctx)`.
  - Avoid changing API, DB, auth, route response, or UI behavior.
- Changed files:
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Change reason:
  - A TypeScript AST inventory found `125` `logger.error` call sites and `0`
    existing string/template overload calls with a non-`undefined` second
    argument, so tightening the typed overload does not require route churn.
  - The runtime implementation still needed fail-closed behavior for JS/`any`
    bypasses.
- Commonized processing:
  - The typed string overload now accepts only an omitted or `undefined` second
    argument.
  - Runtime string-overload bypasses now reuse `buildSafeErrorMeta()` and send
    only safe `error_name` / type metadata instead of raw message, stack, or
    `String(error)`.
  - Production string-overload logging now uses `Sentry.captureMessage()` with
    sanitized extras rather than `captureException(error)`.
  - Added a regression test that deliberately bypasses the type signature and
    proves console/Sentry payloads omit patient name, phone, medication, raw
    error message, stack, and raw value sentinels.
- Safety:
  - Existing typed route calls shaped `logger.error('event', undefined, ctx)`
    continue to compile.
  - Existing object-overload structured logging is unchanged except for the
    prior custom-error-name allowlist tightening.
  - The AST inventory after the change still reports `0` string/template
    overload calls with a non-`undefined` second argument.
  - The attempted privacy subagent review did not return before timeout and
    was not used as a completion gate; this slice is backed by local AST
    inventory, focused tests, typecheck, lint, format, and production build.
- Performance:
  - Logging metadata construction only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad runtime scan, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`: passed, `1` file / `10` tests.
  - TypeScript AST inventory command: `125` `logger.error` calls, `0`
    string/template overload calls with a non-`undefined` second argument.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/overdue/route.test.ts src/app/api/dashboard/dispensing-stats/route.test.ts src/app/api/dashboard/clerk-support/route.test.ts src/app/api/dashboard/monthly-stats/route.test.ts --reporter=dot --testTimeout=60000`: passed, `5` files / `34` tests.
  - `pnpm exec prettier --check src/lib/utils/logger.ts src/lib/utils/logger.test.ts src/app/api/dashboard/monthly-stats/route.ts src/app/api/dashboard/monthly-stats/route.test.ts`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - The legacy string overload still accepts generic `ctx` metadata at runtime;
    PHI-bearing code should keep using the safe object overload for raw errors
    and avoid passing request bodies, patient fields, or free-text context via
    the string overload.
  - Browser/E2E smoke was not run because this slice changes shared server
    logging behavior and tests only, with no visible DOM layout, copy, or
    interaction state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, tenant selection,
    route response contracts, external sends, production config, secrets,
    deployment, and dependency versions.
- Next improvements:
  - Continue small route-local logger convergence candidates or add an
    explicit static usage gate if future PHI-bearing code starts adding typed
    string-overload context that belongs in the safe object overload.

## Slice: Dashboard Monthly Stats Structured Logger Convergence

- Timestamp: 2026-07-01 16:19 JST
- Purpose:
  - Route `/api/dashboard/monthly-stats` unexpected-error logs through the
    shared PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication and tighten shared
    structured error-name normalization so custom domain error class names do
    not reach console/Sentry payloads.
  - Preserve monthly-stats auth, no-store behavior, JST month parsing, Prisma
    query shape, patient-stat response shape, and fixed internal-error behavior.
- Changed files:
  - `src/app/api/dashboard/monthly-stats/route.ts`
  - `src/app/api/dashboard/monthly-stats/route.test.ts`
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Change reason:
  - The monthly-stats route returns patient names, patient IDs, visit counts,
    and insurance-basis-derived status, but still used the string logger
    overload with duplicated route-local `SAFE_ERROR_NAMES` / `safeErrorName()`.
  - Privacy review identified that the shared structured logger previously
    allowed real custom `*Error` class names; those can encode domain concepts
    and should be collapsed in PHI-safe structured logs.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()`.
  - Removed the permissive shared custom error-name pattern for PHI-safe
    structured logs.
- Commonized processing:
  - The monthly-stats catch block now calls
    `logger.error({ event, route, method, status }, err)`.
  - The shared structured logger now allows only built-in JavaScript error
    names (`Error`, `TypeError`, `RangeError`, `ReferenceError`,
    `SyntaxError`, `EvalError`, `URIError`) and normalizes custom domain error
    class names to `Error`.
  - Route tests assert the route supplies only minimal operational context and
    delegates raw `Error` redaction to the shared logger contract.
  - Shared logger tests now include a custom
    `PatientInsuranceEligibilityError` regression proving custom class names and
    patient sentinels do not reach console/Sentry payloads.
- Safety:
  - Preserved `canViewDashboard` auth, `runWithRequestAuthContext`, no-store
    success/error wrapping, duplicate/blank/padded/out-of-range month
    validation, JST omitted-month default, `visitRecord.groupBy`,
    `patient.findMany`, selected fields, bucket status/limits, response DTO,
    and fixed `INTERNAL_ERROR` response.
  - The monthly-stats sanitized 500 test proves the HTTP body and
    route-supplied logger context exclude patient/insurance/SQL/stack
    sentinels and route-local `error_name`.
  - Privacy re-review confirmed the prior custom-error-name finding is
    resolved and found no remaining Medium/High issue in the diff.
  - Medical safety review found no actionable patient-safety or operational
    behavior regression.
- Performance:
  - Logging call-shape, duplicated helper removal, and fixed-size logger
    allowlist tightening only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - Baseline `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/monthly-stats/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `18` tests.
  - Final `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/monthly-stats/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `19` tests.
  - `pnpm exec vitest run src/app/api/__tests__/protected-get-routes.test.ts -t "dashboard/monthly-stats GET" --reporter=dot --testTimeout=60000`: passed, `3` tests / `372` skipped.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/overdue/route.test.ts src/app/api/dashboard/dispensing-stats/route.test.ts src/app/api/dashboard/clerk-support/route.test.ts src/app/api/dashboard/monthly-stats/route.test.ts --reporter=dot --testTimeout=60000`: passed, `5` files / `33` tests.
  - Scoped Prettier check for changed files: passed.
  - Scoped ESLint for changed files: passed.
  - Scoped diff whitespace check for changed files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - The shared logger string-overload raw-error follow-up was addressed by the
    later Shared Logger String Overload Error Redaction Hardening slice. The
    remaining caution is generic string-overload `ctx` metadata, which is not
    the safe structured object overload and should not carry PHI/free text.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or interaction
    state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, tenant selection,
    monthly-stats query semantics, patient-stat response contract, billing or
    insurance interpretation, external sends, production config, secrets,
    deployment, and dependency versions.
- Next improvements:
  - Continue small logger convergence candidates.
  - Separately assess whether PHI-bearing code should ban
    `logger.error(string, Error, ctx)` via lint/grep gate or migrate raw
    exception capture to an explicitly named unsafe logger API.
- PR split:
  - Commit this route/shared-logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Incident Reports Structured Logger Convergence

- Timestamp: 2026-07-01 15:20 JST
- Purpose:
  - Route incident-report GET/POST unexpected-error logs through the shared
    PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization and emitted payload redaction.
  - Preserve response status/body, no-store behavior, auth, status/body
    validation, organization-scoped service calls, create/list payload
    propagation, and fixed internal-error behavior.
- Changed files:
  - `src/app/api/incident-reports/route.ts`
  - `src/app/api/incident-reports/route.test.ts`
  - `src/lib/utils/logger.test.ts`
- Change reason:
  - The incident-reports route accepts and returns patient-safety narrative
    fields but still used the string logger overload with duplicated route-local
    `SAFE_ERROR_NAMES` and `safeErrorName()` despite existing shared logger
    runtime allowlisting and raw `Error` redaction.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - POST unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
  - Shared logger tests now include an incident-specific emitted-payload
    regression proving the final console/Sentry payload omits narrative
    sentinels, stack, raw message, and crafted unsafe error names.
  - Controlled validation failures now assert the unexpected-error logger is not
    called.
- Safety:
  - API response body/status, no-store wrapping, `canViewDashboard` auth gate,
    Japanese denial messages, status filter validation, POST body validation,
    `runWithRequestAuthContext`, `listIncidentReports(ctx, status?.data)`,
    `createIncidentReport(ctx, parsed.data)`, and fixed internal-error behavior
    were unchanged.
  - The sanitized GET/POST 500 route tests prove route-supplied logger context
    excludes raw incident narrative sentinels, unsafe error names, and
    route-local `error_name`.
  - The shared logger incident-event test proves emitted console/Sentry payloads
    omit patient-name, medication, narrative, stack, raw-message, and crafted
    error-name sentinels.
  - Privacy review found no Medium/High finding; its low test-boundary concern
    was addressed by adding the incident-event shared logger emitted-payload
    test.
  - Medical safety review found no actionable patient-safety, privacy, or
    behavior-regression issue because auth, validation, service calls, response
    shape, no-store wrapping, and sanitized 500 bodies were preserved.
- Performance:
  - Removes a small duplicated helper and changes logging call shape/tests only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec prettier --check src/app/api/incident-reports/route.ts src/app/api/incident-reports/route.test.ts src/lib/utils/logger.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/incident-reports/route.ts src/app/api/incident-reports/route.test.ts src/lib/utils/logger.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/incident-reports/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `14` tests.
  - `git diff --check -- src/app/api/incident-reports/route.ts src/app/api/incident-reports/route.test.ts src/lib/utils/logger.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; final emitted redaction is covered by the shared logger tests,
    including the new incident-event regression.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or
    interaction-state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, incident report
    service query/mutation semantics, incident report request/response DTO
    contracts, patient-safety narrative fields, audit semantics, external
    sends, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query/mutation shape, and
    medical-safety behavior remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Dashboard Clerk Support Structured Logger Convergence

- Timestamp: 2026-07-01 15:08 JST
- Purpose:
  - Route dashboard clerk-support unexpected-error logs through the shared
    PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve response status/body, no-store behavior, auth, organization-scoped
    dashboard reads, patient-name task response contract, encoded proposal
    links, and consult-item content.
- Changed files:
  - `src/app/api/dashboard/clerk-support/route.ts`
  - `src/app/api/dashboard/clerk-support/route.test.ts`
- Change reason:
  - The clerk-support dashboard route returns patient-name task data and still
    used the string logger overload with duplicated route-local
    `SAFE_ERROR_NAMES` and `safeErrorName()` despite existing shared logger
    runtime allowlisting and raw `Error` redaction.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
  - Auth-denied paths now assert the unexpected-error logger is not called.
- Safety:
  - API response body/status, no-store wrapping, `canViewDashboard` auth gate,
    `runWithRequestAuthContext`, six KPI count queries, task-list construction,
    patient-name response fields, hostile proposal-id href encoding,
    `consult_items`, and fixed internal-error behavior were unchanged.
  - The sanitized 500 test proves route-supplied logger context excludes raw
    patient/clerk/dashboard/SQL/stack/error sentinels, unsafe error name, and
    route-local `error_name`.
  - Privacy review found no material PHI/PII issue and confirmed route-supplied
    log context excludes patient names, task payloads, Prisma results, request
    body, and org-scoped dashboard data.
  - Medical safety review found no actionable safety issue because auth, org
    scoping, counts, task construction, patient names in response, encoded
    proposal hrefs, consult items, and no-store/internal-error behavior were
    unchanged.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec prettier --check src/app/api/dashboard/clerk-support/route.ts src/app/api/dashboard/clerk-support/route.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/dashboard/clerk-support/route.ts src/app/api/dashboard/clerk-support/route.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/clerk-support/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `11` tests.
  - `git diff --check -- src/app/api/dashboard/clerk-support/route.ts src/app/api/dashboard/clerk-support/route.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; emitted console/Sentry redaction remains the shared logger test's
    responsibility.
  - Browser/E2E smoke was not run because this slice changes server logging
    behavior and tests only, with no visible DOM layout, copy, or
    interaction-state change.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, dashboard
    clerk-support response DTO contracts, patient-name response payloads,
    schedule proposal href semantics, audit semantics, external sends,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query shape, and mutations
    remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Dashboard Overdue Japan Date Boundary Fix

- Timestamp: 2026-07-01 14:58 JST
- Purpose:
  - Fix the overdue dashboard unrecorded-visit cutoff so it uses the Japan
    business date even when the server runtime timezone is UTC.
  - Preserve auth, org scoping, dashboard assignment scope, care-report/task
    count predicates, response shape, no-store behavior, and logger behavior.
- Changed files:
  - `src/app/api/dashboard/overdue/route.ts`
  - `src/app/api/dashboard/overdue/route.test.ts`
- Change reason:
  - Medical safety review found a pre-existing P2 residual: the route computed
    the `scheduled_date < today` cutoff with server-local `localDateKey()`,
    which could under-report unrecorded visits around JST midnight on UTC
    runtimes.
- Commonized processing:
  - The unrecorded-visit cutoff now uses
    `utcDateFromLocalKey(japanDateKey())`.
  - This keeps the `@db.Date` UTC-midnight sentinel convention and avoids using
    DateTime instant-range helpers for date-only columns.
- Safety:
  - `VisitSchedule.scheduled_date` remains compared against a
    `YYYY-MM-DDT00:00:00.000Z` `@db.Date` sentinel.
  - The UTC-runtime regression test sets the server timezone to `UTC`, freezes
    time at `2026-06-30T15:30:00.000Z` (`2026-07-01 00:30 JST`), and asserts
    the visit cutoff is `2026-07-01T00:00:00.000Z`.
  - The same regression test uses distinct bucket counts and asserts the
    `summary` response stays `{ unrecorded_visits, unsent_reports,
overdue_tasks, total }`, with the expected total.
  - The same regression test also preserves care-report org/patient/status
    filters and task org/status/frozen-time overdue predicates.
  - DB steward review found no data-risk regression and confirmed the
    `@db.Date` sentinel semantics, org boundary, assignment scope, and
    request-context propagation remain intact.
  - Medical safety review found the implementation correct for JST-midnight
    overdue classification; its low test assurance gap was addressed before
    final validation by adding summary and non-visit bucket assertions.
- Performance:
  - Changes one date-key helper call and test assertions only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec prettier --check src/app/api/dashboard/overdue/route.ts src/app/api/dashboard/overdue/route.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/dashboard/overdue/route.ts src/app/api/dashboard/overdue/route.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/date-boundary.test.ts src/app/api/dashboard/overdue/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `27` tests.
  - `git diff --check -- src/app/api/dashboard/overdue/route.ts src/app/api/dashboard/overdue/route.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - The route test proves generated Prisma where clauses and response shaping
    through mocks; it does not execute a real Postgres/Prisma integration query.
  - Other server-local `localDateKey()` users may still be correct or incorrect
    depending on their domain semantics. They remain separate, route-specific
    candidates and were not bulk-changed.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment-scope
    semantics, care-report/task predicates except assertions in tests,
    dashboard response DTO contracts, audit semantics, external sends,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue with small, validated backend/API safety or logger convergence
    slices; avoid broad date-helper rewrites without domain-specific tests.
- PR split:
  - Commit this date-boundary route/test slice independently.
  - Commit report/progress updates separately.

## Slice: Dashboard Overdue Structured Logger Convergence

- Timestamp: 2026-07-01 14:45 JST
- Purpose:
  - Route dashboard overdue unexpected-error logs through the shared
    PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve response status/body, no-store behavior, auth, organization-scoped
    assignment scope, overdue count predicates, and summary response fields.
- Changed files:
  - `src/app/api/dashboard/overdue/route.ts`
  - `src/app/api/dashboard/overdue/route.test.ts`
- Change reason:
  - The overdue dashboard route still used the string logger overload with
    duplicated route-local `SAFE_ERROR_NAMES` and `safeErrorName()` despite
    existing shared logger runtime allowlisting and raw `Error` redaction.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
  - Auth-denied paths now assert the unexpected-error logger is not called.
- Safety:
  - API response body/status, no-store wrapping, `canViewDashboard` auth gate,
    `runWithRequestAuthContext`, `resolveDashboardAssignmentScope`,
    case/patient assignment scopes, task assignment scope, `Promise.all` count
    ordering, visit/care-report/task count predicates, and summary response
    fields were unchanged.
  - The sanitized 500 test proves route-supplied logger context excludes raw
    overdue/patient/dashboard/SQL/stack/error sentinels, unsafe error name, and
    route-local `error_name`.
  - Privacy review found no blocking issue and confirmed the route-supplied log
    context stays limited to `event`, `route`, `method`, and `status`.
  - Medical safety review found no diff-introduced safety issue because auth,
    org scoping, assignment scope, count predicates, response shaping, and
    no-store/error behavior were unchanged.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec prettier --check src/app/api/dashboard/overdue/route.ts src/app/api/dashboard/overdue/route.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/dashboard/overdue/route.ts src/app/api/dashboard/overdue/route.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/overdue/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `12` tests.
  - `git diff --check -- src/app/api/dashboard/overdue/route.ts src/app/api/dashboard/overdue/route.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; emitted console/Sentry redaction remains the shared logger test's
    responsibility.
  - Medical safety review found a pre-existing P2 residual: overdue visit date
    boundary still depends on server-local `localDateKey()` rather than an
    explicit Japan business-day key. This slice deliberately did not change
    date semantics and records that as a separate safety candidate.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, dashboard overdue
    summary response DTO contracts, assignment-scope semantics, date-boundary
    semantics, audit semantics, external sends, production config, secrets,
    deployment, and dependency versions.
- Next improvements:
  - Treat the overdue dashboard Japan date-boundary residual as the next
    independent safety slice or runtime-contract proposal.
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query shape, and mutations
    remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Dashboard Dispensing Stats Structured Logger Convergence

- Timestamp: 2026-07-01 14:34 JST
- Purpose:
  - Route dashboard dispensing stats unexpected-error logs through the shared
    PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve response status/body, no-store behavior, auth, organization-scoped
    count queries, JST day range handling, and metric response fields.
- Changed files:
  - `src/app/api/dashboard/dispensing-stats/route.ts`
  - `src/app/api/dashboard/dispensing-stats/route.test.ts`
- Change reason:
  - The dispensing-stats route still used the string logger overload with
    duplicated route-local `SAFE_ERROR_NAMES` and `safeErrorName()` despite
    existing shared logger runtime allowlisting and raw `Error` redaction.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
  - Auth-denied paths now assert the unexpected-error logger is not called.
- Safety:
  - API response body/status, no-store wrapping, `canViewDashboard` auth gate,
    `Promise.all` count ordering, Prisma `where` predicates, medication-cycle
    count predicate, `japanDayInstantRange()` completed-today range, and metric
    response fields were unchanged.
  - The sanitized 500 test proves route-supplied logger context excludes raw
    dispensing/dashboard/SQL/stack/error sentinels, unsafe error name, and
    route-local `error_name`.
  - Privacy review found no blocking issue and confirmed the route-supplied log
    context stays limited to `event`, `route`, `method`, and `status`.
  - Medical safety review found no actionable safety finding because query
    shape, response shaping, and no-store/error behavior were unchanged.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec prettier --check src/app/api/dashboard/dispensing-stats/route.ts src/app/api/dashboard/dispensing-stats/route.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/dashboard/dispensing-stats/route.ts src/app/api/dashboard/dispensing-stats/route.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dashboard/dispensing-stats/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `11` tests.
  - `git diff --check -- src/app/api/dashboard/dispensing-stats/route.ts src/app/api/dashboard/dispensing-stats/route.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; emitted console/Sentry redaction remains the shared logger test's
    responsibility.
  - External observability backend retention/redaction policy remains outside
    this code-diff scope.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, dispensing metric
    response DTO contracts, date-range semantics, audit semantics, external
    sends, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query shape, and mutations
    remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Drug Master Import Status Structured Logger Convergence

- Timestamp: 2026-07-01 14:21 JST
- Purpose:
  - Route drug master import status unexpected-error logs through the shared
    PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve import-status response, no-store, auth, freshness calculations,
    query shape, selected fields, totals, and last-failure response shaping.
- Changed files:
  - `src/app/api/drug-master-imports/status/route.ts`
  - `src/app/api/drug-master-imports/status/route.test.ts`
- Change reason:
  - The import-status route still used the string logger overload with
    duplicated route-local `SAFE_ERROR_NAMES` and `safeErrorName()` despite
    existing shared logger runtime allowlisting and raw `Error` redaction.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
  - Auth-denied paths now assert the unexpected-error logger is not called.
- Safety:
  - API response bodies/statuses, no-store wrapping, `canAdmin` auth gate,
    `Promise.all` query ordering, Prisma `where` / `orderBy` / `distinct` /
    `take` / `select` shapes, freshness thresholds, failure streak math, totals
    coverage math, `checked_at`, and last-failure response shaping were
    unchanged.
  - The sanitized 500 test includes sentinels for token-bearing `source_url` and
    raw `error_log` text and proves route-supplied logger context omits those
    fields, raw error text, unsafe error name, and route-local `error_name`.
  - Privacy review found no blocking issue and confirmed the route-supplied log
    context stays limited to `event`, `route`, `method`, and `status`.
  - Medical safety review found no actionable safety finding because query
    shape, freshness/totals calculations, last-failure response shaping, and
    no-store/error behavior were unchanged.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec prettier --check src/app/api/drug-master-imports/status/route.ts src/app/api/drug-master-imports/status/route.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/drug-master-imports/status/route.ts src/app/api/drug-master-imports/status/route.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/drug-master-imports/status/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `20` tests.
  - `git diff --check -- src/app/api/drug-master-imports/status/route.ts src/app/api/drug-master-imports/status/route.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; emitted console/Sentry redaction remains the shared logger test's
    responsibility.
  - Browser-visible `last_failure.error` and persisted `error_log` /
    `source_url` minimization remain separate follow-up or proposal candidates.
    This slice deliberately preserves the current response DTO contract and
    import writer/storage behavior.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, import writer
    behavior, import-status response DTO contracts, master-data import business
    rules, audit semantics, external sends, production config, secrets,
    deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query shape, and mutations
    remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Drug Master Import Log Structured Logger Convergence

- Timestamp: 2026-07-01 14:09 JST
- Purpose:
  - Route drug master import log unexpected-error logs through the shared
    PHI/secret-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve import-log response, no-store, auth, validation, query shape,
    selected fields, and ordering behavior.
- Changed files:
  - `src/app/api/drug-master-import-logs/route.ts`
  - `src/app/api/drug-master-import-logs/route.test.ts`
- Change reason:
  - The import-log route returns import source/status details and still used the
    string logger overload with duplicated route-local `SAFE_ERROR_NAMES` and
    `safeErrorName()` after the shared logger gained a safe structured overload.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
  - Controlled validation failures for malformed `limit`, invalid `source`, and
    invalid `status` now assert the unexpected-error logger is not called.
- Safety:
  - API response bodies/statuses, no-store wrapping, `canAdmin` auth gate,
    query validation, Prisma `where` construction, `select`, `orderBy`, and
    `take` behavior were unchanged.
  - The sanitized 500 test includes sentinels for token-bearing `source_url` and
    raw `error_log` text and proves route-supplied logger context omits those
    fields, raw error text, and route-local `error_name`.
  - Privacy review found no blocking issue and recommended keeping route tests
    focused on safe structured context while relying on shared logger tests for
    emitted raw `Error` redaction.
  - Medical safety review found no actionable safety finding because query
    shape, response shaping, and no-store/error behavior were unchanged.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec prettier --check src/app/api/drug-master-import-logs/route.ts src/app/api/drug-master-import-logs/route.test.ts`: passed after retrying a mistyped local `pnm` command as `pnpm`.
  - `pnpm exec eslint --max-warnings=0 src/app/api/drug-master-import-logs/route.ts src/app/api/drug-master-import-logs/route.test.ts`: passed.
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/drug-master-import-logs/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `20` tests.
  - `git diff --check -- src/app/api/drug-master-import-logs/route.ts src/app/api/drug-master-import-logs/route.test.ts`: passed.
  - `pnpm typecheck`: passed.
  - `pnpm typecheck:no-unused`: passed.
  - `pnpm lint`: passed.
  - `pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; emitted console/Sentry redaction remains the shared logger test's
    responsibility.
  - Persisted `source_url` / `error_log` minimization at import writer/storage
    boundaries remains a separate follow-up or proposal. This slice deliberately
    preserves the current response DTO contract.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, import writer
    behavior, import-log response DTO contracts, master-data import business
    rules, audit semantics, external sends, production config, secrets,
    deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query shape, and mutations
    remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Dispense Queue Structured Logger Convergence

- Timestamp: 2026-07-01 13:55 JST
- Purpose:
  - Route dispense queue unexpected-error logs through the shared PHI-safe
    structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve dispense queue response, no-store, auth/RLS, query shape, sorting,
    and annotation behavior.
- Changed files:
  - `src/app/api/dispense-queue/route.ts`
  - `src/app/api/dispense-queue/route.test.ts`
- Change reason:
  - The dispense queue route handles patient, medication, inquiry, and dispense
    task data but still used the string logger overload with duplicated
    route-local `SAFE_ERROR_NAMES` and `safeErrorName()`.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET unexpected-error path now calls
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
- Safety:
  - API response bodies/statuses, no-store wrapping, `canDispense` auth gate,
    request auth context, RLS request-context options, org/status/cycle
    filtering, selected patient/medication/inquiry fields, sorting, and
    annotation behavior were unchanged.
  - Privacy review found no blocking issue and recommended keeping route tests
    focused on safe structured context while relying on shared logger tests for
    emitted raw `Error` redaction.
  - Medical safety review found no actionable safety finding because query
    shape, response shaping, and no-store/error behavior were unchanged.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, sorting change, or unbounded
    loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/dispense-queue/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `9` tests.
  - `pnpm exec prettier --check src/app/api/dispense-queue/route.ts src/app/api/dispense-queue/route.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/dispense-queue/route.ts src/app/api/dispense-queue/route.test.ts`: passed.
  - `git diff --check -- src/app/api/dispense-queue/route.ts src/app/api/dispense-queue/route.test.ts`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore prove route delegation/context
    only; emitted console/Sentry redaction remains the shared logger test's
    responsibility.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, dispense queue
    response DTO contracts, medication/dispense task business rules, audit
    semantics, external sends, production config, secrets, deployment, and
    dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses, no-store headers, query shape, and mutations
    remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Notifications Structured Logger Convergence

- Timestamp: 2026-07-01 13:47 JST
- Purpose:
  - Route notification GET/PATCH unexpected-error logs through the shared
    PHI-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Preserve notification response, no-store, auth, RLS request-context, and DB
    update behavior.
- Changed files:
  - `src/app/api/notifications/route.ts`
  - `src/app/api/notifications/route.test.ts`
- Change reason:
  - The notification route still used the string logger overload with local
    `SAFE_ERROR_NAMES` and `safeErrorName()` despite existing shared logger
    runtime allowlisting and raw `Error` redaction.
- Deleted code:
  - Removed the route-local `SAFE_ERROR_NAMES` set and `safeErrorName()` helper.
- Commonized processing:
  - GET and PATCH unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only minimal operational context is supplied by the route
    while the raw `Error` is delegated to the shared logger contract tests.
- Safety:
  - API response bodies/statuses, no-store wrapping, auth gates, admin
    cross-user read guard, PATCH validation, notification read filters, RLS
    request-context options, and `updateMany` predicates were unchanged.
  - Privacy review's route-test concern was handled by switching assertions to
    the structured overload and checking that route-supplied context omits body,
    ids, notification, user, and raw error fields.
  - The event-name normalization concern was cross-checked against the existing
    shared logger underscore-event contract; the focused logger suite passed.
- Performance:
  - Removes a small duplicated helper and changes logging call shape only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/notifications/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `17` tests.
  - `pnpm exec prettier --check src/app/api/notifications/route.ts src/app/api/notifications/route.test.ts`: passed after formatting the route file.
  - `pnpm exec eslint --max-warnings=0 src/app/api/notifications/route.ts src/app/api/notifications/route.test.ts`: passed.
  - `git diff --check -- src/app/api/notifications/route.ts src/app/api/notifications/route.test.ts`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Route tests mock the logger and therefore intentionally prove route
    delegation/context only; emitted console/Sentry redaction remains the shared
    logger test's responsibility.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, notification
    response DTO contracts, notification read/update business rules, audit
    semantics, external sends, production config, secrets, deployment, and
    dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove responses and mutations remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Pharmacist Shift Bulk Protected POST Matrix

- Timestamp: 2026-07-01 13:39 JST
- Purpose:
  - Close the protected POST matrix residual for
    `/api/pharmacist-shifts/bulk`.
  - Keep bulk shift auth/no-store regression coverage aligned with route-local
    tests without changing production behavior.
- Changed files:
  - `src/app/api/__tests__/protected-post-routes.test.ts`
- Change reason:
  - The bulk route already had route-local auth/no-store coverage but was absent
    from the shared protected POST matrix.
  - This left the sensitive bulk scheduling endpoint outside the cross-route
    401/403/400 no-store gate.
- Deleted code: None.
- Commonized processing:
  - Imported the bulk POST handler into the shared protected route matrix.
  - Added matrix coverage for unauthenticated, insufficient-permission, and
    invalid-body paths.
  - Let the default invalid body `{}` exercise the bulk schema validation branch
    instead of duplicating the route-local non-object payload test.
- Safety:
  - Production code, route response bodies, auth semantics, validation order,
    RLS context, DB writes, and logger behavior were unchanged.
  - Test architect found no blocker and recommended avoiding success fixtures
    for this matrix.
- Performance:
  - Test-only; no runtime performance impact.
- Validation:
  - `pnpm exec vitest run src/app/api/__tests__/protected-post-routes.test.ts src/app/api/pharmacist-shifts/bulk/route.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `152` tests, with existing `webhook.org_dispatch_failed` stderr from the billing close matrix success case.
  - `pnpm exec prettier --check src/app/api/__tests__/protected-post-routes.test.ts`: passed.
  - `pnpm exec eslint --max-warnings=0 src/app/api/__tests__/protected-post-routes.test.ts`: passed.
  - `git diff --check -- src/app/api/__tests__/protected-post-routes.test.ts`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - Existing `billing-candidates/close` success matrix case still emits mocked
    `webhook.org_dispatch_failed` stderr while passing; unrelated to this
    route.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz production code, route
    handlers, response DTO contracts, scheduling business logic, external
    sends, production config, secrets, deployment, and dependencies.
- Next improvements:
  - Continue with small, tested route-local logger convergence or route-matrix
    candidates.
- PR split:
  - Commit this test-only matrix slice independently.
  - Commit report/progress updates separately.

## Slice: Pharmacist Shift Structured Logger Convergence

- Timestamp: 2026-07-01 13:27 JST
- Purpose:
  - Route pharmacist shift unexpected-error logs through the shared PHI-safe
    structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger owns
    safe error-name normalization.
  - Add missing collection POST upsert-failure coverage for shift notes and
    staff scheduling identifiers.
- Changed files:
  - `src/app/api/pharmacist-shifts/route.ts`
  - `src/app/api/pharmacist-shifts/route.test.ts`
  - `src/app/api/pharmacist-shifts/available/route.ts`
  - `src/app/api/pharmacist-shifts/available/route.test.ts`
  - `src/app/api/pharmacist-shifts/bulk/route.ts`
  - `src/app/api/pharmacist-shifts/bulk/route.test.ts`
- Change reason:
  - Shift collection, availability, and bulk routes still used the string
    logger overload with duplicated route-local `safeErrorName()` helpers.
  - The shared logger already owns runtime allowlisted context and raw `Error`
    redaction for the object overload.
- Deleted code:
  - Removed three route-local `SAFE_ERROR_NAMES` sets and `safeErrorName()`
    helpers.
- Commonized processing:
  - Collection GET/POST, availability GET, and bulk POST unexpected-error paths
    now call `logger.error({ event, route, method, status }, err)`.
  - Existing GET/available/bulk tests now assert only safe operational context
    is supplied by the route and avoid serializing full logger mock calls.
  - Added collection POST upsert failure coverage proving no-store fixed 500,
    reference validation, preserved RLS request context, and no raw note/error
    fields in route logger context.
- Safety:
  - API response bodies/statuses, no-store wrapping, auth gates, validation
    order, date/time normalization, query shapes, `limit + 1` pagination,
    `validateOrgReferences`, RLS request-context options, and bulk transaction
    timeouts were unchanged.
  - Privacy review's blocker was closed by the new POST upsert failure test.
  - Route logger context remains limited to `event`, `route`, `method`, and
    `status`; raw `Error` handling stays delegated to the shared logger
    contract tests.
- Performance:
  - Removes small duplicated error-name helpers and changes logging call shape
    only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/pharmacist-shifts/route.test.ts src/app/api/pharmacist-shifts/available/route.test.ts src/app/api/pharmacist-shifts/bulk/route.test.ts --reporter=dot --testTimeout=60000`: passed, `4` files / `45` tests.
  - Scoped Prettier check for changed route/test files: passed after formatting
    the three route files.
  - Scoped ESLint for changed route/test files: passed.
  - Scoped diff whitespace check for changed route/test files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`: passed.
- Known risks:
  - `/api/pharmacist-shifts/bulk` protected POST route-matrix coverage was
    closed by the test-only matrix slice recorded above.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, route response DTO
    contracts, shift scheduling business rules, audit semantics, external
    sends, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where tests can
    prove no response/no-store/RLS/DB behavior changed.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Pharmacists Structured Logger Convergence

- Timestamp: 2026-07-01 13:13 JST
- Purpose:
  - Route pharmacist/staff unexpected-error logs through the shared PHI-safe
    structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that shared logger
    owns safe error-name normalization.
  - Add missing POST duplicate-lookup unexpected-failure coverage before any
    Cognito invite or DB write can happen.
- Changed files:
  - `src/app/api/pharmacists/route.ts`
  - `src/app/api/pharmacists/route.test.ts`
  - `src/app/api/pharmacists/[id]/route.ts`
  - `src/app/api/pharmacists/[id]/route.test.ts`
- Change reason:
  - Pharmacist routes handle staff PII and Cognito-facing identity fields, but
    still used the string logger overload with duplicated route-local
    `safeErrorName()` helpers.
  - The shared logger now provides runtime safe context allowlisting and raw
    `Error` redaction for the object overload.
- Deleted code:
  - Removed two route-local `SAFE_ERROR_NAMES` sets and `safeErrorName()`
    helpers.
- Commonized processing:
  - GET, POST, and PATCH unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only route-safe context is supplied and avoid
    serializing full mock calls that intentionally include a raw `Error` as the
    second argument.
  - Added POST duplicate-email lookup failure coverage proving no Cognito invite,
    DB write, or audit mutation happens after the lookup fails.
- Safety:
  - API response bodies/statuses, no-store wrapping, auth gates, validation,
    run-with-request-auth-context, RLS request-context options, Cognito expected
    validation paths, DB writes, and audit semantics were unchanged.
  - Privacy review found no blocker and confirmed the diff lowers raw
    message/stack leakage risk for staff PII/Cognito-adjacent errors.
- Performance:
  - Removes small duplicated error-name helpers and changes logging call shape
    only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/pharmacists/route.test.ts 'src/app/api/pharmacists/[id]/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `3` files / `42` tests.
  - Scoped Prettier check for changed route/test files: passed.
  - Scoped ESLint for changed route/test files: passed.
  - Scoped diff whitespace check for changed route/test files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Route tests prove call shape and response/side-effect behavior; actual
    console/Sentry redaction remains the shared logger test's responsibility.
  - Do not add staff email/name/phone/Cognito username/request body to route log
    context without a separate privacy review.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, route response DTO
    contracts, staff management business rules, Cognito expected-error
    semantics, audit semantics, external sends, production config, secrets,
    deployment, and dependency versions.
- Next improvements:
  - Continue small, tested route-local logger convergence only where existing
    tests can prove no response/no-store/RLS/Cognito/DB/audit behavior changed.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Visit Vehicle Resource Structured Logger Convergence

- Timestamp: 2026-07-01 13:05 JST
- Purpose:
  - Route visit-vehicle-resource unexpected-error logs through the shared
    PHI-safe structured logger overload.
  - Remove route-local `safeErrorName()` duplication now that the shared logger
    owns safe error-name normalization.
  - Preserve existing route response, no-store, auth, RLS request-context, DB,
    and audit behavior.
- Changed files:
  - `src/app/api/visit-vehicle-resources/route.ts`
  - `src/app/api/visit-vehicle-resources/route.test.ts`
  - `src/app/api/visit-vehicle-resources/[id]/route.ts`
  - `src/app/api/visit-vehicle-resources/[id]/route.test.ts`
- Change reason:
  - The collection/detail routes used the string logger overload with local
    `safeErrorName()` and duplicated safe-name allowlists.
  - The previous logger slice made `logger.error({ ... }, err)` enforce runtime
    allowlisted context fields and safe error metadata centrally.
- Deleted code:
  - Removed two route-local `SAFE_ERROR_NAMES` sets and `safeErrorName()`
    helpers.
- Commonized processing:
  - GET, POST, and PATCH unexpected-error paths now call
    `logger.error({ event, route, method, status }, err)`.
  - Route tests assert only safe operational context is supplied by the route;
    raw `Error` handling is delegated to the shared logger contract tests.
- Safety:
  - Existing API response bodies/statuses, no-store wrapping, auth gates,
    validation, RLS request-context options, DB reads/writes, and audit entries
    were unchanged.
  - Privacy review found no blocker and confirmed the change lowers raw
    message/stack leakage risk.
  - Tests preserve sanitized 500 bodies and avoid serializing the logger mock's
    full call array, because the raw `Error` is intentionally passed as the
    second argument for the shared logger to sanitize.
- Performance:
  - Removes small duplicated error-name helpers and changes logging call shape
    only.
  - Adds no DB query, dependency, network call, polling, background job,
    external request, render work, broad scan, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts src/app/api/visit-vehicle-resources/route.test.ts 'src/app/api/visit-vehicle-resources/[id]/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `3` files / `29` tests.
  - Scoped Prettier check for changed route/test files: passed.
  - Scoped ESLint for changed route/test files: passed.
  - Scoped diff whitespace check for changed route/test files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Route tests now intentionally assert the route passes the raw `Error` to
    the shared logger. Do not reintroduce full `loggerErrorMock.mock.calls`
    snapshots for these sentinel errors.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, route response DTO
    contracts, vehicle-resource business rules, audit semantics, external
    sends, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue migrating small, well-tested route-local safe logger patterns to
    the shared structured overload where existing tests can prove responses and
    mutations remain unchanged.
- PR split:
  - Commit this route logger/test slice independently.
  - Commit report/progress updates separately.

## Slice: Safe Structured Logger Runtime Redaction

- Timestamp: 2026-07-01 12:56 JST
- Purpose:
  - Make the safe structured logger overload enforce its allowlist at runtime,
    not only through TypeScript.
  - Prevent raw request-body, PHI/PII-like, secret-like, stack, and raw error
    fields from entering console JSON or Sentry extras through object overloads.
  - Preserve the intended safe operational metadata fields such as event, route,
    method, status, request id, code, org id, and error class category.
- Changed files:
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Change reason:
  - `SafeLogContext` was typed as an allowlist, but `buildSafeLogContext()`
    iterated every runtime key in the object. A caller using `as any`, object
    spread, or JS could pass unknown keys such as `body`, `token`, `password`,
    `patientEmail`, or `insuranceNumber`, and safe-looking ASCII values could
    reach console logs.
  - Safe structured error logging deliberately omits `Error.message` and stack,
    but `Error.name` was also a raw property and could be overwritten with
    secret-like text.
- Deleted code:
  - None.
- Commonized processing:
  - Added a runtime `SAFE_LOG_CONTEXT_KEYS` allowlist and made
    `buildSafeLogContext()` copy only known safe fields.
  - Added `normalizeSafeEvent()` and made non-string events fail closed to
    `invalid_event_name`.
  - Made unsupported runtime value types redact to `redacted` instead of
    throwing.
  - Added `normalizeErrorName()` so safe object overloads keep only real Error
    constructor names that match the Error instance and fall back to `Error` for
    tampered names.
- Safety:
  - Existing string-overload behavior is unchanged.
  - Existing typed safe-object callers use allowlisted keys, so their intended
    operational metadata remains available.
  - New tests cover unknown runtime keys, ASCII PII/secret-like values,
    object-valued safe fields, raw `Error.message`, raw stack, unsafe
    `Error.name`, and Sentry `captureMessage` behavior.
  - No API response contract, DB/RLS policy, auth/authz behavior, audit
    semantics, external send, production config, secret, dependency, or route
    behavior was changed.
- Performance:
  - Replaces object-entry copying with a fixed small allowlist loop.
  - Adds no DB query, network call, dependency, polling, background job, broad
    scan, render work, or unbounded loop.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts --reporter=dot --testTimeout=30000`: passed, `1` file / `7` tests.
  - Scoped Prettier check for changed logger files: passed.
  - Scoped ESLint for changed logger files: passed.
  - Scoped diff whitespace check for changed logger files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Safe object overloads now intentionally drop unknown runtime keys. This is a
    security hardening change for logs; callers that require new operational
    metadata must add it to the explicit safe allowlist with tests.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, route response DTO
    contracts, medical workflow behavior, audit semantics, external sends,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue behavior-preserving API response-boundary or helper convergence.
  - Treat adding new safe logger metadata keys as separate, reviewed
    observability changes.
- PR split:
  - Commit this logger implementation/test slice independently.
  - Commit report/progress updates separately.

## Slice: Document Delivery Rule RLS Request Context

- Timestamp: 2026-07-01 12:48 JST
- Purpose:
  - Bind document-delivery-rule DB work to the authenticated request context.
  - Add the document-delivery-rule route family to protected route matrices.
  - Preserve existing response status, body, no-store, validation, and mutation
    semantics.
- Changed files:
  - `src/app/api/document-delivery-rules/route.ts`
  - `src/app/api/document-delivery-rules/[id]/route.ts`
  - `src/app/api/document-delivery-rules/route.test.ts`
  - `src/app/api/document-delivery-rules/[id]/route.test.ts`
  - `src/app/api/__tests__/protected-get-routes.test.ts`
  - `src/app/api/__tests__/protected-post-routes.test.ts`
  - `src/app/api/__tests__/protected-patch-delete-routes.test.ts`
- Change reason:
  - The routes used `withOrgContext(ctx.orgId, ...)` without passing
    `{ requestContext: ctx }`.
  - Tenant isolation remained protected by explicit `org_id` filters and RLS,
    but actor/role/site/IP/user-agent session metadata could fall back to
    missing request context.
  - The route family was not covered by the global protected GET/POST/PATCH/
    DELETE auth/no-store matrices.
- Deleted code:
  - None.
- Commonized processing:
  - Passed `{ requestContext: ctx }` to all six `withOrgContext` calls in the
    collection/detail routes.
  - Added route-local assertions that successful GET/POST/PATCH/DELETE DB work
    is bound to the request context.
  - Added collection GET/POST and detail PATCH/DELETE to protected route
    matrices.
- Safety:
  - Preserved `canAdmin`, query/body/id validation, default/clamped list limit,
    count envelope, create/update/delete payloads, app-layer `org_id` filters,
    response bodies, status codes, no-store wrappers, fixed unexpected-error
    fallback, DB schema/RLS policy definitions, migrations, and external sends.
  - Updated the protected GET matrix's `visit-records/[id]/handoff` success
    fixture to satisfy the current handoff contract instead of returning an
    unrelated 409 during matrix validation.
- Performance:
  - Adds only request metadata to existing RLS helper calls and matrix coverage.
  - No new runtime DB query, dependency, polling, background job, external
    request, broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/app/api/document-delivery-rules/route.test.ts 'src/app/api/document-delivery-rules/[id]/route.test.ts' src/app/api/__tests__/protected-get-routes.test.ts src/app/api/__tests__/protected-post-routes.test.ts src/app/api/__tests__/protected-patch-delete-routes.test.ts --reporter=dot --testTimeout=60000`: passed, `5` files / `618` tests. Existing billing close matrix test still emits its known mocked `webhook.org_dispatch_failed` stderr while passing.
  - Scoped Prettier check for changed route/matrix files: passed.
  - Scoped ESLint for changed route/matrix files: passed.
  - Scoped diff whitespace check for changed route/matrix files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Document-delivery-rule response DTO minimization remains a separate
    low-risk privacy follow-up; current raw rule response bodies are preserved.
  - Real logger redaction contract tests remain a separate cross-cutting
    observability follow-up.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, route response DTO
    contracts, delivery-rule business semantics, audit semantics, external
    sends, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue behavior-preserving API response-boundary or helper convergence.
  - Consider a separate explicit proposal for document-delivery-rule DTO
    minimization.
- PR split:
  - Implementation/test commit: `906cf13e`.
  - Commit report/progress updates separately.

## Slice: Task Create No-Store Boundary

- Timestamp: 2026-07-01 12:36 JST
- Purpose:
  - Add explicit sensitive no-store headers to every expected
    `POST /api/tasks` response.
  - Add a fixed sanitized unexpected-error fallback for task creation failures.
  - Lock `/api/tasks POST` into the protected POST auth/body matrix.
- Changed files:
  - `src/app/api/tasks/route.ts`
  - `src/app/api/tasks/route.test.ts`
  - `src/app/api/__tests__/protected-post-routes.test.ts`
- Change reason:
  - `GET /api/tasks` already used the shared `withSensitiveNoStore` wrapper and
    fixed `internalError()` fallback, but `POST` returned auth, validation,
    conflict, success, duplicate, and unexpected-failure responses directly.
  - Task create payloads and responses can carry patient-linked operational
    data such as task title, description, related entity ids, assignees,
    dedupe keys, and metadata.
- Deleted code:
  - None.
- Commonized processing:
  - Split `POST` into `authenticatedPOST()` plus an exported route wrapper that
    applies `withSensitiveNoStore`.
  - Reused the established route pattern:
    `try -> withSensitiveNoStore(await authenticatedPOST(req))` and
    `catch -> unstable_rethrow(err) -> withSensitiveNoStore(internalError())`.
  - Added `/api/tasks POST` to the protected POST matrix.
- Safety:
  - Preserved `canVisit` auth, validation messages, assignment-scope checks,
    patient/case write guards, active-assignee validation, create data shape,
    `withOrgContext(..., { requestContext: ctx })`, dedupe race semantics,
    success status codes, and existing raw task response bodies.
  - Tests cover no-store on create success, duplicate success, auth failure,
    validation errors, archived-patient conflicts, assignment rejection, and
    malformed JSON.
  - Tests cover fixed no-store `INTERNAL_ERROR` responses without raw thrown
    text for create failures and duplicate-lookup failures.
- Performance:
  - Response header mutation and fixed fallback handling only.
  - No new DB query, dependency, polling, background job, external request,
    broad scan, render fan-out, or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/app/api/tasks/route.test.ts src/app/api/__tests__/protected-post-routes.test.ts --reporter=dot --testTimeout=60000`: passed, `2` files / `171` tests. Existing billing close matrix test still emits its known mocked `webhook.org_dispatch_failed` stderr while passing.
  - Scoped Prettier check for changed route/matrix files: passed.
  - Scoped ESLint for changed route/matrix files: passed.
  - Scoped diff whitespace check for changed route/matrix files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Privacy review recommended minimizing task-create success and duplicate
    response bodies instead of returning raw `Task` rows. That would change the
    current API response contract, so it was not silently implemented in this
    behavior-preserving slice; it should be handled as an explicit API proposal
    after confirming frontend and integration consumers only require `data.id`.
  - The route intentionally still has no new route-level raw error logging.
    Adding PHI-safe structured logs can be considered separately with logger
    tests.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policies, auth/authz semantics, assignment logic,
    task payload semantics, dedupe semantics, raw response DTO contract, audit
    semantics, external sends, production config, secrets, deployment, and
    dependency versions.
- Next improvements:
  - Prepare a separate API-contract proposal for minimized `POST /api/tasks`
    response DTOs if callers only require created/existing task ids.
  - Continue safe helper convergence or response-boundary hardening from the
    execution plan.
- PR split:
  - Implementation/test commit: `9bdc3154`.
  - Commit report/progress updates separately.

## Slice: Patient And Report Share API Path Helpers

- Timestamp: 2026-07-01 12:26 JST
- Purpose:
  - Centralize communication-request collection/list/create paths used by the
    report interprofessional share page and patient external share page.
  - Route internal task-create paths through a shared client-safe task API path
    helper.
  - Replace patient-share inline tenant headers with the shared org-header
    helpers.
  - Fail closed without crashing when report-share receives an exact dot-segment
    `patient_id`.
- Changed files:
  - `src/lib/communications/api-paths.ts`
  - `src/lib/communications/api-paths.test.ts`
  - `src/lib/tasks/api-paths.ts`
  - `src/lib/tasks/api-paths.test.ts`
  - `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx`
  - `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx`
  - `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx`
  - `src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx`
- Change reason:
  - Both share pages still built `/api/communication-requests?...`,
    `/api/communication-requests`, and `/api/tasks` inline.
  - Patient share also had repeated inline `x-org-id` and JSON headers on
    PHI-bearing reads and internal creates.
  - Frontend review found the report-share dot-segment patient-id test masked a
    real `buildPatientHref()` render crash.
- Deleted code:
  - None.
- Commonized processing:
  - Added `COMMUNICATION_REQUESTS_API_PATH` and
    `buildCommunicationRequestsApiPath()`.
  - Added `TASKS_API_PATH`, `buildTasksApiPath()`, and `buildTaskApiPath()`.
  - Reused `buildOrgHeaders()` and `buildOrgJsonHeaders()` in patient share.
  - Added report-share safe patient href derivation that treats only
    `RangeError` from path helpers as a controlled fail-closed condition.
- Safety:
  - Communication request query scoping remains explicit:
    `request_type`, `related_entity_type`, and `related_entity_id` are passed
    through typed helper args in the same query order.
  - Payload bodies, query keys, invalidation keys, permissions, response
    parsing, toast fallback behavior, external-access grant generation, public
    share-token URL construction, route auth/RLS behavior, DB schema, external
    sends, and production config were unchanged.
  - Tests now prove hostile IDs remain raw in query/body identities while path
    segments are encoded, task/communication create calls consume helper return
    values, and exact dot-segment patient IDs no longer crash or fetch patient
    support APIs.
- Performance:
  - Local path/header construction only.
  - No new request, polling, dependency, backend query, background job, render
    fan-out, broad scan, or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/lib/communications/api-paths.test.ts src/lib/tasks/api-paths.test.ts src/lib/api/org-headers.test.ts 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.test.tsx' 'src/app/(dashboard)/patients/[id]/share/external-share-content.test.tsx' --reporter=dot --testTimeout=60000`: passed, `5` files / `57` tests.
  - Scoped ESLint for changed files: passed.
  - Scoped Prettier check for changed files: passed after formatting three
    touched files.
  - Scoped diff whitespace check for changed files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Privacy review identified `POST /api/tasks` as a separate PHI-bearing
    backend response-boundary residual: success/error paths are not yet fully
    wrapped with `withSensitiveNoStore` and fixed unexpected-error fallback.
    This client helper slice preserves current task-create behavior and records
    the backend route as the next API hardening candidate.
  - Patient external-share tests still rely heavily on mocked React Query;
    broader QueryClientProvider-backed coverage remains a future test-quality
    improvement.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, mutation payload semantics, external-access grant
    semantics, public token URL behavior, audit semantics, external sends,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Harden `POST /api/tasks` response no-store and unexpected-error fallback as
    a separate route/test slice.
  - Consider patient-share QueryClientProvider-backed integration coverage for
    enabled/loading/error behavior.
- PR split:
  - Commit this helper/test/fail-closed slice independently.
  - Commit report/progress updates separately.

## Slice: Nav Badge API Path And Header Helper

- Timestamp: 2026-07-01 11:33 JST
- Purpose:
  - Centralize the sidebar nav badge API path.
  - Route the nav badge client fetch through the existing canonical org-header
    helper.
  - Lock fail-closed behavior for missing org ids and failed badge fetches.
- Changed files:
  - `src/components/layout/use-nav-badges.ts`
  - `src/components/layout/use-nav-badges.test.ts`
  - `src/lib/nav-badges/api-paths.ts`
  - `src/lib/nav-badges/api-paths.test.ts`
- Change reason:
  - `/api/nav-badges` and `{ 'x-org-id': orgId }` were still direct literals in
    the layout hook even though the repo has shared API path and org-header
    patterns.
  - Badge counts are operational signals, so path/header drift and noisy
    missing-org requests should be prevented by tests.
- Deleted code:
  - None.
- Commonized processing:
  - Added `buildNavBadgesApiPath()`.
  - Reused `buildOrgHeaders(orgId)` for canonical `x-org-id` construction.
- Safety:
  - Query key, refetch interval, retry setting, payload shape, sidebar badge
    keys, route/service logic, auth, tenant/RLS behavior, audit behavior,
    migrations, external sends, and production config were unchanged.
  - Tests now prove no fetch happens while `orgId` is empty, non-OK responses do
    not parse raw response bodies, and rejected badge fetches do not retry.
- Performance:
  - No new request, polling, DB query, dependency, background job, or render
    fan-out was added.
  - Existing 60s refetch cadence and `retry: false` behavior remain unchanged.
- Validation:
  - `pnpm exec vitest run src/components/layout/use-nav-badges.test.ts src/lib/nav-badges/api-paths.test.ts src/lib/api/org-headers.test.ts src/components/layout/sidebar.test.tsx src/app/api/nav-badges/route.test.ts src/server/services/nav-badges.test.ts --reporter=dot --testTimeout=60000`: passed, `6` files / `41` tests.
  - Scoped ESLint for changed files: passed after naming the test wrapper.
  - Scoped Prettier check for changed files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed after the
    test `Response` mock was cast explicitly.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - `/api/nav-badges` currently has no explicit no-store header assertion in its
    route test. Treat that as a separate API privacy-hardening candidate rather
    than mixing it into this helper-only slice.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz behavior, tenant selection behavior,
    audit semantics, PHI export/share, external sends, billing, medication
    identity, production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Consider a separate route-hardening slice for `/api/nav-badges` no-store
    headers if current route response helpers do not already guarantee them.
  - Continue with the next low-risk helper-convergence candidate from
    `REFACTOR_EXECUTION_PLAN.md`.
- PR split:
  - Commit this helper/test slice independently.
  - Commit report/progress updates separately.

## Slice: Nav Badge Route No-Store Boundary

- Timestamp: 2026-07-01 11:43 JST
- Purpose:
  - Add explicit sensitive no-store headers to `/api/nav-badges` responses.
  - Preserve the existing `{ data: { audit?: number; handoff?: number } }`
    contract while reducing stale cross-user/cross-org badge count inference.
- Changed files:
  - `src/app/api/nav-badges/route.ts`
  - `src/app/api/nav-badges/route.test.ts`
- Change reason:
  - Nav badge counts are minimized numeric metadata, but they still reveal
    user/org-scoped audit and handoff workload.
  - The route previously returned `success({ data })` without the shared
    sensitive no-store wrapper.
- Deleted code:
  - None.
- Commonized processing:
  - Reused `withSensitiveNoStore`.
  - Used the established exported-route wrapper pattern with `unstable_rethrow`
    and fixed `internalError()` fallback for unexpected wrapper failures.
- Safety:
  - Status codes, success body shape, auth context, service payload, count
    semantics, route params, request validation, query behavior, RLS, audit,
    migrations, external sends, production config, and client behavior were
    unchanged.
  - Tests cover success, auth-returned response, auth plumbing throw, and badge
    aggregation throw paths.
- Performance:
  - Header mutation and fallback error handling only.
  - No new query, dependency, polling, background job, external request, or
    broad scan was added.
- Validation:
  - `pnpm exec vitest run src/app/api/nav-badges/route.test.ts src/server/services/nav-badges.test.ts src/components/layout/use-nav-badges.test.ts src/lib/nav-badges/api-paths.test.ts src/lib/api/org-headers.test.ts src/components/layout/sidebar.test.tsx --reporter=dot --testTimeout=60000`: passed, `6` files / `44` tests.
  - Scoped Prettier check for route files: passed.
  - Scoped ESLint for route files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - RLS request-context explicitness in `countHandoffBadge`, audit badge query
    parity with `/api/dispense-audits?badge=1`, and JST date-boundary parity for
    handoff counts remain separate behavior candidates and were not mixed into
    this response-header slice.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior, audit
    semantics, PHI payload fields, external sends, billing, medication identity,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue safe low-risk helper convergence from `REFACTOR_EXECUTION_PLAN.md`.
  - Consider a separate proposal or tested API slice for nav badge service
    parity/date-boundary questions if evidence shows current counts drift.
- PR split:
  - Commit this API hardening slice independently.
  - Commit report/progress updates separately.

## Slice: Report Generation Path Helper

- Timestamp: 2026-07-01 11:53 JST
- Purpose:
  - Centralize the visit-based care report generation API path.
  - Preserve the existing report generation client request, response, and error
    behavior.
  - Lock the constant path so future report-generation callers do not drift.
- Changed files:
  - `src/lib/reports/api-paths.ts`
  - `src/lib/reports/api-paths.test.ts`
  - `src/lib/reports/generate-from-visit-client.ts`
  - `src/lib/reports/generate-from-visit-client.test.ts`
- Change reason:
  - `/api/care-reports/generate-from-visit` was still a raw client literal even
    though report detail and print-audit path helpers already existed.
  - Care report generation is PHI-adjacent, so endpoint drift should be caught
    by helper and client contract tests.
- Deleted code:
  - None.
- Commonized processing:
  - Added `GENERATE_CARE_REPORT_FROM_VISIT_API_PATH`.
  - Added `buildGenerateCareReportFromVisitApiPath()`.
  - Replaced the raw client fetch path with the helper.
- Safety:
  - Method, `buildOrgJsonHeaders(input.orgId)`, request body keys, optional
    regeneration fields, response schema parsing, and API error fallback
    behavior were unchanged.
  - Route auth, no-store wrapping, service behavior, RLS, audit behavior,
    migrations, external sends, and production config were unchanged.
  - Privacy review found no blocker in the path-only extraction and confirmed no
    new query-parameter, log, export, storage, or cache leakage path.
- Performance:
  - Constant-backed path helper only.
  - No new request, route call, backend query, dependency, background job,
    polling, broad scan, or render fan-out was added.
- Validation:
  - `pnpm exec vitest run src/lib/reports/api-paths.test.ts src/lib/reports/generate-from-visit-client.test.ts src/lib/reports/generate-from-visit-contract.test.ts 'src/app/(dashboard)/reports/report-share-workspace.test.tsx' src/app/api/care-reports/generate-from-visit/route.test.ts --reporter=dot --testTimeout=60000`: passed, `5` files / `52` tests.
  - Scoped ESLint for changed files: passed.
  - Scoped Prettier check for changed files: passed after formatting
    `src/lib/reports/api-paths.test.ts`.
  - Scoped diff whitespace check for changed files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Route catalog and rate-limit literals for the same endpoint remain separate
    server-side concerns and were intentionally not folded into this client path
    helper slice.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior, audit
    semantics, PHI payload fields, external sends, billing, medication identity,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Continue safe low-risk helper convergence from `REFACTOR_EXECUTION_PLAN.md`.
  - Treat any server route catalog/rate-limit cleanup as a separately reviewed
    API boundary slice.
- PR split:
  - Commit this helper/test slice independently.
  - Commit report/progress updates separately.

## Slice: Admin Notification Settings Path Helpers

- Timestamp: 2026-07-01 12:03 JST
- Purpose:
  - Centralize admin notification rule and escalation rule API paths.
  - Route admin notification settings fetch/mutation headers through the shared
    org-header helpers.
  - Preserve existing notification/escalation settings behavior and UI layout.
- Changed files:
  - `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
  - `src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx`
  - `src/lib/notification-rules/api-paths.ts`
  - `src/lib/notification-rules/api-paths.test.ts`
  - `src/lib/escalation-rules/api-paths.ts`
  - `src/lib/escalation-rules/api-paths.test.ts`
- Change reason:
  - `/api/notification-rules` and `/api/admin/escalation-rules` were still
    built inline in the admin notification settings UI.
  - Notification and escalation settings are operational routing controls, so
    path and tenant-header drift should be locked behind shared helpers and
    tests.
- Deleted code:
  - None.
- Commonized processing:
  - Added `NOTIFICATION_RULES_API_PATH`, `buildNotificationRulesApiPath()`, and
    `buildNotificationRuleApiPath()`.
  - Added `ESCALATION_RULES_API_PATH`, `buildEscalationRulesApiPath()`, and
    `buildEscalationRuleApiPath()`.
  - Reused `buildOrgHeaders()` for read/delete requests and
    `buildOrgJsonHeaders()` for JSON mutation requests.
- Safety:
  - UI structure, copy, browser notification preference behavior, escalation
    threshold validation, request methods, request bodies, response handling,
    route permissions, RLS behavior, audit behavior, migrations, external sends,
    and production config were unchanged.
  - Helper tests cover collection paths, encoded query strings, hostile detail
    IDs, and exact dot-segment rejection.
  - Component tests mock helper sentinels and prove list reads, notification
    create/update, escalation create/update/delete, and tenant headers delegate
    to shared helpers.
- Performance:
  - Local path/header construction only.
  - No new request, backend query, dependency, polling, background job, broad
    scan, render fan-out, or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx' src/lib/notification-rules/api-paths.test.ts src/lib/escalation-rules/api-paths.test.ts src/lib/api/org-headers.test.ts src/lib/http/path-segment.test.ts --reporter=dot --testTimeout=60000`: passed, `5` files / `36` tests.
  - Scoped ESLint for changed files: passed.
  - Scoped Prettier check for changed files: passed.
  - Scoped diff whitespace check for changed files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Privacy review found an existing `/api/notification-rules` response boundary
    residual: the route does not yet apply `withSensitiveNoStore` or a fixed
    unexpected-error wrapper, unlike the escalation-rule route.
  - Notification-rule mutation audit evidence remains weaker than escalation
    rule audit evidence. Treat this as a separate API hardening candidate, not
    part of this helper-only slice.
- Untouched dangerous areas:
  - DB schema/migrations/RLS, auth/authz logic, tenant selection behavior, audit
    semantics, PHI payload fields, external sends, billing, medication identity,
    production config, secrets, deployment, and dependency versions.
- Next improvements:
  - Handle `/api/notification-rules` no-store/error-boundary hardening as a
    separate route/test slice.
  - Consider a separate minimized audit-evidence slice for notification-rule
    mutations.
- PR split:
  - Commit this helper/test slice independently.
  - Commit report/progress updates separately.

## Slice: Notification Rules No-Store Boundary

- Timestamp: 2026-07-01 12:13 JST
- Purpose:
  - Add explicit sensitive no-store headers to `/api/notification-rules`
    collection and detail responses.
  - Preserve existing notification-rule success/error body shapes, status codes,
    auth permission, RLS behavior, and mutation semantics.
  - Convert unexpected route failures into the fixed sanitized `INTERNAL_ERROR`
    envelope.
- Changed files:
  - `src/app/api/notification-rules/route.ts`
  - `src/app/api/notification-rules/route.test.ts`
  - `src/app/api/notification-rules/[id]/route.ts`
  - `src/app/api/notification-rules/[id]/route.test.ts`
- Change reason:
  - Notification rule settings expose operational routing controls, recipient
    roles/user ids, event types, channels, and counted metadata.
  - The adjacent escalation-rule API already used the sensitive no-store
    boundary; notification-rule responses did not.
- Deleted code:
  - None.
- Commonized processing:
  - Reused `withSensitiveNoStore`.
  - Reused `internalError()` for fixed unexpected-error fallback.
  - Split route logic into inner authenticated handlers and exported wrappers
    so no-store is applied once around every expected response branch.
- Safety:
  - Existing `canAdmin` permission, route IDs, validation messages, list count
    metadata, `POST` 201 raw-rule response, `PATCH` raw-rule response, `DELETE`
    message body, RLS transaction use, and not-found behavior were unchanged.
  - Tests cover no-store on success, validation, malformed JSON, auth rejection,
    not-found, and sanitized unexpected-error paths.
  - API contract review confirmed the direction is compatible and highlighted
    behavior changes to avoid.
- Performance:
  - Header mutation and fallback error handling only.
  - No new DB query, dependency, polling, background job, external request, broad
    scan, or unbounded loop was added.
- Validation:
  - `pnpm exec vitest run src/app/api/notification-rules/route.test.ts 'src/app/api/notification-rules/[id]/route.test.ts' src/app/api/admin/escalation-rules/route.test.ts 'src/app/api/admin/escalation-rules/[id]/route.test.ts' --reporter=dot --testTimeout=60000`: passed, `4` files / `46` tests.
  - Scoped ESLint for changed files: passed.
  - Scoped Prettier check for changed files: passed.
  - Scoped diff whitespace check for changed files: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
  - `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: passed.
  - `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`: passed.
  - `git diff --check`: passed.
- Known risks:
  - Notification-rule mutation audit evidence remains weaker than escalation-rule
    audit evidence. Treat minimized notification-rule audit logging as a
    separate route/audit slice.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, mutation payload semantics, external sends, billing,
    medication identity, production config, secrets, deployment, and dependency
    versions.
- Next improvements:
  - Consider minimized notification-rule mutation audit entries that store action,
    target id, event type, channel, enabled flag, and recipient counts without
    raw recipient arrays unless explicitly required.
- PR split:
  - Commit this API hardening slice independently.
  - Commit report/progress updates separately.

## Slice: Secrets Manager Fallback Safe Log

- Timestamp: 2026-07-02 06:06 JST
- Purpose:
  - Prevent Secrets Manager/AWS/provider fallback failures from copying raw
    diagnostics, configured secret ids, token-like text, or PHI-like values into
    runtime warning logs.
  - Preserve fallback-to-env behavior and startup no-throw guardrails.
- Changed files:
  - `src/lib/config/secrets.ts`
  - `src/lib/config/secrets.test.ts`
- Change reason:
  - `getSecrets()` logged `Error.message` / `String(error)` and interpolated
    the configured secret name in the fallback warning.
  - `bootstrapSecretsIntoEnv()` had the same raw diagnostic logging pattern in
    its unexpected catch path.
- Deleted code:
  - Removed raw warning argument construction from those catch paths.
- Commonized processing:
  - Added local safe warning helpers for Secrets Manager fallback and bootstrap
    failures.
  - Both helpers emit fixed event/operation metadata and a generic safe
    `error_name` only.
- Safety:
  - `getSecrets()` still returns environment values when Secrets Manager
    fetch/parse/provider loading fails.
  - `bootstrapSecretsIntoEnv()` still preserves existing environment values and
    never blocks startup.
  - No secret values, auth/RLS behavior, route/API contract, DB schema,
    migrations, external sends, billing, production config, push/deploy, or
    destructive operation changed.
- Performance:
  - Failure-path metadata construction only.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Red focused regression failed before the fix because `console.warn`
    contained raw provider/secret-id/token-like/PHI-like sentinel text.
  - Focused safe-log regression passed.
  - Full `src/lib/config/secrets.test.ts` passed `1` file / `6` tests.
  - Scoped ESLint, Prettier, and diff whitespace checks passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - gbrain write/readback passed for
    `projects/careviax/failures/2026-07-02/secrets-manager-raw-fallback-log`.
- Known risks:
  - Bootstrap catch is difficult to trigger through public behavior because
    `getSecrets()` intentionally handles configured Secrets Manager failures
    internally; the same safe logger is still applied there defensively.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, external sends, billing, production config, deployment,
    dependency versions, secret values, and destructive operations.
- Next improvements:
  - Continue scanning current backend/config/logging boundaries for raw
    diagnostic exposure with a red test before every fix.
- PR split:
  - Commit this config/test slice independently.
  - Commit report/progress updates separately.

## Slice: PHOS Lambda Observability Safe Log

- Timestamp: 2026-07-02 06:12 JST
- Purpose:
  - Prevent PHOS Lambda observability flush and security-event persistence
    failures from copying raw provider/runtime diagnostics, token-like text, or
    PHI-like values into Lambda logs.
  - Preserve best-effort observability behavior and correlation metadata.
- Changed files:
  - `src/phos/backend/lambda-handler.ts`
  - `src/phos/backend/lambda-handler.test.ts`
  - `src/phos/backend/lambda-observability.ts`
  - `src/phos/backend/lambda-observability.test.ts`
- Change reason:
  - `flushObservability()` logged raw `Error.message` text when the
    observability sink flush failed.
  - `createLambdaObservabilitySink().recordSecurityEvent()` logged raw
    `Error.message` text when DynamoDB security-event persistence failed.
- Deleted code:
  - Removed raw error-message fields from both PHOS Lambda failure-log paths.
- Commonized processing:
  - Added local safe error-name helpers for the Lambda handler boundary and
    observability sink boundary.
  - Both failure logs now emit `error_name` instead of raw diagnostic text.
- Safety:
  - Request response behavior, timeout behavior, observability flushing,
    security-event persistence attempts, correlation fields, hashed tenant/user
    fields, route contracts, auth/RLS behavior, DB schema, migrations, external
    sends, billing, production config/secrets, push/deploy, and destructive
    operations remain unchanged.
- Performance:
  - Failure-path metadata construction only.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Red focused regressions failed before the fix because logs still followed
    the old raw-message contract.
  - Focused safe-log regressions passed.
  - Full PHOS Lambda handler/observability test files passed `2` files / `24`
    tests.
  - Scoped ESLint, Prettier, and diff whitespace checks passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - gbrain write/readback passed for
    `projects/careviax/failures/2026-07-02/phos-lambda-raw-observability-log`.
- Known risks:
  - This slice only hardens PHOS Lambda observability failure logs. Broader
    backend log-safety scanning remains part of the active refactor objective.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, external sends, billing, production config, deployment,
    dependency versions, secret values, and destructive operations.
- Next improvements:
  - Continue scanning current backend/config/logging boundaries for raw
    diagnostic exposure with a red test before every fix.
- PR split:
  - Commit this PHOS backend/test slice independently.
  - Commit report/progress updates separately.

## Slice: PHOS Evidence Cleanup Safe Principal Log

- Timestamp: 2026-07-02 06:23 JST
- Purpose:
  - Prevent PHOS S3 evidence cleanup failure fallback logs from copying raw
    tenant/user identifiers into Lambda logs.
  - Preserve cleanup failure observability, mismatch reason, cleanup error
    kind, and request/correlation context.
- Changed files:
  - `src/phos/backend/evidence-upload-verification.ts`
  - `src/phos/backend/evidence-upload-verification.test.ts`
- Change reason:
  - `reportCleanupFailure()` spread callback-oriented cleanup failure context
    directly into default console JSON.
  - That context included raw `tenant_id` and `user_id`, while PHOS
    observability and structured logs use hash-only principal identifiers.
- Deleted code:
  - Removed raw `tenant_id` / `user_id` fields from default cleanup fallback
    console logs.
- Commonized processing:
  - Added a local cleanup failure log-shaping helper that emits
    `tenant_id_hash`, `user_id_hash`, request/correlation ids, mismatch reason,
    and safe cleanup error kind.
  - Reused that helper for cleanup reporter failure logs.
- Safety:
  - S3 verification, mismatch detection, cleanup attempts, custom cleanup
    callback payloads, request/correlation fields, route contracts, auth/RLS
    behavior, DB schema, migrations, external sends, billing, production
    config/secrets, push/deploy, and destructive operations remain unchanged.
- Performance:
  - Failure-path hash metadata construction only.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Red focused regression failed before the fix because fallback logs still
    followed the old raw-principal contract.
  - Focused safe-principal-log regression passed.
  - Full evidence verifier plus structured logger tests passed `2` files / `14`
    tests.
  - Scoped ESLint, Prettier, and diff whitespace checks passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - gbrain write/readback passed for
    `projects/careviax/failures/2026-07-02/phos-evidence-cleanup-raw-principal-log`.
- Known risks:
  - This slice only hardens the default fallback reporter. Custom
    `on_cleanup_failure` handlers still receive the same raw internal context
    and must be reviewed separately before changing that callback contract.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, external sends, billing, production config, deployment,
    dependency versions, secret values, and destructive operations.
- Next improvements:
  - Continue scanning fallback reporters that spread callback payloads directly
    into logs.
- PR split:
  - Commit this PHOS evidence verifier/test slice independently.
  - Commit report/progress updates separately.

## Slice: Security Event Audit Failure Safe Log

- Timestamp: 2026-07-02 06:30 JST
- Purpose:
  - Prevent fire-and-forget auth/RLS/security-event AuditLog persistence
    failures from copying raw request paths, query parameters, or raw exception
    diagnostics into runtime logs.
  - Preserve non-blocking security-event persistence behavior.
- Changed files:
  - `src/lib/auth/security-events.ts`
  - `src/lib/auth/security-events.test.ts`
- Change reason:
  - `logSecurityEvent()` caught rejected AuditLog writes with a legacy
    multi-argument `console.error` that included `event.path` and the raw caught
    error object.
- Deleted code:
  - Removed the raw path/error legacy `console.error` fallback.
- Commonized processing:
  - Routed fallback diagnostics through the shared safe `logger.warn` object
    overload.
  - The fallback log now emits only fixed event metadata, `entityType`, event
    type as `code`, method, and safe `error_name`.
- Safety:
  - AuditLog create payloads, deduplication throttle, fire-and-forget
    non-blocking behavior, auth/RLS caller semantics, route contracts, DB schema,
    migrations, external sends, billing, production config/secrets, push/deploy,
    and destructive operations remain unchanged.
- Performance:
  - Failure-path safe metadata construction only.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Red focused regression failed before the fix because the fallback still used
    the old raw console contract.
  - Focused security-event regression passed.
  - Related security-events/logger/auth/RLS tests passed `5` files / `44` tests
    with `1` skipped.
  - Scoped ESLint, Prettier, and diff whitespace checks passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - gbrain write/readback passed for
    `projects/careviax/failures/2026-07-02/security-event-audit-log-raw-failure-log`.
- Known risks:
  - This slice does not change AuditLog persisted `target_id` behavior; it only
    hardens the fallback log emitted when audit persistence itself fails.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, external sends, billing, production config, deployment,
    dependency versions, secret values, and destructive operations.
- Next improvements:
  - Continue scanning fire-and-forget security/audit catch paths that use legacy
    multi-argument console logging.
- PR split:
  - Commit this auth security-event/test slice independently.
  - Commit report/progress updates separately.

## Slice: Me Profile MFA Failure Safe Log

- Timestamp: 2026-07-02 06:37 JST
- Purpose:
  - Prevent optional Cognito MFA state lookup failures in `/api/me/profile` from
    copying raw provider diagnostics, token-like text, or PHI-like values into
    runtime warning logs.
  - Preserve profile response behavior when MFA enrichment fails.
- Changed files:
  - `src/app/api/me/profile/route.ts`
  - `src/app/api/me/profile/route.test.ts`
- Change reason:
  - The profile GET route caught unexpected `getUserMfaState()` failures and
    passed the raw caught error object to `console.warn`.
- Deleted code:
  - Removed the raw Cognito/provider error `console.warn` fallback.
- Commonized processing:
  - Routed unexpected MFA state lookup diagnostics through the shared safe
    `logger.warn` object overload.
  - The fallback log now emits route, method, operation, and safe `error_name`
    metadata only.
- Safety:
  - Profile GET success response shape, `mfaEnabled: false` fallback behavior,
    Cognito not-configured handling, PATCH behavior, auth resolution, DB schema,
    migrations, RLS/auth behavior, external sends, billing, production
    config/secrets, push/deploy, and destructive operations remain unchanged.
- Performance:
  - Failure-path safe metadata construction only.
  - No new request, DB query, dependency, polling, background job, broad scan,
    render fan-out, or unbounded loop was added.
- Validation:
  - Red focused regression failed before the fix because the fallback warning
    still used the old raw-error contract.
  - Focused MFA safe-log regression passed.
  - Full profile route plus logger tests passed `2` files / `18` tests.
  - Scoped ESLint, Prettier, and diff whitespace checks passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - gbrain write/readback passed for
    `projects/careviax/failures/2026-07-02/me-profile-mfa-raw-failure-log`.
- Known risks:
  - This slice does not change how the route reports `mfaEnabled` when optional
    Cognito MFA state enrichment fails; it only hardens the fallback log.
- Untouched dangerous areas:
  - DB schema/migrations/RLS policy definitions, auth/authz logic, tenant
    selection behavior, external sends, billing, production config, deployment,
    dependency versions, secret values, and destructive operations.
- Next improvements:
  - Continue scanning optional auth/provider enrichment branches that catch and
    log raw provider errors while still returning success.
- PR split:
  - Commit this profile route/test slice independently.
  - Commit report/progress updates separately.

## Slice: My Day / Tasks Triage Admin Status Cache Guard

- Timestamp: 2026-07-02 15:46 JST
- Purpose:
  - Close ULTRACODE F16/F17/F29/F39/F51 on My Day / Tasks triage without
    weakening API authorization or PHI minimization.
- Changed files:
  - `src/app/(dashboard)/my-day/my-day-content.tsx`
  - `src/app/(dashboard)/my-day/my-day-content.test.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.test.tsx`
- Change reason:
  - My Day overfetched assigned tasks, used an audit-log UTC date boundary,
    queried admin-only audit logs for non-admin users, and expected omitted
    audit-log patient names. Tasks hid urgent tasks from the immediate summary.
- Commonized processing:
  - Reused `japanDateKey()` for Japan business-day keys.
  - Reused `hasPermission(role, 'canAdmin')` for client-side visibility gating.
  - Reused `buildPatientHref()` for patient link path-segment safety.
- Safety:
  - `/api/audit-logs` remains server-gated by `canAdmin`.
  - AuditLog changes still omit `patient_name`.
  - Non-admin renders cannot show stale admin-only React Query status-change
    data because query key, derived data, and render branches are permission
    gated.
  - DB schema, migrations, RLS/auth semantics, external sends, billing,
    production config, push/deploy, and destructive operations were untouched.
- Performance:
  - My Day task pagination now uses the existing server-side `status=open`
    contract, reducing avoidable cursor pages and open-task truncation risk.
- Validation:
  - Focused My Day + Tasks tests passed `2` files / `23` tests.
  - Related `/api/tasks` + `/api/audit-logs` tests passed `2` files / `57`
    tests.
  - Scoped ESLint, Prettier, and diff whitespace checks passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `pnpm build`, and full `pnpm test -- --reporter=dot
--testTimeout=60000` passed.
  - Full test suite: `1266` files passed / `1` skipped; `12592` tests passed /
    `2` skipped.
  - gbrain write/readback passed for
    `projects/careviax/failures/2026-07-02/my-day-task-triage-admin-status-cache`.
- Known risks:
  - No role-specific browser smoke was run because no authenticated
    role-specific browser session was available; component queryFn/DOM tests
    directly cover the changed network and render behavior.
- PR split:
  - Commit this task-triage source/test slice independently.
  - Commit report/progress updates separately if a separate ledger commit is
    needed.
