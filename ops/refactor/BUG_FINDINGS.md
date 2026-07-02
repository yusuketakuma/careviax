# Bug Findings

Snapshot: 2026-07-02 04:50 JST

## Confirmed And Fixed In Recent Slices

### `BUG-PATIENT-SAFETY-BANNER-SILENT-LOSS-001`: Safety-check header hid patient safety fetch failure

- Severity: high medical safety / allergy and high-risk banner loss.
- Evidence:
  - `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.tsx`
  - `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.test.tsx`
- Problem:
  - The safety-check screen fetched patient summary data for the pinned
    allergy/high-risk banner but did not inspect `patientQuery.isError`.
  - On patient fetch failure, `patientName` was absent and the whole
    `PatientHeader` region silently disappeared while the safety workflow
    continued rendering.
- Impact:
  - Operators could continue a safety-check workflow without realizing the
    allergy/high-risk banner failed to load.
- Fix:
  - When `patientQuery.isError` is true, the pinned banner region now renders
    inline `ErrorState` with a retry action wired to `patientQuery.refetch()`.
  - Existing `issuesQuery` handling and the documented CDS fail-open path were
    left unchanged.
- Validation:
  - Focused red regression failed before the fix because patient safety error
    text was absent.
  - Focused regression and full safety-check component suite passed after the
    fix.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint, and
    production build passed.
  - Claude checker independently reviewed the diff and ran the full
    safety-check test file, then returned `APPROVED`.

### `BUG-PATIENT-MEDS-ALLERGY-FALSE-EMPTY-001`: Medication screen hid patient-summary allergy fetch failure

- Severity: high medical safety / allergy false-negative display.
- Evidence:
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.test.tsx`
- Problem:
  - The medications screen fetched patient summary data for `allergy_info` when
    patient context props were absent, but the allergy section did not inspect
    `patientSummaryQuery.isError`.
  - On patient summary fetch failure, `resolvedAllergyInfo` became `null` and
    the UI rendered `登録なし`, creating a false-empty / false-negative allergy
    state.
- Impact:
  - Operators could read the medication safety panel as "no registered
    allergies" when the allergy source failed to load.
- Fix:
  - When `allergyInfo` is not supplied and `patientSummaryQuery.isError` is
    true, the allergy section now renders inline `ErrorState` with a retry
    action wired to `patientSummaryQuery.refetch()`.
  - Successful fetched `allergy_info` rendering and prop-provided allergy
    rendering remain unchanged.
- Validation:
  - Focused red regression failed before the fix because the allergy error was
    absent and the section collapsed toward `登録なし`.
  - Focused red/green patient summary allergy tests passed after the fix.
  - Full medications content test file passed `1` file / `23` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint, and
    production build passed.
  - Claude checker independently reviewed the diff and ran the full
    medications content test file, then returned `APPROVED`.

### `BUG-SSK-IMPORT-RAW-ERROR-LOG-001`: SSK import persisted raw failure text

- Severity: medium import diagnostics privacy / persisted operational detail
  exposure.
- Evidence:
  - `src/server/services/drug-master-import/ssk.ts`
  - `src/server/services/drug-master-import/ssk.test.ts`
  - `src/app/api/drug-master-imports/ssk/route.test.ts`
  - `src/server/jobs/drug-master.test.ts`
- Problem:
  - `importSskDrugMaster()` caught import/upsert failures and persisted raw
    `Error.message` text into `drugMasterImportLog.error_log`.
  - The original exception is still rethrown to the caller, so this raw string
    persistence was separate from execution control.
- Impact:
  - ZIP/fetch/DB/upsert errors can include token-like strings, infrastructure
    details, YJ codes, or PHI-like text, and those details could be stored in the
    import log table.
- Fix:
  - Preserve the running log row, failed status update, and original exception
    rethrow.
  - Persist fixed `SSK取込に失敗しました` in the failed import log row.
- Validation:
  - Focused red regression failed before the fix because persisted `error_log`
    included secret-like / PHI-like sentinels.
  - Focused safe-log regression passed.
  - Full SSK import test file passed `1` file / `9` tests.
  - SSK import route plus drug-master job tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint, format
    check, diff check, production build, and gbrain put/get passed.

### `BUG-FILE-STORAGE-RAW-CLEANUP-ERRORS-001`: Expired generated-file cleanup returned raw deletion errors

- Severity: medium operational result privacy / retained export cleanup
  diagnostics exposure.
- Evidence:
  - `src/server/services/file-storage.ts`
  - `src/server/services/file-storage.test.ts`
  - `src/server/jobs/pdf-bulk-export.ts`
  - `src/app/api/patients/medications/bulk-export/route.test.ts`
- Problem:
  - `cleanupExpiredGeneratedFiles()` preserved deletion failure counts, but
    accumulated raw `Error.message` / `String(error)` values in its returned
    `errors[]`.
  - The helper is exposed through the bulk-export cleanup job wrapper, so S3/DB
    exception text could leave the cleanup boundary as an operational result.
- Impact:
  - S3 keys, token-like strings, infrastructure details, or PHI-like details in
    thrown deletion errors could be returned to job callers.
- Fix:
  - Preserve `errors.length`, processed counts, scanned counts, and the existing
    safe warning log.
  - Replace per-failure returned details with fixed
    `保持期限切れファイルの削除に失敗しました`.
- Validation:
  - Focused red regression failed before the fix because returned `errors[]`
    included secret-like / PHI-like sentinels.
  - Focused safe-cleanup regression passed.
  - Full file-storage suite passed `1` file / `72` tests.
  - File-storage plus related PDF bulk-export service/route tests passed `3`
    files / `101` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint, and
    format check, and final diff check passed.
  - `gbrain put/get projects/careviax/failures/2026-07-02/file-storage-raw-cleanup-errors`
    passed.

### `BUG-VISIT-PLANNER-RAW-EVALUATION-DIAGNOSTICS-001`: Visit proposal evaluation errors returned raw upstream text

- Severity: medium planner diagnostics privacy / user-facing internal detail
  exposure.
- Evidence:
  - `src/server/services/visit-schedule-planner.ts`
  - `src/server/services/visit-schedule-planner.test.ts`
  - `src/app/api/visit-schedule-proposals/route.test.ts`
  - `src/app/api/visit-schedule-proposals/[id]/route.test.ts`
- Problem:
  - Candidate evaluation failures used `error.message` in
    `diagnostics.rejected[].detail` for `reason_code: evaluation_error`.
  - The diagnostic is returned with generated proposal results, so road-routing
    or future helper exception text could surface to operators.
- Impact:
  - Patient-like, token-like, or infrastructure details from upstream evaluation
    failures could be exposed in proposal diagnostics.
- Fix:
  - Preserve `reason_code: evaluation_error` and the Japanese failure detail.
  - Stop reading the caught error and return fixed
    `評価中にエラーが発生しました`.
- Validation:
  - Focused red regression failed before the fix because rejected diagnostics
    included secret-like / PHI-like sentinels.
  - Focused safe-diagnostic regression passed.
  - Full visit-schedule-planner suite passed `1` file / `45` tests.
  - Planner plus visit-schedule-proposals route tests passed `3` files / `209`
    tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint, format
    check, production build, and gbrain put/get passed.

### `BUG-OFFLINE-SYNC-RAW-DIAGNOSTICS-001`: Offline sync persisted and logged raw unexpected failure text

- Severity: medium client diagnostics privacy / persisted PHI-or-secret exposure.
- Evidence:
  - `src/lib/stores/sync-engine.ts`
  - `src/lib/stores/sync-engine.test.ts`
  - `src/lib/stores/offline-db.ts`
  - `src/lib/stores/offline-store.ts`
  - `src/app/(dashboard)/offline-sync/offline-sync.shared.ts`
  - `src/app/(dashboard)/offline-sync/offline-sync-content.tsx`
  - `src/app/(dashboard)/schedules/schedule-day-offline-panel.tsx`
- Problem:
  - `processSyncQueueOnce()` catch copied arbitrary caught exception text into
    plaintext `syncQueue.lastError`.
  - `setupAutoSync()` logged the raw caught error object for automatic online
    sync failures.
  - `lastError` is later returned through sync queue state and displayed by
    offline sync / schedule conflict UI.
- Impact:
  - Crypto, IndexedDB, fetch, or future helper exceptions could persist
    token-like, infrastructure, or PHI-like details beside offline sync metadata
    and surface them in client UI/logs.
- Fix:
  - Preserve existing malformed payload, HTTP status, and conflict diagnostics.
  - Use fixed `同期に失敗しました` diagnostics for unexpected queue failure
    persistence and automatic sync warning output.
- Validation:
  - Focused red regressions failed before the fix because update payloads and
    console warnings contained secret-like / PHI-like sentinels.
  - Focused safe-diagnostic regressions passed.
  - Full sync-engine suite passed `1` file / `18` tests.
  - Related offline sync shared/offline-store tests passed `2` files / `15`
    tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint, format
    check, production build, and gbrain put/get passed.

### `BUG-REALTIME-LISTENER-RAW-DIAGNOSTICS-001`: Shared realtime stream listener failures logged raw messages

- Severity: medium client diagnostics privacy / secret exposure.
- Evidence:
  - `src/lib/realtime/shared-event-stream.ts`
  - `src/lib/realtime/shared-event-stream.test.ts`
  - `src/lib/hooks/use-realtime-events.ts`
  - `src/lib/hooks/use-realtime-invalidation.ts`
  - `src/lib/hooks/use-realtime-query.ts`
- Problem:
  - `logRealtimeListenerError()` isolated event/status listener exceptions so
    one broken consumer did not reconnect or break the shared SSE stream, but
    it copied raw `error.message` / `String(error)` into browser console
    diagnostics.
- Impact:
  - Listener exceptions can include token-like, infrastructure, or PHI-like
    details from UI consumers and would be visible in browser/devtool logs.
- Fix:
  - Preserve listener isolation and stream continuity.
  - Log fixed `Realtime listener failed` diagnostics with a safe error kind
    instead of raw listener failure text.
- Validation:
  - Focused red regression failed before the fix because console diagnostics
    contained secret-like / PHI-like sentinels.
  - Focused safe-diagnostic regression passed.
  - Full shared realtime stream suite passed `1` file / `4` tests.
  - Shared stream plus related realtime hook tests passed `3` files / `14`
    tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-CLOUDWATCH-METRICS-RAW-LOG-001`: CloudWatch metric failures logged raw provider text

- Severity: low-to-medium operational diagnostics privacy / secret exposure.
- Evidence:
  - `src/lib/aws/cloudwatch.ts`
  - `src/lib/aws/cloudwatch.test.ts`
  - `src/app/api/jobs/flush-metrics/route.test.ts`
  - `src/app/api/admin/flush-metrics/route.test.ts`
- Problem:
  - `putMetrics()` correctly swallowed CloudWatch send failures so metrics
    cannot break request paths, but it logged `err.message` or the raw thrown
    value to `console.error`.
- Impact:
  - CloudWatch/AWS/runtime failure messages could expose token-like or
    infrastructure details in local/server logs.
- Fix:
  - Preserve best-effort metric emission and caller-safe swallowing behavior.
  - Log the fixed safe message `CloudWatch metric emission failed` instead of
    raw provider/runtime text.
- Validation:
  - Focused red regression failed before the fix because the console call
    included secret-like sentinels.
  - Focused safe-log regression passed.
  - Full CloudWatch helper suite passed `1` file / `3` tests.
  - CloudWatch helper plus jobs/admin flush-metrics route tests passed `3`
    files / `8` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-JOB-RUNNER-RAW-DIAGNOSTICS-001`: Job runner persisted and notified raw failure text

- Severity: medium operational diagnostics privacy / secret exposure.
- Evidence:
  - `src/server/jobs/runner.ts`
  - `src/server/jobs/runner.test.ts`
  - `src/app/api/jobs/[jobType]/route.test.ts`
  - `src/app/api/jobs/route.test.ts`
- Problem:
  - `runJobOnce()` copied raw caught job failure messages into retry
    `integrationJob.error_log`, final failed `integrationJob.error_log`, admin
    notification messages, and cleanup-failure console diagnostics.
  - The route layer already masked job-list `error_log`, but the runner still
    persisted and broadcast the raw diagnostic text.
- Impact:
  - Provider/runtime exception text could contain token-like, infrastructure,
    or PHI-like details and become durable in job rows or admin notifications.
- Fix:
  - Persist fixed `Job execution failed` diagnostics for retry and final failed
    job rows.
  - Notify admins with a fixed Japanese execution-failure message instead of
    raw exception text.
  - Keep cleanup-failure console diagnostics fixed while preserving the
    original thrown error for upstream route handling.
- Validation:
  - Focused red regressions failed before the fix because update payloads and
    cleanup logs contained secret-like / PHI-like sentinels.
  - Focused safe-diagnostic regressions passed.
  - Full runner suite passed `1` file / `7` tests.
  - Runner plus jobs API route tests passed `3` files / `38` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-OUTBOUND-WEBHOOK-RAW-RESULT-001`: Webhook delivery results exposed raw URLs and dispatch exception messages

- Severity: medium operational diagnostics privacy / secret exposure.
- Evidence:
  - `src/server/services/outbound-webhook.ts`
  - `src/server/services/outbound-webhook.test.ts`
  - `src/app/api/jobs/[jobType]/route.test.ts`
- Problem:
  - `dispatchToEndpoint()` built `WebhookDeliveryResult.url` from the raw
    registered webhook URL even though pending delivery persistence already
    redacted query strings and fragments.
  - The same catch path copied raw fetch/runtime exception text into
    `WebhookDeliveryResult.error`, then persisted it to
    `webhookDelivery.error` and made it available to retry summary errors.
- Impact:
  - Registered webhook query secrets or provider/runtime failure messages could
    be exposed through returned delivery results, persisted delivery errors, or
    job output summaries.
- Fix:
  - Return redacted display URLs in `WebhookDeliveryResult` while still
    dispatching to the registered raw URL.
  - Replace raw dispatch exception messages with the fixed safe message
    `Webhook delivery failed`.
  - Added regressions proving result JSON and persisted update arguments exclude
    secret-like sentinels.
- Validation:
  - Focused red regressions failed before the fix because result URLs included
    query secrets and dispatch failures returned raw exception text.
  - Focused safe-result regressions passed.
  - Full outbound-webhook suite passed `1` file / `21` tests.
  - Outbound-webhook plus job route tests passed `2` files / `49` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-HEALTH-CHECK-DB-S3-RAW-ERROR-001`: Generic health-check DB/S3 failures returned raw exception messages

- Severity: medium operational diagnostics privacy.
- Evidence:
  - `src/server/services/health-check.ts`
  - `src/server/services/health-check.test.ts`
- Problem:
  - `checkDatabase()` and `checkS3()` returned raw `err.message` /
    `String(err)` in `CheckResult.message`.
- Impact:
  - Backend health check consumers could receive raw database/AWS/runtime
    messages containing secret-like or infrastructure details.
- Fix:
  - Preserved `status: 'down'` on failures.
  - Returned fixed safe messages for DB and S3 health failures.
  - Preserved successful checks, S3 unconfigured skip behavior, S3 client
    caching, and aggregate health behavior.
  - Added regressions proving secret-like sentinels are absent from result JSON.
- Validation:
  - Focused red regression failed before the fix because DB and S3 checks
    returned raw failure text.
  - Focused safe-message regression passed.
  - Full health-check suite passed `1` file / `7` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-BACKUP-MONITOR-AWS-ERROR-001`: Backup monitor AWS check errors returned/logged raw provider messages

- Severity: medium admin-response privacy / operational secret exposure.
- Evidence:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
  - `src/app/api/health/route.test.ts`
- Problem:
  - RDS snapshot, S3 versioning, audit archive lifecycle, and Cognito Advanced
    Security catch blocks returned raw `err.message` / `String(err)` in
    `BackupCheckResult.message`.
  - The same catch blocks passed raw provider error objects to the logger.
- Impact:
  - Admin health details and logs could expose provider/runtime messages with
    infrastructure or token-like details even when the route-level rejection
    catch was fixed.
- Fix:
  - Preserved success, warning, and unconfigured skip behavior.
  - Replaced raw result messages with fixed per-check safe messages.
  - Logged a new fixed-message `Error` instead of the raw provider error.
  - Kept the RDS SDK import failure as a dedicated fixed safe message through
    an internal safe-error marker.
  - Added regression coverage proving result messages and logger error
    arguments exclude secret-like sentinels.
- Validation:
  - Focused red regression failed before the fix because RDS returned the raw
    AWS failure message.
  - Focused safe-message regression passed.
  - Full backup-monitor suite passed `1` file / `8` tests.
  - Backup-monitor plus health route tests passed `2` files / `13` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-HEALTH-BACKUP-RAW-ERROR-001`: Health route backup monitor failures exposed raw exception messages

- Severity: medium admin-response privacy / operational secret exposure.
- Evidence:
  - `src/app/api/health/route.ts`
  - `src/app/api/health/route.test.ts`
  - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-response.md`
- Problem:
  - When `runBackupMonitorChecks()` rejected, `/api/health` returned the raw
    exception message in `checks.backups.message` for authenticated admins.
  - Admin-only diagnostics still need a secret-safe response boundary because
    operational exceptions can include infrastructure identifiers or token-like
    text.
- Impact:
  - A backup monitor runtime failure could expose internal details in route
    JSON instead of a fixed operator-safe status message.
- Fix:
  - Preserved `status: 'degraded'`, `checks.backups.status: 'error'`, and
    public unauthenticated cheap liveness behavior.
  - Replaced route-level backup monitor rejection messages with the fixed safe
    text `backup monitor failed`.
  - Added a regression proving the route JSON omits the raw secret-like
    sentinel from the thrown backup-monitor exception.
- Validation:
  - Focused red regression failed before the fix because the route returned the
    raw backup monitor exception message.
  - Focused health raw-error regression passed.
  - Health route plus backup-monitor tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, diff check, full typecheck, no-unused, lint,
    format check, production build, and gbrain put/get passed.

### `BUG-BACKUP-MONITOR-RDS-001`: Configured RDS backup monitor dependency-load failures were false-green

- Severity: high backup/operational monitoring correctness.
- Evidence:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
  - `src/app/api/health/route.test.ts`
- Problem:
  - `loadRdsModule()` converted dynamic `@aws-sdk/client-rds` import failure
    to cached `null`.
  - `checkRdsSnapshot()` then returned `status: 'skipped'` /
    `@aws-sdk/client-rds not installed` even when `RDS_DB_INSTANCE_ID` was
    configured.
  - `runBackupMonitorChecks()` does not degrade on skipped checks, so a
    configured RDS backup monitor failure could leave aggregate backup health
    `overall: 'ok'`.
- Impact:
  - A production backup monitor could report a false-green state when the RDS
    snapshot check was configured but could not actually run.
- Fix:
  - Preserved the unconfigured local-environment skip.
  - Removed the `catch(() => null)` dependency-load fallback and the configured
    RDS optional-dependency skip branch.
  - RDS SDK load failure now clears the failed cached promise and throws a fixed
    safe error that `checkRdsSnapshot()` reports as `status: 'error'`.
  - Added regression coverage proving the returned/logged message excludes the
    raw token-like sentinel and original import error object, and proving
    aggregate backup monitor health becomes `overall: 'error'`.
- Validation:
  - Focused red regression failed before the fix because configured RDS SDK
    import failure returned `status: 'skipped'`.
  - Focused RDS import failure regression passed.
  - Full backup-monitor test file passed `1` file / `7` tests.
  - Backup-monitor plus health route tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, full typecheck, no-unused, lint, format check,
    diff check, production build, and gbrain put/get passed.

### `BUG-DRUG-MASTER-IMPORT-STREAM-CANCEL-001`: External import stream cancel failures were silent

- Severity: medium external-input observability / cleanup.
- Evidence:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
  - `src/lib/utils/logger.test.ts`
- Problem:
  - `readResponseBytes()` cancels a response body reader when a body read fails
    or when a streamed external import exceeds the byte limit.
  - Both cleanup paths used `reader.cancel().catch(() => undefined)`, so failed
    cancellation was invisible while the original read/size error was returned.
- Impact:
  - Operators could see only the primary import failure and miss that stream
    cleanup also failed, making external import/network cleanup issues harder to
    diagnose.
- Fix:
  - Preserved the original read error or byte-limit error as caller-visible
    behavior.
  - Routed stream cancellation through a helper that emits shared safe
    `logger.warn` metadata only if cleanup fails.
  - Normalized the import source for safe logger context and omitted source
    URLs, raw cancel error text, credentials, PHI, secrets, and stacks.
  - Added a regression proving oversized-stream cancellation failure logs fixed
    safe context without leaking the source URL or raw cancel error text.
- Validation:
  - Focused red regression failed before the fix because `logger.warn` had zero
    calls.
  - Focused stream-cancel warning test passed.
  - Full drug-master import shared test file passed `1` file / `20` tests.
  - Shared import + shared logger tests passed `2` files / `31` tests.
  - Scoped ESLint, Prettier, and diff-check for changed shared/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain put/get for
    `projects/careviax/failures/2026-07-02/drug-master-import-stream-cancel-silent-failure`
    passed.

### `BUG-PHOS-FEE-RULES-ROLLBACK-001`: Aurora fee-rules rollback failures were silent

- Severity: medium PH-OS backend observability / transaction cleanup.
- Evidence:
  - `src/phos/backend/aurora-fee-rules-repository.ts`
  - `src/phos/backend/aurora-fee-rules-repository.test.ts`
  - `src/phos/backend/structured-logger.ts`
- Problem:
  - `AuroraFeeRulesRepository.searchFeeRules()` correctly preserved the
    original query error and attempted `ROLLBACK`, but the rollback failure path
    used `connection.query('ROLLBACK').catch(() => undefined)`.
  - If Aurora rejected rollback after the primary query failed, operators had no
    PH-OS structured signal that transaction cleanup itself failed.
- Impact:
  - Fee-rule search failures could hide an additional transaction cleanup
    failure, making Aurora connection/session health issues harder to diagnose.
- Fix:
  - Preserved the original query error and `connection.release()` behavior.
  - Replaced the empty rollback catch with a PH-OS structured `WARNING` event
    using `buildLogEntry()` and `logPhosEvent()`.
  - Logged only fixed metadata: message, result, route key, error code, request
    and correlation ids, and operation name.
  - Added a regression proving the warning excludes raw rollback error text,
    database URLs, tenant ids, and user ids.
- Validation:
  - Focused red regression failed before the fix because `console.error` had
    zero structured warning calls.
  - Focused rollback warning test passed.
  - Full `aurora-fee-rules-repository` test file passed `1` file / `16` tests.
  - Scoped ESLint, Prettier, and diff-check for changed backend/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain put/get for
    `projects/careviax/failures/2026-07-02/phos-fee-rules-rollback-silent-failure`
    passed.

### `BUG-ROOM-TOKEN-CLIENT-001`: Collaboration room-token transient failures were silent in the client

- Severity: medium collaboration observability.
- Evidence:
  - `src/lib/collaboration/room-token-client.ts`
  - `src/lib/collaboration/room-token-client.test.ts`
  - `src/lib/hooks/use-collaborative-form.test.tsx`
  - `src/lib/collaboration/yjs-provider.test.ts`
  - `src/lib/utils/logger.test.ts`
- Problem:
  - `fetchCollaborationRoomToken()` intentionally maps rejected fetches,
    429/5xx responses, malformed token payloads, and expired token payloads to
    `transient-error` so `useYjsCollaborationRoom()` can retry.
  - Those paths previously produced no safe diagnostic signal, so collaborative
    editing could stay disconnected or keep retrying while the root cause was
    lost.
- Impact:
  - Operators could not distinguish throttling, backend failure, malformed
    token payload, expired token payload, or browser/network rejection when
    collaboration failed to connect.
- Fix:
  - Preserved `RoomTokenFetchResult` behavior: rejected fetches and invalid
    token responses still return `transient-error`; denied responses still
    return `access-denied`.
  - Added throttled shared safe `logger.warn` metadata for `FETCH_REJECTED`,
    `TRANSIENT_HTTP`, `MALFORMED_PAYLOAD`, and `EXPIRED_TOKEN`.
  - Omitted entity id, room name, raw response body, room token/JWT text, raw
    error message, stack, patient names, and token sentinels from warning
    context.
  - Added regressions that failed before the fix because `logger.warn` had zero
    calls on these transient failure paths.
- Validation:
  - Focused room-token client test passed `1` file / `7` tests.
  - Room-token client + collaborative form hook + Yjs provider + shared logger
    tests passed `4` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check for changed client/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain put/get for
    `projects/careviax/failures/2026-07-02/room-token-client-transient-silent-failure`
    passed.

### `BUG-PRESENCE-CLIENT-001`: Presence heartbeat delivery failures were silent in the client

- Severity: medium collaboration observability.
- Evidence:
  - `src/lib/collaboration/presence-api-client.ts`
  - `src/lib/hooks/use-presence-heartbeat.test.ts`
  - `src/lib/collaboration/presence.test.ts`
  - `src/lib/utils/logger.test.ts`
- Problem:
  - Presence heartbeat is intentionally best-effort so collaboration UI does
    not break when `/api/presence` delivery fails.
  - `postPresenceUpdate()` previously caught fetch rejection with
    `.catch(() => undefined)`, and non-ok HTTP responses resolved normally.
    Both paths left operators with no safe signal that collaborator presence
    could be stale or missing.
- Impact:
  - Users could continue editing while collaborator presence silently
    disappeared, making realtime collaboration failures hard to diagnose.
- Fix:
  - Preserved best-effort client behavior: network failure still resolves
    `undefined`, and non-ok responses still resolve the original `Response`.
  - Added throttled shared safe `logger.warn` metadata for rejected fetches and
    non-ok responses using fixed route/method/operation metadata, entity type,
    and status when available.
  - Omitted org id, entity id, active field, raw error message, stack, patient
    names, phone values, and tokens from warning context.
  - Added regressions that failed before the fix because `logger.warn` had zero
    calls on network and non-ok failures.
- Validation:
  - Focused presence heartbeat test passed `1` file / `6` tests.
  - Presence heartbeat + presence contract + shared logger tests passed `3`
    files / `24` tests.
  - Scoped ESLint, Prettier, and diff-check for changed client/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain put/get for
    `projects/careviax/failures/2026-07-02/presence-heartbeat-client-silent-failure`
    passed.

### `BUG-VISIT-SCHEDULE-PROPOSAL-001`: Pharmacist enrichment failures on proposal detail were silently swallowed

- Severity: medium observability / schedule detail data completeness.
- Evidence:
  - `src/app/api/visit-schedule-proposals/[id]/route.ts`
  - `src/app/api/visit-schedule-proposals/[id]/route.test.ts`
  - `src/lib/utils/logger.test.ts`
- Problem:
  - `GET /api/visit-schedule-proposals/[id]` loads proposal detail, related
    proposals, route-day schedules, creation diagnostics, and then enriches the
    response with proposed pharmacist records.
  - The pharmacist enrichment query was wrapped in `.catch(() => [])`, so DB
    or read failures produced a successful no-store response with
    `proposed_pharmacist: null` and no operator-visible signal.
- Impact:
  - Users could see a proposal detail response with missing pharmacist
    enrichment while operators could not distinguish legitimate missing
    pharmacist data from an enrichment read failure.
- Fix:
  - Preserved the existing `200` response, sensitive no-store headers, route
    preview behavior, related proposal shape, auth behavior, and empty-array
    fallback.
  - Replaced the silent enrichment catch with shared safe `logger.warn`
    metadata using only fixed route/operation metadata, org id, proposal target
    id, entity type, count, and sanitized error metadata.
  - Added a regression test that failed before the fix because `logger.warn`
    had zero calls when the enrichment query rejected.
  - The test proves warning context excludes patient name, phone, token, and
    pharmacist name sentinels.
- Validation:
  - Focused visit schedule proposal detail route test passed `1` file / `75`
    tests.
  - Route + shared logger tests passed `2` files / `86` tests.
  - Protected GET matrix for visit-schedule-proposals passed `6` tests / `369`
    skipped.
  - Scoped ESLint, Prettier, and diff-check for changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain put/get for
    `projects/careviax/failures/2026-07-02/visit-schedule-proposal-pharmacist-enrichment-empty-catch`
    passed.

### `BUG-PATIENT-MCS-001`: Failed-state persistence errors were silent and identity conflict errors could persist patient names

- Severity: medium privacy / observability / patient integration reliability.
- Evidence:
  - `src/server/services/patient-mcs.ts`
  - `src/server/services/patient-mcs.test.ts`
  - `src/app/api/patients/[id]/mcs/route.test.ts`
  - `src/app/api/patients/[id]/mcs-sync/route.test.ts`
- Problem:
  - When `syncPatientMcsTimeline` caught a primary sync failure, it attempted
    to persist `last_sync_status: 'failed'` and `last_sync_error` on
    `patientMcsLink`.
  - If that failed-state upsert also rejected, the code used
    `.catch(() => undefined)`, leaving operators with no signal that the
    persisted MCS sync status might be stale.
  - Identity mismatch failures also built `PatientMcsSyncError.message` with
    local/remote patient-name text, and the failure-state path persisted that
    message into `last_sync_error`.
- Impact:
  - The original API error still propagated, but the operational record could
    remain stale without safe diagnostics.
  - Patient-name-bearing MCS identity conflict text could be stored and later
    returned through the authorized patient MCS overview payload.
- Fix:
  - Preserved the original thrown `PatientMcsSyncError` and best-effort
    failed-state persistence semantics.
  - Replaced the silent secondary persistence catch with shared safe
    `logger.warn` metadata using only fixed event/operation, org id, actor id,
    entity type, and sanitized error metadata.
  - Replaced patient-name-bearing identity conflict messages with the existing
    fixed operator-safe conflict message before persistence.
  - Added regression tests that failed before the fixes: one for missing
    warning on secondary persistence failure and one for patient-name-bearing
    conflict text in the thrown/persisted failure path.
- Validation:
  - Focused patient MCS service test passed `1` file / `23` tests.
  - Patient MCS service + MCS API route + logger tests passed `4` files / `57`
    tests.
  - Scoped ESLint, Prettier, and diff-check for changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain put/get for
    `projects/careviax/failures/2026-07-02/patient-mcs-failure-state-empty-catch`
    passed.

### `BUG-EXTERNAL-ACCESS-001`: Grant rollback failures after fallback audit failure were silently swallowed

- Severity: medium security observability / external sharing cleanup
  reliability.
- Evidence:
  - `src/app/api/external-access/route.ts`
  - `src/app/api/external-access/route.test.ts`
- Problem:
  - `POST /api/external-access` creates a JWT-backed grant, sends or returns an
    OTP, and records audit state.
  - When SMS delivery failed and the fallback audit write also failed, the
    route attempted to revoke the just-created grant before returning a fixed
    no-store `500` response.
  - If that rollback revocation failed, the code used
    `.catch(() => undefined)`, leaving the cleanup failure completely silent.
- Impact:
  - The client received no token or OTP in the failure response, but an
    unrevoked external access grant could remain in storage without an
    operator-visible signal for investigation.
- Fix:
  - Preserved the existing fail-closed `500` response, sensitive no-store
    response boundary, and rollback attempt.
  - Replaced the silent rollback catch with the shared safe logger object
    overload using event, route, method, operation, org id, actor id, entity
    type, and grant id only.
  - Added a regression test that failed before the fix because `logger.warn`
    had zero calls when grant revocation failed after fallback audit failure.
  - The test also proves the warning context and response exclude raw phone
    contact, JWT/token text, and OTP-shaped values.
- Validation:
  - Focused external-access route test passed `1` file / `35` tests.
  - External-access route + logger tests passed `2` files / `46` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-PRESENCE-001`: Presence realtime broadcast failures were silently swallowed

- Severity: medium observability / realtime collaboration reliability.
- Evidence:
  - `src/app/api/presence/route.ts`
  - `src/app/api/presence/route.test.ts`
- Problem:
  - `POST /api/presence` writes the in-memory presence heartbeat first, then
    broadcasts a best-effort realtime `presence_update`.
  - Realtime broadcast rejection was caught with `.catch(() => undefined)`, so
    Redis/adapter delivery failures were invisible to operators while the
    client still received the intended successful heartbeat response.
- Impact:
  - Presence polling/read fallback could still recover state from the local
    presence store, but immediate collaboration presence delivery failures
    could not be detected or correlated safely.
- Fix:
  - Preserved the successful heartbeat response and local presence store write.
  - Replaced the empty catch with the shared safe logger object overload using
    event, route, method, operation, org id, and entity type only.
  - Added a regression test that failed before the fix because
    `logger.warn` was never called for a rejected realtime broadcast.
  - The test also proves raw error text, active field, and display name are not
    placed in the structured warning context.
- Validation:
  - Focused presence route test passed `1` file / `12` tests.
  - Presence route + logger tests passed `2` files / `23` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-VOICE-MEMO-001`: Manual transcript local-save false result was treated as success

- Severity: medium offline UX / data-retention correctness.
- Evidence:
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.tsx`
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.test.tsx`
  - `src/lib/offline/voice-memo-drafts.ts`
- Problem:
  - `saveVoiceMemoManualTranscript()` intentionally returns `false` when a
    manual transcript cannot be saved to a local voice memo draft, for example
    when no matching draft exists.
  - `VoiceMemoContent` only handled rejected promises, so a non-throwing
    `false` save result still showed the normal transcript reflection success
    path without warning the user that the local encrypted draft was not
    updated.
- Impact:
  - A pharmacist could believe the hand-entered transcript was locally
    retained, then lose that draft persistence on navigation/reload unless they
    separately reflected it into the visit record.
- Fix:
  - Kept the immediate transcript reflection and visit-record append workflow.
  - Treats `false` from `saveVoiceMemoManualTranscript()` the same as a
    rejected save for warning purposes.
  - Added a regression test that failed before the fix because
    `toast.warning` was never called for a `false` local-save result.
- Validation:
  - Focused voice memo content + offline draft tests passed `2` files / `11`
    tests.
  - Scoped ESLint, Prettier, and diff-check for the changed component/test
    files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-NOTIFICATIONS-001`: Realtime notification broadcast failures were silently swallowed

- Severity: medium observability / notification reliability.
- Evidence:
  - `src/server/services/notifications.ts`
  - `src/server/services/notifications.test.ts`
- Problem:
  - `broadcastPersistedNotifications` intentionally treats realtime broadcast as
    best-effort because persisted notification rows remain the source of truth.
  - Its catch block was empty, so failures in the immediate realtime delivery
    path were invisible to operators.
- Impact:
  - Users could still recover notifications from persisted rows, but missed
    realtime delivery could not be detected or correlated safely.
- Fix:
  - Replaced the empty catch with shared safe logger warning metadata:
    event, entity type, operation, and notification count only.
  - Preserved persisted notification creation, return shape, realtime
    best-effort behavior, and external delivery scheduling.
  - Added a regression test proving persisted notifications are still returned
    and the warning context excludes raw PHI/secret-bearing error text.
- Validation:
  - Focused notification service test passed `1` file / `15` tests.
  - Notification service + logger tests passed `2` files / `26` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-BULK-EXPORT-001`: Immediate bulk-export drain failures were silently swallowed

- Severity: medium observability / operational reliability.
- Evidence:
  - `src/app/api/patients/medications/bulk-export/route.ts`
  - `src/app/api/patients/medications/bulk-export/route.test.ts`
- Problem:
  - When `queueMedicationHistoryBulkExport` returned `startedImmediately:
true`, the route kicked off `drainMedicationHistoryBulkExportQueue` as a
    background promise.
  - A drain rejection was caught by an empty catch body, making immediate
    background job startup failures invisible to logs while the client still
    received the intended `202 Accepted` queued response.
- Impact:
  - Medication-history bulk exports could remain pending until the job endpoint
    drained them later, but operators would have no safe signal that the
    immediate drain failed.
- Fix:
  - Replaced the empty catch with shared safe logger warning metadata:
    event, org id, job id, job type, and operation only.
  - Preserved the `202` response, sensitive no-store headers, queue semantics,
    and later job-endpoint recovery path.
  - Added a regression test proving failed immediate drain still returns
    no-store `202` and logs no raw PHI/secret-bearing message in the structured
    warning context.
- Validation:
  - Focused bulk-export route test passed `1` file / `8` tests.
  - Bulk-export route + logger tests passed `2` files / `19` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-RT-001`: Redis realtime unsubscribe race could drop active listeners

- Severity: medium correctness / realtime reliability.
- Evidence:
  - `src/server/adapters/realtime/redis-adapter.ts`
  - `src/server/adapters/realtime/redis-adapter.test.ts`
- Problem:
  - `unsubscribeFromChannel` removed the channel from local
    `subscribedChannels` before the asynchronous Redis `unsubscribe()`
    completed. If a new listener subscribed to the same channel while that
    unsubscribe was still pending, the adapter could call `subscribe()` and
    then let the earlier `unsubscribe()` complete afterward, leaving active
    listeners without a Redis subscription.
  - The normal subscribe path also marked a channel as subscribed before Redis
    confirmed `subscribe()`, so a failed `subscribe()` could poison local state
    and make later listeners skip the real Redis subscribe call.
- Impact:
  - Workflow, notification, presence, and collaboration realtime consumers that
    use the Redis adapter could silently miss updates after mount/unmount races
    or transient Redis subscribe failures.
- Fix:
  - Added per-channel pending-unsubscribe tracking.
  - New listeners wait for a pending unsubscribe to settle, and the adapter
    resubscribes when listeners were added during the unsubscribe window.
  - Centralized Redis subscribe state updates so failed `subscribe()` calls roll
    back local subscribed state.
  - Added mocked Redis regression tests for the pending-unsubscribe race and
    failed-subscribe state rollback.
- Validation:
  - Focused Redis adapter tests passed `1` file / `4` tests.
  - Realtime policy + Redis adapter tests passed `2` files / `8` tests.
  - Scoped ESLint and Prettier for the changed adapter/test files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-LOG-001`: Shared logger string overload could be misused with raw errors

- Severity: medium security/correctness.
- Evidence:
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Problem:
  - The legacy string overload accepted raw error-like second arguments at the
    type boundary and runtime bypasses could expose raw error message, stack, or
    stringified values.
- Fix:
  - Tightened the typed overload and sanitized runtime bypasses through shared
    safe error metadata.
- Validation:
  - `pnpm exec vitest run src/lib/utils/logger.test.ts --reporter=dot --testTimeout=60000`
    passed.
  - Later full `typecheck`, `typecheck:no-unused`, `lint`, `format:check`,
    `git diff --check`, and `build` passed.

### `BUG-DASHBOARD-SNAPSHOT-001`: Workflow route snapshot lagged the service href contract

- Severity: low/medium test correctness.
- Evidence:
  - `src/app/api/dashboard/workflow/route.test.ts`
  - `src/app/api/dashboard/workflow/__snapshots__/route.test.ts.snap`
  - `src/server/services/workflow-dashboard-sections.test.ts`
- Problem:
  - The route snapshot still expected broad fallback dashboard hrefs while the
    current workflow-dashboard section builders and service tests assert more
    specific focus/detail hrefs.
- Fix:
  - Updated the workflow route snapshot via Vitest snapshot update after the
    focused route test exposed the mismatch.
- Validation:
  - Workflow route test passed `1` file / `20` tests after updating the single
    snapshot.
  - Workflow-dashboard sections service test passed `1` file / `12` tests.

## Confirmed Refactor-Inconsistency With Security Impact

### `BUG-DMI-002`: Shared import logs persisted raw failure diagnostics

- Severity: medium security/privacy.
- Evidence:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
  - `src/app/api/drug-master-import-logs/route.ts`
  - `src/app/api/drug-master-imports/status/route.ts`
- Problem:
  - `withImportLog()` copied caught importer `Error.message` text into
    `drugMasterImportLog.error_log` for failed generic drug-master imports.
  - `withImportLog()` is shared by MHLW price/generic, PMDA, HOT, and manual
    clinical import services, and import log data is surfaced by import-log and
    status APIs.
  - If writing the failed-log update itself rejected, the update error also
    masked the original importer error.
- Impact:
  - Raw database/external-file/import diagnostics could be persisted into
    operator-visible import logs, including token-like, infrastructure,
    source-URL, or PHI-like details.
  - Secondary failed-log update failures could obscure the real importer root
    cause.
- Fix:
  - Persist only fixed `医薬品マスタ取込に失敗しました` text to failed generic
    drug-master import logs.
  - Preserve original importer exception propagation.
  - Log failed failed-log updates through safe structured logger metadata
    without storing raw diagnostics.
- Validation:
  - Initial focused regression failed before the fix because the persisted
    `error_log` contained raw secret-like / PHI-like importer failure text.
  - Focused shared import/logger regressions passed.
  - MHLW/PMDA/HOT/manual service tests and import route/status/log API tests
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-LOG-002`: PHI-bearing routes duplicated local error-name sanitizers

- Severity: medium security/inconsistency.
- Evidence:
  - `rg -n "SAFE_ERROR_NAMES|safeErrorName" src/app/api src/lib --glob '*.ts'`
  - Multiple route handlers still carry route-local copies while the shared
    logger is the canonical PHI/secret-safe sanitizer.
- Impact:
  - Duplicated route-local sanitizers can drift from the shared logger contract
    and make PHI/secret redaction weaker or inconsistent.
- Fix status:
  - Fixed in many small tested slices, including dashboard monthly-stats,
    patient self reports, inquiry records, medication issues/profiles,
    residual medications, first-visit documents, dispense verify-barcode, drug
    masters, drug-master imports, consent records, communication request
    responses, comments, billing-evidence analytics/stats/check,
    staff-workload, tracing-reports collection/detail, CDS check, and
    medication-cycle history, pharmacy stock usage-mismatch/bulk, and
    set-batches detail/collection, set-plans collection/detail/
    generate-batches, set-audits, dispense-audits, dispense-results, and
    care-reports, visit-billing-candidates summary, visit-records, patient
    prescription routes, and dashboard workflow/cockpit/medication-deadlines
    routes.
  - Current inventory is exhausted outside the canonical shared logger
    implementation.

## Confirmed Refactor-Inconsistency With Security Impact

### `BUG-PDFBULK-001`: PDF bulk-export failures persisted and returned raw diagnostics

- Severity: high security/privacy.
- Evidence:
  - `src/server/services/pdf-bulk-export.ts`
  - `src/server/services/pdf-bulk-export.test.ts`
  - `src/app/api/jobs/[jobType]/route.ts`
  - `src/app/api/jobs/[jobType]/route.test.ts`
  - Sidecar `privacy_compliance_reviewer` confirmed raw terminal export
    failures flowed through `integrationJob.error_log`, failure notifications,
    and the medication-history bulk-export drain response.
- Problem:
  - `runMedicationHistoryBulkExportJob()` used raw caught `Error.message` text
    for terminal failures, then stored it in `integrationJob.error_log` and
    sent it as the requester failure notification message.
  - `drainMedicationHistoryBulkExportQueue()` also returned raw caught failure
    messages in `errors[]`; `POST /api/jobs/medication-history-bulk-export-drain`
    spread that array into the HTTP response.
  - Secondary cleanup / notification failure paths logged raw `Error` objects
    through `console.error`.
- Impact:
  - Storage, audit, ZIP, notification, Prisma, or provider exceptions could
    persist PHI-like text, storage keys, signed URLs, internal paths, tenant or
    patient identifiers, or token-like details in job logs, notifications,
    drain API responses, or production logs.
- Fix:
  - Added `getSafeBulkExportFailureMessage()` so expected
    `MedicationHistoryBulkExportError` messages remain actionable while
    unexpected terminal provider/runtime errors persist and notify only
    `薬歴 PDF ZIP の生成に失敗しました`.
  - Sanitized `drainMedicationHistoryBulkExportQueue()` error entries and made
    `/api/jobs/[jobType]` return only `errorCount` for
    `medication-history-bulk-export-drain`, matching the existing cleanup-job
    safe response pattern.
  - Replaced raw `console.error(..., Error)` calls in PDF bulk-export cleanup,
    lock-loss, and notification best-effort paths with shared safe
    `logger.warn({ event, orgId, targetId, jobType, operation }, error)`
    metadata.
- Validation:
  - Initial focused regressions failed before the fix because raw
    PHI/secret/storage sentinel strings reached `error_log`, notifications, and
    drain API responses.
  - Focused service/API regressions passed after the fix.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

### `BUG-DAILY-001`: Daily jobs returned raw caught diagnostics in `errors[]`

- Severity: medium security/privacy.
- Evidence:
  - `src/server/jobs/daily/orchestrator.ts`
  - `src/server/jobs/daily/visits.ts`
  - `src/server/jobs/daily/shared.ts`
  - `src/server/jobs/daily.test.ts`
  - `src/app/api/jobs/[jobType]/route.ts`
- Problem:
  - `runDailyOperations()` aggregated fulfilled subtask `errors[]` unchanged
    and copied rejected subtask `Error.message` text into its own returned
    `errors[]`.
  - `generateVisitDemands()` returned caught planner / persistence error
    messages in its direct job result.
  - Job results are persisted by `runJob()` and can be spread into successful
    job API responses by `/api/jobs/[jobType]`.
- Impact:
  - Provider, Prisma, storage, token-like, infrastructure, or PHI-like details
    could be persisted in job output or returned to an operator-facing job API
    response after a completed-but-partially-failed daily job.
- Fix:
  - Added a shared fixed safe daily operation error message.
  - Sanitized rejected daily subtasks and fulfilled subtask `errors[]` entries
    during daily orchestration.
  - Sanitized unexpected visit-demand generation errors while preserving the
    existing workflow-gate operational task path.
- Validation:
  - Initial focused regressions failed before the fix because raw sentinel
    strings reached daily job result `errors[]`.
  - Focused daily job safe-error regressions passed after the fix.
  - Full daily job test file, scoped ESLint/Prettier/diff-check, full
    typecheck, no-unused, lint, format check, and production build passed.

### `BUG-RATELIMIT-001`: DynamoDB rate-limit failures logged raw diagnostics

- Severity: medium security/privacy.
- Evidence:
  - `src/lib/api/rate-limit.ts`
  - `src/lib/api/rate-limit.test.ts`
  - `src/proxy.ts`
- Problem:
  - `DynamoRateLimitStore.increment()` correctly failed closed in production
    when the DynamoDB store failed, but passed the raw caught `Error` object to
    `console.error`.
  - The same catch branch is reachable from the Edge proxy rate-limit gate for
    protected API traffic.
- Impact:
  - Provider, AWS, token-like, signed URL, tenant, or PHI-like diagnostic text
    could be written to production logs even though the API response itself was
    safely fail-closed.
- Fix:
  - Replaced raw `console.error(message, error)` calls with safe metadata
    containing fixed event/operation fields and `error_name` only.
  - Preserved production fail-closed behavior and non-production in-memory
    fallback behavior.
- Validation:
  - Initial focused regression failed before the fix because the raw sentinel
    failure text remained in the captured console call.
  - Focused and full rate-limit test suites passed after the fix.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

### `BUG-RATELIMIT-002`: Rate-limit route template catalog missed a live API route

- Severity: medium correctness/security.
- Evidence:
  - `src/lib/api/rate-limit.ts`
  - `src/lib/api/rate-limit.test.ts`
  - `src/app/api/visit-schedules/[id]/conflict-reconfirmation/route.ts`
- Problem:
  - `API_ROUTE_TEMPLATES` did not include the live
    `/api/visit-schedules/[id]/conflict-reconfirmation` App Router endpoint.
  - The existing catalog sync regression failed when run against the current
    route tree.
- Impact:
  - The route could fall through to the unknown-route canonicalization path,
    weakening per-route rate-limit bucket grouping consistency for that API.
- Fix:
  - Added `/api/visit-schedules/:id/conflict-reconfirmation` to the canonical
    rate-limit route template catalog.
- Validation:
  - The existing full `src/lib/api/rate-limit.test.ts` suite failed before the
    fix and passed after the catalog entry was added.

### `BUG-SECRETS-001`: Secrets Manager fallback warnings logged raw diagnostics

- Severity: medium security/privacy.
- Evidence:
  - `src/lib/config/secrets.ts`
  - `src/lib/config/secrets.test.ts`
  - `src/lib/auth/config.ts`
  - `src/lib/db/client.ts`
- Problem:
  - `getSecrets()` correctly fell back to `process.env` when Secrets Manager
    fetch failed, but passed raw `Error.message` / `String(error)` text and the
    configured secret id into `console.warn`.
  - `bootstrapSecretsIntoEnv()` had the same raw diagnostic logging pattern in
    its catch path.
- Impact:
  - AWS/provider, configured secret id or ARN, token-like, tenant, or PHI-like
    diagnostic text could be written to startup/runtime logs even though
    secret values themselves were never intentionally logged.
- Fix:
  - Replaced raw fallback warning arguments with fixed message plus
    event/operation metadata and a generic safe `error_name`.
  - Preserved Secrets Manager fetch attempt, fallback-to-env behavior,
    process.env precedence, cache behavior, and no-throw startup guardrails.
- Validation:
  - Initial focused regression failed before the fix because raw provider,
    secret-id, token-like, and PHI-like sentinels were present in the captured
    `console.warn` call.
  - Focused and full secrets config test suites passed after the fix.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

### `BUG-PHOS-LAMBDA-001`: PHOS Lambda observability failures logged raw diagnostics

- Severity: medium security/privacy.
- Evidence:
  - `src/phos/backend/lambda-handler.ts`
  - `src/phos/backend/lambda-handler.test.ts`
  - `src/phos/backend/lambda-observability.ts`
  - `src/phos/backend/lambda-observability.test.ts`
- Problem:
  - `flushObservability()` preserved best-effort request handling when
    observability flush failed, but copied the raw caught `Error.message` into
    the `observability_flush_failed` console JSON.
  - `createLambdaObservabilitySink().recordSecurityEvent()` handled DynamoDB
    security-event persistence failures asynchronously, but copied the raw
    caught `Error.message` into the
    `phos_security_event_persist_failed` console JSON.
- Impact:
  - Provider/runtime, token-like, infrastructure, tenant, or PHI-like
    diagnostic text could be written to Lambda logs alongside route,
    request/correlation, and hashed principal context.
- Fix:
  - Replaced raw error-message fields with a safe `error_name` helper in both
    PHOS Lambda failure-log paths.
  - Preserved best-effort observability semantics, request/response behavior,
    security-event persistence attempt semantics, and existing hashed
    tenant/user fields.
- Validation:
  - Initial focused regressions failed before the fix because the tests expected
    the new `error_name` contract and proved the previous raw-message contract.
  - Focused PHOS Lambda safe-log regressions and full PHOS Lambda
    handler/observability test files passed after the fix.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

### `BUG-PHOS-EVIDENCE-001`: PHOS evidence cleanup fallback logs exposed raw principal IDs

- Severity: medium security/privacy.
- Evidence:
  - `src/phos/backend/evidence-upload-verification.ts`
  - `src/phos/backend/evidence-upload-verification.test.ts`
  - `src/phos/backend/structured-logger.ts`
  - `src/phos/backend/observability.ts`
- Problem:
  - `reportCleanupFailure()` used a callback-oriented
    `EvidenceCleanupFailure` payload directly in its default fallback
    `console.error` JSON.
  - That payload contained raw `tenant_id` and `user_id` values, unlike the
    surrounding PHOS metrics, trace, security-event, and structured-log
    contracts that emit hash-only principal identifiers.
- Impact:
  - Tenant/user identifiers could be copied to Lambda logs when mismatched S3
    evidence object cleanup failed, or when a custom cleanup failure reporter
    threw while reporting the same failure.
- Fix:
  - Kept the custom `on_cleanup_failure` callback payload unchanged.
  - Added a default log-shaping helper that emits `tenant_id_hash` and
    `user_id_hash`, plus request/correlation ids, mismatch reason, and safe
    cleanup error kind.
  - Reused that helper for cleanup reporter failure logs.
- Validation:
  - Initial focused regression failed before the fix because fallback logs
    lacked `tenant_id_hash` / `user_id_hash` and still exposed raw IDs.
  - Focused regression and full evidence verifier plus structured logger tests
    passed after the fix.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

### `BUG-AUTH-SECURITY-EVENT-001`: Security-event audit failures logged raw path and error objects

- Severity: medium security/privacy.
- Evidence:
  - `src/lib/auth/security-events.ts`
  - `src/lib/auth/security-events.test.ts`
  - `src/lib/utils/logger.ts`
  - `src/lib/auth/context.ts`
  - `src/lib/db/rls.ts`
- Problem:
  - `logSecurityEvent()` correctly kept AuditLog persistence
    fire-and-forget, but its catch path called legacy
    `console.error('[security-event] Failed to log:', event.event_type, event.path, err)`.
  - `event.path` can contain patient/resource IDs or query parameters, and the
    caught database/provider error object can contain free-text PHI-like,
    token-like, or infrastructure diagnostics.
- Impact:
  - Audit persistence failures could write raw request paths and raw exception
    details to runtime logs while handling auth/RLS/security events.
- Fix:
  - Replaced the legacy multi-argument `console.error` with the shared safe
    `logger.warn` object overload.
  - Preserved fire-and-forget behavior, deduplication, AuditLog persistence
    payload shape, and non-propagation of persistence failures.
- Validation:
  - Initial focused regression failed before the fix because the fallback log
    was not JSON safe-log output and still followed the raw console contract.
  - Focused regression and related security-events/logger/auth/RLS tests passed
    after the fix.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

### `BUG-ME-PROFILE-001`: Profile MFA fallback warning logged raw Cognito diagnostics

- Severity: medium security/privacy.
- Evidence:
  - `src/app/api/me/profile/route.ts`
  - `src/app/api/me/profile/route.test.ts`
  - `src/server/services/cognito-auth.ts`
  - `src/lib/utils/logger.ts`
- Problem:
  - `/api/me/profile` intentionally keeps profile GET successful when optional
    Cognito MFA state lookup fails, but the unexpected failure branch called
    `console.warn('Failed to resolve Cognito MFA state', error)`.
  - Raw Cognito/provider errors can contain user context, token-like values, or
    PHI-like diagnostic text.
- Impact:
  - Profile reads with an access token could write raw provider exception text
    to runtime logs while still returning a successful profile response.
- Fix:
  - Replaced legacy `console.warn` with the shared safe `logger.warn` object
    overload and fixed route/method/operation metadata.
  - Preserved the successful profile response and `mfaEnabled: false` fallback
    for non-configuration MFA lookup failures.
- Validation:
  - Initial focused regression failed before the fix because the route called
    legacy `console.warn` with the raw error object.
  - Focused regression and full profile route plus logger tests passed after
    the fix.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

### `BUG-MY-DAY-TASK-TRIAGE-001`: My Day / Tasks triage and admin status-change surface had overfetch, false-error, UTC day, stale PHI-link, and urgent KPI gaps

- Severity: medium privacy/performance/clinical-triage.
- Evidence:
  - `src/app/(dashboard)/my-day/my-day-content.tsx`
  - `src/app/(dashboard)/my-day/my-day-content.test.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.tsx`
  - `src/app/(dashboard)/tasks/tasks-content.test.tsx`
  - `src/app/api/tasks/route.ts`
  - `src/app/api/audit-logs/route.ts`
  - `src/lib/api/audit-log-filters.ts`
  - `src/lib/patient/navigation.ts`
- Problem:
  - My Day fetched assigned tasks without `status=open` and only later
    filtered to pending/in_progress.
  - The Tasks immediate KPI counted `high` but not `urgent`.
  - My Day sent a bare `YYYY-MM-DD` audit-log `date_from`, which the backend
    parser treats as UTC midnight.
  - My Day queried admin-only audit logs for non-admin roles, creating a
    false-error card and avoidable forbidden requests.
  - The status-change card expected intentionally omitted `changes.patient_name`.
  - The initial client gate needed render/query-key hardening so stale admin
    React Query cache could not render for non-admin users.
  - Status-change patient links used raw path interpolation.
- Impact:
  - My Day could overfetch up to cursor caps and hide open assigned tasks after
    truncation.
  - Urgent tasks could be invisible in the immediate summary KPI.
  - Admin morning status changes before 09:00 JST could be omitted from My Day.
  - Non-admin users could see a false audit-log error, and stale admin cache
    could have exposed patient IDs/status transitions client-side.
  - Audit-log PHI minimization left an empty title in the UI.
  - Hostile or malformed target ids could affect patient-link navigation.
- Fix:
  - Added `status=open` to the My Day task request.
  - Used `japanDateKey()` and URLSearchParams-encoded JST midnight for
    status-change audit reads.
  - Gated status-change fetch, query key, data derivation, and render branches
    with `canAdmin`.
  - Rendered non-PHI generic status-change copy and kept patient names out of
    AuditLog changes.
  - Routed patient links through `buildPatientHref()`.
  - Counted urgent and high priorities together as `緊急・高優先度`.
- Validation:
  - Focused My Day + Tasks suite passed `2` files / `23` tests.
  - Related task/audit route tests passed `2` files / `57` tests.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, build, and full test suite passed.
  - Full test suite: `1266` files passed / `1` skipped; `12592` tests passed /
    `2` skipped.

## Flagged / Not Yet Fixed

No additional unresolved behavior-changing bug is confirmed after the latest
`/api/me/profile` MFA safe-failure-log slice. Potential domain behavior changes
must stay in findings until route/service tests and product intent prove the
issue is a bug rather than a specification choice.
