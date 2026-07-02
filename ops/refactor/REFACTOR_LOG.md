# Refactor Log

Snapshot: 2026-07-02 05:05 JST

This log is the compact resume log for `ops/refactor`. Detailed per-slice
evidence also exists in root `REFACTOR_REPORT.md`,
`REFACTOR_EXECUTION_PLAN.md`, `CODEX_GOAL_PROGRESS.md`, and
`.codex/ralph-state.md`.

## 2026-07-02 14:31 JST - Medication Profile Unresolved-Code Continuity

- Change ID:
  `RR-BUG-20260702-F09-medication-profile-unresolved-code-name-fallback`.
- Category: bug fix / backend medication identity / prescription intake
  continuity.
- Files changed:
  - `src/server/services/prescription-intake-service.ts`
  - `src/server/services/prescription-intake-service.test.ts`
- Summary:
  - Added a `name:` fallback key for incoming prescription lines only when a
    non-empty drug code does not resolve to DrugMaster.
  - Preserved code/master-first behavior for resolved DrugMaster identities, so
    same-name matching cannot keep a master-linked profile current.
  - Added a regression proving an unresolved same-name profile is updated, not
    discontinued plus recreated, and that no unresolved code is persisted as
    `drug_master_id`.
  - Flattened the DrugMaster lookup OR shape for source-code-only queries while
    preserving grouped OR behavior when explicit master IDs are queried
    together with source codes.
- Safety:
  - Prevents false medication discontinuation/recreation, reset start dates, and
    noisy medication-list history when local DrugMaster lacks an incoming code.
  - No auth, RLS, API permission, DB schema, migration, external send, billing,
    production config, dependency, push/deploy, or destructive-operation
    behavior changed.
- Performance:
  - No performance optimization is claimed.
  - The fallback adds one bounded in-memory key over already-loaded intake and
    profile rows.
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
  - gbrain write/readback:
    `projects/careviax/failures/2026-07-02/medication-profile-unresolved-code-dead-key`.
- Commit:
  - `0a070fbc` (`fix(prescriptions): preserve unresolved medication profile
continuity`).

## 2026-07-02 13:21 JST - Visit Record Schedule Error Fail-Closed

- Change ID: `RR-FE-20260702-F11-visit-record-schedule-error-fail-closed`.
- Category: bug fix / medical-safety frontend false-safe prevention / CDS
  visibility.
- Files changed:
  - `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`
  - `src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`
- Summary:
  - Schedule query failure or missing schedule data now returns a page-level
    `ErrorState` with assertive live region and retry before the form renders.
  - The failure state hides the visit record form, save action,
    medication-management section, CDS card/no-alert path, and carry-item
    acknowledgement UI.
  - Visit-preparation context is not fetched until `schedule.id` is known.
  - Loaded-schedule/CDS-fetch failure remains visible by passing
    `isUnavailable` into `CdsAlertPanel`.
- Safety:
  - Prevents missing schedule identity from silently suppressing CDS safety
    alerts and carry-item partial/blocked warnings during visit recording.
  - No API, DB, auth/RLS, route contract, migration, external send, billing,
    production config, dependency, push/deploy, or destructive-operation
    behavior changed.
- Validation:
  - Focused visit form / CDS / ErrorState / visit-record API backstop bundle
    passed `4` files / `102` tests.
  - Scoped ESLint and Prettier passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm build`, and `pnpm format:check` passed.
  - Frontend, medical-safety, test-architect, and strict reviewers reported no
    blockers after requested test/query gating improvements were added.

## 2026-07-02 13:08 JST - Patient Share Management Plan Error State

- Change ID:
  `RR-FE-20260702-F05-F10-F12-patient-share-management-plan-error-state`.
- Category: bug fix / medical-safety frontend false-empty prevention /
  stale payload prevention.
- Files changed:
  - `src/app/(dashboard)/patients/[id]/card-workspace.tsx`
  - `src/app/(dashboard)/patients/[id]/card-workspace.test.tsx`
- Summary:
  - Split management-plan loading/error/true-empty states in the patient-share
    case creation panel.
  - Fetch/refetch failures now disable the selector, show fixed retryable
    `role="alert"` copy, and call `managementPlansQuery.refetch()`.
  - True empty success remains `承認済み計画なし` without alert/retry.
  - Error state suppresses stale retained plan options and forces the
    submit-time selected plan to `null`, preventing stale
    `shared_management_plan_id/version` from entering the payload after a
    TanStack Query refetch error.
  - Existing success path still keeps plan titles and patient PHI out of the
    option text and POST body.
- Safety:
  - Prevents management-plan lookup failure from being mistaken for an approved
    plan empty state while preserving optional plan attachment.
  - No API, DB, auth/RLS, route contract, org header, mutation endpoint,
    migration, external send, billing, production config, dependency,
    push/deploy, or destructive-operation behavior changed.
- Validation:
  - Card-workspace suite passed `1` file / `62` tests.
  - Related patient UI bundle passed `4` files / `87` tests.
  - Scoped ESLint and Prettier passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - `pnpm format:check` failed only on unrelated existing `ops/refactor/*.mjs`
    formatting issues; scoped Prettier passed for touched files.
  - Strict reviewer found stale retained query data could still enter payload;
    the blocker was fixed and re-reviewed with no blockers.

## 2026-07-02 11:29 JST - Drug Master Formulary Error And Clipboard Failure States

- Change ID: `RR-FE-20260702-C-drug-master-formulary-error-and-clipboard-states`.
- Category: bug fix / medical-safety frontend false-empty prevention /
  fail-closed clipboard handling.
- Files changed:
  - `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
  - `src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx`
- Summary:
  - Added retryable `ErrorState` branches for drug-master formulary
    review-due, missing-reorder, impact, usage-mismatch, pending-request,
    generic recommendation, ingredient-group, and stock-config query failures.
  - Disabled `レビュー済み` when review-due fetch is failing, including the
    stale-data case where query data still contains review rows.
  - Prevented stock-config fetch failure from rendering `未登録`,
    `採用品に登録`, `変更申請`, preferred-generic save, follow-up, or reorder
    actions that depend on trustworthy stock state.
  - Wrapped CSV preview candidate YJ clipboard copy in a helper so success is
    shown only after `writeText` resolves and failures show fixed
    `クリップボードにコピーできませんでした` without raw browser diagnostics.
- Safety:
  - Reduces high-risk false-empty / false-safe UI paths in formulary operations
    and drug detail adoption workflows.
  - No API, DB, auth/RLS, route contract, org-header, mutation payload shape,
    migration, external-send, billing, production config, dependency,
    push/deploy, or destructive-operation behavior changed.
- Validation:
  - Focused reviewed regressions passed `1` file / `10` selected tests.
  - Full drug-master content component suite passed `1` file / `77` tests.
  - Scoped ESLint/Prettier/diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.

## 2026-07-02 05:05 JST - Shared Import Safe Error Log Fix

- Change ID: `RR-BUG-20260702-0505-shared-import-safe-error-log`.
- Category: bug fix / persisted import diagnostics privacy / drug-master import
  hardening.
- Files changed:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
- Summary:
  - Replaced raw caught importer exception text persisted by `withImportLog()`
    in `drugMasterImportLog.error_log` with fixed
    `医薬品マスタ取込に失敗しました`.
  - Preserved original importer exception propagation for normal failed-log
    updates.
  - Added safe structured warning metadata when recording the failed import log
    also fails, and still rethrows the original importer error.
  - Preserved MHLW/PMDA/HOT/manual import success logging, source URL/hash
    metadata, import route/status/log API contracts, DB schema, auth/RLS,
    external sends, production config, and destructive-operation boundaries.
- Validation:
  - The new focused regression failed before the fix because persisted
    `error_log` contained secret-like / PHI-like importer failure text.
  - Focused shared import plus logger tests passed `2` files / `33` tests.
  - Shared/MHLW/PMDA/HOT/manual service plus logger tests passed `6` files /
    `83` tests.
  - Import log/status and MHLW/PMDA/HOT/manual route tests passed `7` files /
    `94` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain FailurePattern write/readback passed.
  - Browser smoke was skipped because this service diagnostics fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.

## 2026-07-02 04:50 JST - SSK Import Safe Error Log Fix

- Change ID: `RR-BUG-20260702-0448-ssk-import-safe-error-log`.
- Category: bug fix / persisted import diagnostics privacy / drug-master import
  hardening.
- Files changed:
  - `src/server/services/drug-master-import/ssk.ts`
  - `src/server/services/drug-master-import/ssk.test.ts`
- Summary:
  - Replaced raw caught SSK import/upsert exception text persisted in
    `drugMasterImportLog.error_log` with fixed `SSK取込に失敗しました`.
  - Preserved the running import log, failed status update, original exception
    rethrow, source ZIP handling, upsert behavior, route behavior, and job
    wrapper behavior.
- Validation:
  - The new regression failed before the fix because persisted `error_log`
    contained secret-like / PHI-like exception text.
  - Focused safe-log regression passed.
  - Full SSK import test file passed `1` file / `9` tests.
  - SSK import route plus drug-master job tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - gbrain FailurePattern write/readback passed.
  - Browser smoke was skipped because this service diagnostics fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.

## 2026-07-02 04:36 JST - File Storage Safe Cleanup Errors Fix

- Change ID: `RR-BUG-20260702-0436-file-storage-safe-cleanup-errors`.
- Category: bug fix / operational result privacy / file retention cleanup
  hardening.
- Files changed:
  - `src/server/services/file-storage.ts`
  - `src/server/services/file-storage.test.ts`
- Summary:
  - Replaced raw deletion exception text returned by
    `cleanupExpiredGeneratedFiles().errors[]` with fixed
    `保持期限切れファイルの削除に失敗しました`.
  - Preserved failure counts, processed/scanned counts, pagination, deletion
    attempts, and the existing safe structured partial-failure warning.
- Validation:
  - The strengthened regression failed before the fix because returned
    `errors[]` contained secret-like / PHI-like exception text.
  - Focused safe-cleanup regression passed.
  - Full file-storage test file passed `1` file / `72` tests.
  - File-storage plus related PDF bulk-export service/route tests passed `3`
    files / `101` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed files passed.
  - Full typecheck, no-unused, lint, format check, and diff check passed.
  - gbrain FailurePattern write/readback passed.
  - Browser smoke was skipped because this server service diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.

## 2026-07-02 04:29 JST - Visit Planner Safe Evaluation Diagnostics Fix

- Change ID: `RR-BUG-20260702-0429-visit-planner-safe-evaluation-diagnostics`.
- Category: bug fix / planner diagnostics privacy / schedule hardening.
- Files changed:
  - `src/server/services/visit-schedule-planner.ts`
  - `src/server/services/visit-schedule-planner.test.ts`
- Summary:
  - Replaced raw upstream exception text in candidate `evaluation_error`
    diagnostics with fixed `評価中にエラーが発生しました`.
  - Preserved rejected candidate classification, `reason_code`,
    `reason_label`, travel-limit distinction, candidate evaluation continuity,
    and proposal generation behavior.
- Validation:
  - The strengthened regression failed before the fix because
    `diagnostics.rejected[].detail` contained secret-like / PHI-like exception
    text.
  - Focused safe-diagnostic regression passed.
  - Full planner test file passed `1` file / `45` tests.
  - Planner plus visit-schedule-proposals route tests passed `3` files / `209`
    tests.
  - Scoped ESLint, Prettier, and diff-check for the changed files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this service diagnostics fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.

## 2026-07-02 04:17 JST - Offline Sync Safe Diagnostics Fix

- Change ID: `RR-BUG-20260702-0417-offline-sync-safe-diagnostics`.
- Category: bug fix / client diagnostics privacy / offline sync hardening.
- Files changed:
  - `src/lib/stores/sync-engine.ts`
  - `src/lib/stores/sync-engine.test.ts`
- Summary:
  - Replaced raw unexpected sync exception persistence with fixed
    `同期に失敗しました` `lastError` text.
  - Replaced automatic online-sync raw error-object warnings with the same fixed
    safe message.
  - Preserved existing malformed payload, HTTP status, conflict, retry, queue
    single-flight, and conflict-resolution behavior.
- Validation:
  - The new regressions failed before the fix because persisted `lastError` and
    `console.warn` contained secret-like / PHI-like text.
  - Focused safe-diagnostic regressions passed.
  - Full sync-engine test file passed `1` file / `18` tests.
  - Related offline sync shared/offline-store tests passed `2` files / `15`
    tests.
  - Scoped ESLint, Prettier, and diff-check for the changed files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this client utility diagnostics fix changes
    no visible DOM layout, copy, navigation, route contract shape, or interaction
    state.

## 2026-07-02 04:05 JST - Realtime Listener Safe Diagnostics Fix

- Change ID: `RR-BUG-20260702-0405-realtime-listener-safe-diagnostics`.
- Category: bug fix / client diagnostics privacy / realtime hardening.
- Files changed:
  - `src/lib/realtime/shared-event-stream.ts`
  - `src/lib/realtime/shared-event-stream.test.ts`
- Summary:
  - Replaced raw event/status listener failure logging with the fixed
    diagnostic `Realtime listener failed` and a safe error kind.
  - Preserved shared SSE stream continuity, listener isolation, URL
    construction, presence target serialization, and reconnect behavior.
- Validation:
  - The new regression failed before the fix because `console.error` contained
    secret-like / PHI-like listener failure text.
  - Focused safe-diagnostic regression passed.
  - Full shared realtime stream test file passed `1` file / `4` tests.
  - Shared stream plus related realtime hook tests passed `3` files / `14`
    tests.
  - Scoped ESLint, Prettier, and diff-check for the changed helper/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this shared client utility diagnostics
    fix changes no visible DOM layout, copy, navigation, route contract shape,
    or interaction state.

## 2026-07-02 03:56 JST - CloudWatch Safe Metric Failure Log Fix

- Change ID: `RR-BUG-20260702-0356-cloudwatch-safe-metric-log`.
- Category: bug fix / operational diagnostics privacy / metrics hardening.
- Files changed:
  - `src/lib/aws/cloudwatch.ts`
  - `src/lib/aws/cloudwatch.test.ts`
- Summary:
  - Replaced raw CloudWatch send failure message logging with the fixed
    diagnostic `CloudWatch metric emission failed`.
  - Preserved best-effort metric emission: `putMetrics()` still swallows
    CloudWatch send failures so metrics cannot break request paths.
- Validation:
  - The new regression failed before the fix because `console.error` contained
    secret-like provider failure text.
  - Focused safe-log regression passed.
  - Full CloudWatch helper test file passed `1` file / `3` tests.
  - CloudWatch helper plus jobs/admin flush-metrics route tests passed `3`
    files / `8` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed helper/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend utility diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.

## 2026-07-02 03:45 JST - Job Runner Safe Failure Diagnostics Fix

- Change ID: `RR-BUG-20260702-0345-job-runner-safe-failure-diagnostics`.
- Category: bug fix / operational diagnostics privacy / job runner hardening.
- Files changed:
  - `src/server/jobs/runner.ts`
  - `src/server/jobs/runner.test.ts`
- Summary:
  - Replaced raw caught job failure messages in retry and final
    `integrationJob.error_log` writes with the fixed diagnostic
    `Job execution failed`.
  - Replaced raw failure text in admin job-failure notifications with a fixed
    Japanese execution-failure message.
  - Replaced cleanup-failure console output with fixed diagnostics while
    preserving original error propagation to callers.
- Validation:
  - The new regressions failed before the fix because runner update payloads
    and cleanup logs contained secret-like / PHI-like sentinels.
  - Focused safe-diagnostic regressions passed.
  - Full runner test file passed `1` file / `7` tests.
  - Runner plus jobs API route tests passed `3` files / `38` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed runner/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend runner diagnostics fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.

## 2026-07-02 03:26 JST - Outbound Webhook Safe Result Fix

- Change ID: `RR-BUG-20260702-0326-outbound-webhook-safe-results`.
- Category: bug fix / operational diagnostics privacy / webhook hardening.
- Files changed:
  - `src/server/services/outbound-webhook.ts`
  - `src/server/services/outbound-webhook.test.ts`
- Summary:
  - Returned redacted display URLs in outbound webhook delivery results while
    still dispatching to the registered raw URL.
  - Replaced raw dispatch exception messages in delivery results and persisted
    delivery errors with the fixed safe message `Webhook delivery failed`.
  - Preserved unsafe-destination blocking, redirect non-following, encrypted
    webhook secret signing, first-attempt concurrency, retry claiming, and
    blocked malformed persisted payload behavior.
- Validation:
  - The new regressions failed before the fix because result URLs included query
    secrets and fetch failures returned raw exception text.
  - Focused safe-result regressions passed.
  - Full outbound-webhook test file passed `1` file / `21` tests.
  - Outbound-webhook plus job route tests passed `2` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend service result-safety fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.

## 2026-07-02 03:18 JST - Health-Check DB/S3 Safe Error Fix

- Change ID: `RR-BUG-20260702-0318-health-check-db-s3-safe-errors`.
- Category: bug fix / operational diagnostics privacy / health-check hardening.
- Files changed:
  - `src/server/services/health-check.ts`
  - `src/server/services/health-check.test.ts`
- Summary:
  - Replaced raw DB/S3 health-check failure messages with fixed safe messages.
  - Preserved down status, success behavior, S3 unconfigured skip behavior, S3
    client reuse, and aggregate health behavior.
  - Added regression coverage that result JSON excludes secret-like sentinels.
- Validation:
  - The new regressions failed before the fix because DB and S3 checks returned
    raw failure text.
  - Focused safe-message regression passed.
  - Full health-check test file passed `1` file / `7` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend service response-safety fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.

## 2026-07-02 03:10 JST - Backup Monitor AWS Check Safe Error Fix

- Change ID:
  `RR-BUG-20260702-0310-backup-monitor-aws-check-safe-errors`.
- Category: bug fix / admin diagnostics privacy / backup monitor hardening.
- Files changed:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
- Summary:
  - Replaced raw provider/runtime error messages from backup-monitor
    RDS/S3/audit/Cognito checks with fixed safe result messages.
  - Replaced raw provider error logging in those catch paths with new
    fixed-message `Error` objects.
  - Preserved configured failure `status: 'error'`, aggregate non-ok behavior,
    the dedicated RDS SDK import failure message, and success/warning/skip
    paths.
- Validation:
  - The new regression failed before the fix because RDS returned raw AWS
    failure text.
  - Focused safe-message regression passed.
  - Full backup-monitor test file passed `1` file / `8` tests.
  - Backup-monitor plus health route tests passed `2` files / `13` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend service response-safety fix
    changes no visible DOM layout, copy, navigation, route contract shape, or
    interaction state.

## 2026-07-02 03:00 JST - Health Backup Monitor Raw Error Response Fix

- Change ID: `RR-BUG-20260702-0300-health-backup-raw-error-response`.
- Category: bug fix / admin response privacy / health route hardening.
- Files changed:
  - `src/app/api/health/route.ts`
  - `src/app/api/health/route.test.ts`
- Summary:
  - Replaced raw `runBackupMonitorChecks()` exception message serialization in
    `/api/health` with a fixed safe backup monitor failure message.
  - Preserved public cheap liveness, admin-only detailed checks,
    `status: 'degraded'`, and `checks.backups.status: 'error'`.
  - Added regression coverage that route JSON excludes the raw secret-like
    backup monitor error sentinel.
- Validation:
  - The new regression failed before the fix because the raw backup monitor
    exception message was present in the response.
  - Focused health route raw-error regression passed.
  - Health route plus backup-monitor tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this API response-safety fix changes no
    visible DOM layout, copy, navigation, route contract shape, or interaction
    state.

## 2026-07-02 02:50 JST - Backup Monitor RDS Import Failure Fix

- Change ID:
  `RR-BUG-20260702-0250-backup-monitor-rds-import-false-green`.
- Category: bug fix / backup monitoring correctness / false-green prevention.
- Files changed:
  - `src/server/services/backup-monitor.ts`
  - `src/server/services/backup-monitor.test.ts`
- Summary:
  - Replaced the configured RDS backup-monitor `catch(() => null)` dynamic
    import fallback with a fail-closed fixed safe error.
  - Preserved the local unconfigured `RDS_DB_INSTANCE_ID not configured` skip.
  - Ensured configured RDS SDK load failure produces `status: 'error'` and
    aggregate backup monitor `overall: 'error'`.
  - Added regression coverage that the returned/logged message excludes raw
    token-like import error text and the original import error object.
- Validation:
  - The new regression failed before the fix because configured RDS SDK import
    failure returned `status: 'skipped'`.
  - Focused RDS import failure regression passed.
  - Full backup-monitor test file passed `1` file / `7` tests.
  - Backup-monitor plus health route tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend monitoring semantics fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.

## 2026-07-02 02:37 JST - Drug-Master Import Stream-Cancel Warning Fix

- Change ID: `RR-BUG-20260702-0237-drug-master-import-stream-cancel-warning`.
- Category: bug fix / external input observability / cleanup.
- Files changed:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
- Summary:
  - Replaced silent `reader.cancel().catch(() => undefined)` cleanup handling
    with a shared safe logger warning when external import response stream
    cancellation itself fails.
  - Preserved the caller-visible read error or byte-limit error.
  - Added regression coverage that warning context excludes source URL and raw
    cancel error text.
- Validation:
  - The new regression failed before the fix because `logger.warn` had zero
    calls.
  - Focused stream-cancel warning test passed.
  - Full drug-master import shared test file passed `1` file / `20` tests.
  - Shared import + shared logger tests passed `2` files / `31` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed shared/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this backend cleanup observability fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.

## 2026-07-02 02:26 JST - PH-OS Fee-Rules Rollback Warning Fix

- Change ID: `RR-BUG-20260702-0226-phos-fee-rules-rollback-warning`.
- Category: bug fix / PH-OS backend observability / Aurora transaction cleanup.
- Files changed:
  - `src/phos/backend/aurora-fee-rules-repository.ts`
  - `src/phos/backend/aurora-fee-rules-repository.test.ts`
- Summary:
  - Replaced the silent rollback failure catch in
    `AuroraFeeRulesRepository.searchFeeRules()` with a PH-OS structured
    warning.
  - Preserved original query error propagation and connection release behavior.
  - Added regression coverage that the warning excludes raw rollback error text,
    database URLs, tenant ids, and user ids.
- Validation:
  - The new regression failed before the fix because no structured warning was
    emitted.
  - Focused rollback warning test passed.
  - Full Aurora fee-rules repository test file passed `1` file / `16` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed backend/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this PH-OS backend observability fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.

## 2026-07-02 02:10 JST - Room Token Client Warning Fix

- Change ID: `RR-BUG-20260702-0210-room-token-client-warning`.
- Category: bug fix / collaboration observability / client transient retry.
- Files changed:
  - `src/lib/collaboration/room-token-client.ts`
  - `src/lib/collaboration/room-token-client.test.ts`
- Summary:
  - Replaced silent room-token transient failure classification with throttled
    shared safe logger warnings.
  - Preserved existing result classification: rejected fetches, 429/5xx,
    malformed payloads, and expired payloads still resolve to
    `transient-error`; denied responses still resolve to `access-denied`.
  - Added regression coverage that warning context excludes entity id, patient
    name, and room-token sentinels.
- Validation:
  - The new regressions failed before the fix because `logger.warn` had zero
    calls.
  - Focused room-token client test passed `1` file / `7` tests.
  - Room-token client + collaborative form hook + Yjs provider + shared logger
    tests passed `4` files / `49` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed client/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this client observability fix changes no
    visible DOM layout, copy, navigation, route contract, or interaction state.

## 2026-07-02 01:55 JST - Presence Heartbeat Client Warning Fix

- Change ID: `RR-BUG-20260702-0155-presence-heartbeat-client-warning`.
- Category: bug fix / collaboration observability / client best-effort
  heartbeat.
- Files changed:
  - `src/lib/collaboration/presence-api-client.ts`
  - `src/lib/hooks/use-presence-heartbeat.test.ts`
- Summary:
  - Replaced silent client heartbeat delivery failures with a throttled shared
    safe logger warning.
  - Preserved best-effort behavior: rejected fetches still resolve
    `undefined`, and non-ok responses still resolve the original `Response`.
  - Added regression coverage that warning context excludes entity id, patient
    name, phone, and token sentinels.
- Validation:
  - The new regressions failed before the fix because `logger.warn` had zero
    calls.
  - Focused presence heartbeat test passed `1` file / `6` tests.
  - Presence heartbeat + presence contract + shared logger tests passed `3`
    files / `24` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed client/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this client observability fix changes no
    visible DOM layout, copy, navigation, route contract, or interaction state.

## 2026-07-02 01:38 JST - Visit Proposal Pharmacist Enrichment Warning Fix

- Change ID: `RR-BUG-20260702-0138-visit-proposal-pharmacist-enrichment-warning`.
- Category: bug fix / observability / schedule detail enrichment.
- Files changed:
  - `src/app/api/visit-schedule-proposals/[id]/route.ts`
  - `src/app/api/visit-schedule-proposals/[id]/route.test.ts`
- Summary:
  - Replaced the silent `.catch(() => [])` around proposal pharmacist
    enrichment with a shared safe logger warning.
  - Preserved the existing successful no-store detail response and null
    enrichment fallback when the optional pharmacist lookup fails.
  - Added regression coverage that the warning context excludes raw patient,
    phone, token, and pharmacist-name text.
- Validation:
  - The new regression test failed before the fix because `logger.warn` had
    zero calls.
  - Focused visit schedule proposal detail route test passed `1` file / `75`
    tests after the fix.
  - Route + shared logger tests passed `2` files / `86` tests.
  - Protected GET matrix for visit-schedule-proposals passed `6` tests / `369`
    skipped.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server route observability fix
    changes no visible DOM layout, copy, navigation, route contract, or
    interaction state.

## 2026-07-02 01:23 JST - Patient MCS Failure Observability Fix

- Change ID: `RR-BUG-20260702-0123-patient-mcs-failure-observability`.
- Category: bug fix / privacy / service failure-state observability.
- Files changed:
  - `src/server/services/patient-mcs.ts`
  - `src/server/services/patient-mcs.test.ts`
- Summary:
  - Replaced the silent `.catch(() => undefined)` around failed-state
    `patientMcsLink.upsert` with a shared safe logger warning.
  - Preserved the original `PatientMcsSyncError` throw behavior when recording
    the failed state also fails.
  - Replaced patient-name-bearing MCS identity conflict messages with the
    existing fixed operator-safe conflict text before persistence in
    `last_sync_error`.
  - Added regression coverage for both the secondary persistence failure
    warning and sanitized persisted identity conflict error text.
- Validation:
  - The new warning regression failed before the fix because `logger.warn` had
    zero calls.
  - The new identity-conflict regression failed before the fix because the
    thrown/persisted conflict message contained patient-name text.
  - Focused MCS service test passed `1` file / `23` tests after the fix.
  - Patient MCS service + MCS API route + logger tests passed `4` files / `57`
    tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this service failure-handling/privacy fix
    changes no DOM layout, navigation, or workflow shape.

## 2026-07-02 01:04 JST - External Access Rollback Warning Fix

- Change ID: `RR-BUG-20260702-0104-external-access-rollback-warning`.
- Category: bug fix / security observability / external sharing cleanup.
- Files changed:
  - `src/app/api/external-access/route.ts`
  - `src/app/api/external-access/route.test.ts`
- Summary:
  - Replaced the silent `.catch(() => undefined)` around failed grant
    revocation after fallback audit failure with a shared safe logger warning.
  - Preserved the existing fail-closed no-store `500` response, rollback
    attempt, OTP/JWT response redaction, and external-access creation/audit
    semantics.
  - Added regression coverage that a rollback failure is logged with only safe
    structured metadata and no raw phone contact, token, or OTP-shaped value in
    the response/log context.
- Validation:
  - The new regression test failed before the fix because `logger.warn` had
    zero calls.
  - Focused external-access route test passed `1` file / `35` tests after the
    fix.
  - External-access route + logger tests passed `2` files / `46` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server route observability fix
    changes no visible DOM layout, copy, navigation, or interaction state.

## 2026-07-02 00:49 JST - Presence Realtime Warning Fix

- Change ID: `RR-BUG-20260702-0049-presence-realtime-warning`.
- Category: bug fix / realtime observability / collaboration reliability.
- Files changed:
  - `src/app/api/presence/route.ts`
  - `src/app/api/presence/route.test.ts`
- Summary:
  - Replaced the silent `.catch(() => undefined)` around best-effort presence
    realtime broadcast failures with a shared safe logger warning.
  - Preserved successful heartbeat responses, local presence store updates,
    entity access checks, channel naming, and realtime payload shape.
  - Added regression coverage that a rejected realtime broadcast still returns
    `200` while logging only safe structured metadata.
- Validation:
  - The new regression test failed before the fix because `logger.warn` had
    zero calls.
  - Focused presence route test passed `1` file / `12` tests after the fix.
  - Presence route + logger tests passed `2` files / `23` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server route observability fix
    changes no visible DOM layout, copy, navigation, or interaction state.

## 2026-07-02 00:31 JST - Voice Memo Manual Save Warning Fix

- Change ID: `RR-BUG-20260702-0031-voice-memo-manual-save-warning`.
- Category: bug fix / offline UX / client error-state handling.
- Files changed:
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.tsx`
  - `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.test.tsx`
- Summary:
  - Fixed manual voice-memo transcript local persistence failures that returned
    `false` instead of rejecting.
  - Preserved immediate transcript reflection and the visit-record append
    workflow.
  - Added regression coverage proving a `false` local-save result warns the
    user instead of silently looking fully successful.
- Validation:
  - The new regression test failed before the fix because `toast.warning` had
    zero calls.
  - Focused voice memo content + offline draft tests passed `2` files / `11`
    tests after the fix.
  - Scoped ESLint, Prettier, and diff-check for the changed component/test
    files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this toast-only state fix changes no DOM
    layout, navigation, route contract, or business workflow shape.

## 2026-07-02 00:15 JST - Notification Realtime Warning Fix

- Change ID: `RR-BUG-20260702-0015-notification-realtime-warning`.
- Category: bug fix / error handling / operational observability.
- Files changed:
  - `src/server/services/notifications.ts`
  - `src/server/services/notifications.test.ts`
- Summary:
  - Replaced an empty catch around best-effort realtime notification broadcast
    failures with a shared safe logger warning.
  - Preserved persisted notification creation and return shape; persisted rows
    remain the source of truth.
  - Added regression coverage that a rejected realtime broadcast still returns
    persisted notifications and logs only safe structured metadata in the
    warning context.
- Validation:
  - Focused notification service test passed `1` file / `15` tests.
  - Notification service + logger tests passed `2` files / `26` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed service/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server service error-handling fix
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-02 00:00 JST - Bulk Export Drain Warning Fix

- Change ID: `RR-BUG-20260702-0000-bulk-export-drain-warning`.
- Category: bug fix / error handling / operational observability.
- Files changed:
  - `src/app/api/patients/medications/bulk-export/route.ts`
  - `src/app/api/patients/medications/bulk-export/route.test.ts`
- Summary:
  - Replaced an empty catch on immediate medication-history bulk-export drain
    failures with a shared safe logger warning.
  - Preserved the client-facing `202 Accepted` response, no-store headers,
    queued job semantics, and later job-endpoint recovery path.
  - Added regression coverage that a rejected immediate drain still returns
    `202` and logs only safe structured metadata in the warning context.
- Validation:
  - Focused bulk-export route test passed `1` file / `8` tests.
  - Bulk-export route + logger tests passed `2` files / `19` tests.
  - Scoped ESLint, Prettier, and diff-check for the changed route/test files
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server route error-handling fix
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 23:49 JST - Redis Realtime Subscribe Race Fix

- Change ID: `RR-BUG-20260701-2349-redis-realtime-subscribe-race`.
- Category: bug fix / realtime correctness / state consistency.
- Files changed:
  - `src/server/adapters/realtime/redis-adapter.ts`
  - `src/server/adapters/realtime/redis-adapter.test.ts`
- Summary:
  - Fixed a Redis adapter race where a pending `unsubscribe()` could complete
    after a same-channel resubscribe and leave active listeners without a Redis
    subscription.
  - Added per-channel pending unsubscribe tracking and resubscribe-after-race
    reconciliation.
  - Fixed failed `subscribe()` state rollback so later listeners do not skip the
    real Redis subscribe call after a transient subscribe failure.
  - Added mocked Redis regression tests for both failure modes.
- Validation:
  - Focused Redis adapter tests passed `1` file / `4` tests.
  - Realtime policy + Redis adapter tests passed `2` files / `8` tests.
  - Scoped ESLint and Prettier for the changed adapter/test files passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server adapter fix changes no
    visible DOM layout, copy, or interaction state.

## 2026-07-01 23:32 JST - Dispense-Tasks Strict Query Helper

- Change ID: `RR-QP-20260701-2332-dispense-tasks-strict-query-helper`.
- Category: inconsistency / duplicate helper removal / behavior-preserving query
  validation.
- Files changed:
  - `src/app/api/dispense-tasks/route.ts`
  - `src/app/api/dispense-tasks/route.test.ts`
- Summary:
  - Replaced dispense-tasks route-local
    `readStrictOptionalDispenseTaskFilter` with
    `readStrictOptionalSearchParam`.
  - Removed the now-unneeded `DispenseTaskQueryName` alias.
  - Expanded route coverage for duplicate, blank, padded, and overlong
    `status`, `cycle_id`, and `assigned_to` filter rejection before DB access.
  - Preserved dispense-tasks GET auth, permission checks, assignment scoping,
    cursor pagination, validation response shapes, no-store wrapping, DB query
    shape, unsupported status rejection, and POST behavior.
- Validation:
  - Focused helper + dispense-tasks route tests passed `2` files / `29` tests.
  - Protected GET matrix for dispense-tasks GET passed `3` tests / `372`
    skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server query-validation refactor
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 23:18 JST - Medication-Cycles Strict Query Helper

- Change ID: `RR-QP-20260701-2318-medication-cycles-strict-query-helper`.
- Category: inconsistency / duplicate helper removal / behavior-preserving query
  validation.
- Files changed:
  - `src/app/api/medication-cycles/route.ts`
  - `src/app/api/medication-cycles/route.test.ts`
- Summary:
  - Replaced medication-cycles route-local
    `readStrictOptionalMedicationCycleFilter` with
    `readStrictOptionalSearchParam`.
  - Removed the now-unneeded `MedicationCycleQueryName` alias.
  - Added route coverage for overlong `status` rejection before DB access.
  - Preserved medication-cycles GET auth, assignment scoping, pagination,
    validation response shapes, no-store wrapping, DB query shape, status enum
    rejection, and POST behavior.
- Validation:
  - Focused helper + medication-cycles route tests passed `2` files / `29`
    tests.
  - Protected GET matrix for medication-cycles GET passed `3` tests / `372`
    skipped.
  - Scoped Prettier, ESLint, and diff-check passed after formatting the
    medication-cycles test table.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server query-validation refactor
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 23:07 JST - Residual / First-Visit Strict Query Helper

- Change ID: `RR-QP-20260701-2307-residual-first-visit-strict-query-helper`.
- Category: inconsistency / duplicate helper removal / behavior-preserving query
  validation.
- Files changed:
  - `src/app/api/residual-medications/route.ts`
  - `src/app/api/residual-medications/route.test.ts`
  - `src/app/api/first-visit-documents/route.ts`
- Summary:
  - Replaced residual-medications route-local `readStrictOptionalIdFilter`
    with `readStrictOptionalSearchParam`.
  - Replaced first-visit-documents route-local
    `readOptionalFirstVisitDocumentFilter` with
    `readStrictOptionalSearchParam`.
  - Added residual route coverage for overlong `patient_id` and
    `visit_record_id` rejection before DB access.
  - Preserved residual and first-visit GET auth, assignment/scope checks,
    validation response shapes, no-store wrapping, query shapes, and POST
    behavior.
- Validation:
  - Focused helper + residual + first-visit route tests passed `3` files / `53`
    tests.
  - Protected GET matrix for residual and first-visit GET routes passed `6`
    tests / `369` skipped.
  - Scoped Prettier, ESLint, and diff-check passed after formatting the
    residual test table.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server query-validation refactor
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 22:56 JST - Medication-Issues Strict Query Helper

- Change ID: `RR-QP-20260701-2256-medication-issues-strict-query-helper`.
- Category: inconsistency / duplicate helper removal / behavior-preserving query
  validation.
- Files changed:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/medication-issues/route.ts`
  - `src/app/api/medication-issues/route.test.ts`
- Summary:
  - Replaced medication-issues route-local
    `readStrictOptionalMedicationIssueFilter` with
    `readStrictOptionalSearchParam`.
  - Added route coverage for overlong `patient_id` rejection before scope
    resolution.
  - Preserved medication-issues GET auth, assignment scoping, validation
    response shape, no-store wrapping, DB query shape, status enum rejection,
    and POST behavior.
- Validation:
  - Focused helper + medication-issues route tests passed `2` files / `25`
    tests.
  - Protected GET matrix for `medication-issues GET` passed `3` tests / `372`
    skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server query-validation refactor
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 22:47 JST - Interventions Strict Query Helper

- Change ID: `RR-QP-20260701-2247-interventions-strict-query-helper`.
- Category: inconsistency / duplicate helper removal / behavior-preserving query
  validation.
- Files changed:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/interventions/route.ts`
- Summary:
  - Added shared `readStrictOptionalSearchParam` support for strict optional
    filters that reject duplicates, blank values, padded values, and overlong
    values with field-specific messages.
  - Replaced interventions route-local `readStrictOptionalInterventionFilter`
    with the shared helper.
  - Preserved interventions GET auth, assignment scoping, validation response
    shape, no-store wrapping, DB query shape, and POST behavior.
- Validation:
  - Focused helper + interventions route tests passed `2` files / `20` tests.
  - Protected GET matrix for `interventions GET` passed `3` tests / `372`
    skipped.
  - Scoped Prettier and ESLint checks passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server query-validation refactor
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 22:37 JST - Dashboard Medication-Deadlines Query Helper

- Change ID: `RR-QP-20260701-2237-dashboard-medication-deadlines-query-helper`.
- Category: inconsistency / duplicate helper removal / behavior-preserving
  query validation.
- Files changed:
  - `src/lib/api/search-params.ts`
  - `src/lib/api/search-params.test.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
- Summary:
  - Added shared exact single search-param helpers for duplicate detection and
    non-trimming integer parsing.
  - Replaced dashboard medication-deadlines route-local
    `parseSingleSearchParam` / `parseExactIntegerParam` helpers with the shared
    helper.
  - Preserved the route's existing behavior for missing params, duplicate
    params, blank values, padded integer rejection, range errors, q trimming
    rejection, auth/no-store wrapping, and response shape.
- Validation:
  - Focused helper + medication-deadlines route tests passed `2` files / `24`
    tests.
  - Protected GET matrix for `dashboard/medication-deadlines GET` passed `3`
    tests / `372` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck initially failed on union narrowing in
    `parseMedicationDeadlineQuery`; fixed by storing successful parsed values
    only inside `ok` branches.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed after the fix.
  - Browser smoke was skipped because this server query-validation refactor
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 22:22 JST - Dashboard Routes Logger Convergence

- Change ID: `RR-LOG-20260701-2222-dashboard-routes-logger`.
- Category: inconsistency / security hardening / duplicate code removal / test
  contract sync.
- Files changed:
  - `src/app/api/dashboard/workflow/route.ts`
  - `src/app/api/dashboard/workflow/route.test.ts`
  - `src/app/api/dashboard/workflow/__snapshots__/route.test.ts.snap`
  - `src/app/api/dashboard/cockpit/route.ts`
  - `src/app/api/dashboard/cockpit/route.test.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
  - `src/app/api/dashboard/medication-deadlines/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from dashboard
    workflow, cockpit, and medication-deadlines GET routes.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved dashboard auth, request auth context, query parsing, cache keys,
    RLS/org context, no-store wrapping, `unstable_rethrow`, and response
    shapes.
  - Updated the workflow route snapshot to match the current
    workflow-dashboard section href contract already asserted by
    `src/server/services/workflow-dashboard-sections.test.ts`.
- Validation:
  - Initial focused dashboard/logger suite exposed one stale workflow route
    snapshot; no logger test failed.
  - Workflow route snapshot update passed `1` file / `20` tests.
  - Focused dashboard route/logger tests passed `4` files / `65` tests.
  - Protected GET matrix for dashboard cockpit/workflow/medication-deadlines
    passed `9` tests / `366` skipped.
  - Workflow-dashboard sections service test passed `1` file / `12` tests.
  - Route-local sanitizer grep returned only the canonical shared logger
    implementation.
  - Scoped Prettier passed after excluding `.snap` from the direct parser
    check; `.snap` was covered by Vitest snapshot update and `git diff
--check`.
  - Scoped ESLint and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server logging/test-contract slice
    changes no visible DOM layout, copy, or interaction state.

## 2026-07-01 22:09 JST - Patient Prescriptions Logger Convergence

- Change ID: `RR-LOG-20260701-2209-patient-prescriptions-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/patients/[id]/prescriptions/route.ts`
  - `src/app/api/patients/[id]/prescriptions/route.test.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from patient
    prescriptions GET and e-prescription POST routes.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved patient prescription list auth, patient/case access scope,
    pagination, diff review construction, no-store wrapping, and response
    shape.
  - Preserved e-prescription auth, patient write guard, adapter error handling,
    idempotency behavior, intake creation, no-store wrapping, and response
    shape.
- Validation:
  - Focused route/logger tests passed `3` files / `53` tests.
  - Protected GET matrix for `patients/[id]/prescriptions GET` passed `3`
    tests / `372` skipped.
  - No shared protected POST matrix entry exists for the e-prescription route;
    direct route tests cover auth/input/error/no-store behavior.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server logging slice changes no
    visible DOM layout, copy, or interaction state.

## 2026-07-01 21:59 JST - Visit-Records Logger Convergence

- Change ID: `RR-LOG-20260701-2159-visit-records-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/visit-records/route.ts`
  - `src/app/api/visit-records/route.test.ts`
  - `src/lib/utils/logger.ts`
  - `src/lib/utils/logger.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the visit-records
    GET/POST route.
  - Moved GET/POST unexpected-error logging and patient-state snapshot failure
    logging to the shared object-overload logger contract.
  - Added a backward-compatible shared logger warn object+raw-error overload so
    background handoff extraction warnings can delegate safe error-name
    normalization to the shared logger without keeping a route-local helper.
  - Preserved visit-record list/create auth, request auth context, query/body
    validation, RLS request context, transaction behavior, snapshot
    best-effort behavior, handoff extraction dispatch, no-store wrapping, and
    response shape.
- Validation:
  - Focused visit-records route/logger tests passed `2` files / `91` tests.
  - Protected GET matrix passed `6` tests / `369` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server logging slice changes no
    visible DOM layout, copy, or interaction state.

## 2026-07-01 21:44 JST - Visit-Billing-Candidates Summary Logger Convergence

- Change ID: `RR-LOG-20260701-2144-visit-billing-summary-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/visit-billing-candidates/summary/route.ts`
  - `src/app/api/visit-billing-candidates/summary/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the visit billing
    candidates summary GET route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved billing summary auth, request auth context, billing-month
    validation, optional filter validation, RLS request context, count/query
    shapes, no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `18` tests.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, validation failure, no-store behavior, and
    sanitized fixed 500 fallback.
  - Route-local sanitizer grep returned only shared logger contract lines and
    the route-test assertion proving route context has no `error_name`.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server logging slice changes no
    visible DOM layout, copy, or interaction state.

## 2026-07-01 21:34 JST - Care-Reports Logger Convergence

- Change ID: `RR-LOG-20260701-2134-care-reports-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/care-reports/route.ts`
  - `src/app/api/care-reports/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the care-reports
    GET/POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved report auth, request auth context, query/body validation, access
    scope, RLS request context, report source validation, duplicate conflict
    handling, no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `72` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route contexts have no `error_name`.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server logging slice changes no
    visible DOM layout, copy, or interaction state.

## 2026-07-01 21:26 JST - Dispense-Results Logger Convergence

- Change ID: `RR-LOG-20260701-2126-dispense-results-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/dispense-results/route.ts`
  - `src/app/api/dispense-results/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the
    dispense-results POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved dispense-result auth, request auth context, body validation,
    safety checklist enforcement, RLS request context, transaction behavior,
    CDS checks, barcode verification, operational task creation,
    workflow/webhook notifications, no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `50` tests.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Route-local sanitizer grep returned only shared logger contract lines and
    route-test assertions proving route context has no `error_name`.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - Browser smoke was skipped because this server logging slice changes no
    visible DOM layout, copy, or interaction state.

## 2026-07-01 21:12 JST - Dispense-Audits Logger Convergence

- Change ID: `RR-LOG-20260701-2112-dispense-audits-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/dispense-audits/route.ts`
  - `src/app/api/dispense-audits/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the
    dispense-audits GET/POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canAuditDispense` auth, request auth context, assignment
    scoping, queue query shape, mutation transaction behavior, cycle
    transition, notification dispatch, workflow dashboard invalidation,
    no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `37` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:58 JST - Set-Audits Logger Convergence

- Change ID: `RR-LOG-20260701-2058-set-audits-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/set-audits/route.ts`
  - `src/app/api/set-audits/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the set-audits
    GET/POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canAuditSet` auth, request auth context, assignment scoping,
    queue query shape, checklist and carry-packet evidence validation,
    mutation transaction behavior, reject/cell audit state handling, cycle
    transition, workflow dashboard invalidation, no-store wrapping, and
    response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `50` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier passed after formatting the route file; scoped ESLint
    passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:49 JST - Set-Plans Generate-Batches Logger Convergence

- Change ID: `RR-LOG-20260701-2049-set-plans-generate-batches-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/set-plans/[id]/generate-batches/route.ts`
  - `src/app/api/set-plans/[id]/generate-batches/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the set-plans
    generate-batches POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canSet` auth, request auth context, assignment scoping,
    optional body validation, serializable transaction retry behavior,
    existing batch reuse/stale input checks, forced regeneration guards,
    packaging/controlled-handling tag resolution, history logging, workflow
    dashboard invalidation, no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `37` tests.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:40 JST - Set-Plans Detail Logger Convergence

- Change ID: `RR-LOG-20260701-2040-set-plans-detail-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/set-plans/[id]/route.ts`
  - `src/app/api/set-plans/[id]/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the set-plans
    detail GET/PATCH route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canSet` auth, request auth context, assignment scoping, detail
    stale-line calculation, update validation, packaging method/profile summary
    resolution, optimistic update claim, workflow dashboard invalidation,
    no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `27` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected PATCH matrix passed `3` tests / `74` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:32 JST - Set-Plans Collection Logger Convergence

- Change ID: `RR-LOG-20260701-2032-set-plans-collection-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/set-plans/route.ts`
  - `src/app/api/set-plans/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the set-plans
    collection GET/POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canSet` auth, request auth context, assignment scoping, list
    query validation, RLS request context, create body validation,
    idempotent duplicate/race handling, status transition rollback/conflict
    handling, workflow dashboard invalidation, no-store wrapping, and response
    shape.
- Validation:
  - Focused route/logger tests passed `2` files / `33` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:22 JST - Set-Batches Collection Logger Convergence

- Change ID: `RR-LOG-20260701-2022-set-batches-collection-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/set-batches/route.ts`
  - `src/app/api/set-batches/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the set-batches
    collection GET/POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canSet` auth, request auth context, assignment scoping,
    list ordering/include shape, POST body validation, serializable transaction
    retry behavior, set-plan optimistic claim, quantity/duplicate checks,
    packaging tag resolution, history logging, workflow dashboard invalidation,
    no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `30` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:15 JST - Set-Batches Detail Logger Convergence

- Change ID: `RR-LOG-20260701-2015-set-batches-detail-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/set-batches/[id]/route.ts`
  - `src/app/api/set-batches/[id]/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the set-batches
    detail GET/PATCH/DELETE route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canSet` auth, request auth context, assignment scoping, no-store
    wrapping, optimistic locking, immutable status conflicts, set-batch history
    logging, workflow dashboard invalidation, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `25` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected PATCH/DELETE matrix passed `6` tests / `71` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 20:02 JST - Pharmacy Stock Bulk Logger Convergence

- Change ID: `RR-LOG-20260701-2002-pharmacy-stock-bulk-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/pharmacy-drug-stocks/bulk/route.ts`
  - `src/app/api/pharmacy-drug-stocks/bulk/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the pharmacy
    stock bulk POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved admin auth, JSON/CSV parsing and validation, pharmacy site
    lookup, drug-master matching, preferred generic validation, duplicate-row
    handling, dry-run preview, stock upsert/audit behavior, RLS request
    context, no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `28` tests.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - No shared protected POST matrix entry exists for this route; direct route
    tests cover auth failure, malformed/invalid input, no-store behavior,
    dry-run behavior, apply behavior, and sanitized 500 fallback.

## 2026-07-01 19:57 JST - Pharmacy Stock Usage-Mismatch Logger Convergence

- Change ID: `RR-LOG-20260701-1957-pharmacy-stock-usage-mismatch-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts`
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the pharmacy
    stock usage-mismatch GET route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved admin auth, query validation, pharmacy site lookup, QR draft and
    stock reads, drug identity resolution, mismatch aggregation, RLS request
    context, no-store wrapping, and response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `23` tests.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, query validation, no-store behavior, and
    sanitized 500 fallback.

## 2026-07-01 19:48 JST - Medication-Cycle History Logger Convergence

- Change ID: `RR-LOG-20260701-1948-medication-cycle-history-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/medication-cycles/[id]/history/route.ts`
  - `src/app/api/medication-cycles/[id]/history/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the medication
    cycle history GET route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved auth audit path templating, `canViewDashboard` auth, request auth
    context, ID normalization, org/case assignment scope, transition log query,
    actor-name hydration, route performance wrapping, no-store wrapping, and
    response shape.
- Validation:
  - Focused route/logger tests passed `2` files / `16` tests.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - No shared protected GET matrix entry exists for this route; direct route
    tests cover auth failure, no-store behavior, blank ID rejection, not-found,
    and sanitized 500 fallback.

## 2026-07-01 19:41 JST - CDS Check Logger Convergence

- Change ID: `RR-LOG-20260701-1941-cds-check-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/cds/check/route.ts`
  - `src/app/api/cds/check/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the CDS check
    POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canVisit` auth, request auth context, JSON body validation,
    medication-cycle org ownership lookup, patient scope derivation, CDS checker
    invocation, route performance wrapping, no-store wrapping, and response
    shape.
- Validation:
  - Focused route/logger tests passed `2` files / `14` tests.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 19:28 JST - Tracing Reports Detail Logger Convergence

- Change ID: `RR-LOG-20260701-1928-tracing-reports-detail-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/tracing-reports/[id]/route.ts`
  - `src/app/api/tracing-reports/[id]/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the
    tracing-reports detail PATCH/DELETE route.
  - Moved lifecycle unexpected-error logging to the shared object-overload
    logger contract.
  - Preserved report auth, ID normalization, access filtering, optimistic
    update/delete claims, communication request/event side effects, audit
    writes, no-store wrapping, and response DTOs.
- Validation:
  - Focused route/logger tests passed `2` files / `34` tests.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.
  - The shared protected PATCH/DELETE matrix does not currently register this
    detail route; direct route tests now cover PATCH and DELETE auth failures,
    no-store behavior, sanitized 500 fallback, and no side effects before
    failing operations.

## 2026-07-01 19:19 JST - Tracing Reports Collection Logger Convergence

- Change ID: `RR-LOG-20260701-1919-tracing-reports-collection-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/tracing-reports/route.ts`
  - `src/app/api/tracing-reports/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the
    tracing-reports collection GET/POST route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved report auth, access filtering, no-store wrapping, pagination,
    patient-name hydration, request body validation, medication issue
    attachment checks, RLS request context, and response DTOs.
- Validation:
  - Focused route/logger tests passed `2` files / `27` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Protected POST matrix passed `3` tests / `142` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 19:12 JST - Staff Workload Logger Convergence

- Change ID: `RR-LOG-20260701-1912-staff-workload-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/staff-workload/route.ts`
  - `src/app/api/staff-workload/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from the
    staff-workload GET route.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canVisit` auth, date validation, RLS request context, raw SQL
    task preview query, role labels, sorting, and response DTOs.
- Validation:
  - Focused route/logger tests passed `2` files / `18` tests.
  - Protected GET matrix passed `3` tests / `372` skipped.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 19:02 JST - Billing Evidence Logger Convergence

- Change ID: `RR-LOG-20260701-1902-billing-evidence-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/billing-evidence/analytics/route.ts`
  - `src/app/api/billing-evidence/analytics/route.test.ts`
  - `src/app/api/billing-evidence/stats/route.ts`
  - `src/app/api/billing-evidence/stats/route.test.ts`
  - `src/app/api/billing-evidence/check/route.ts`
  - `src/app/api/billing-evidence/check/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication from billing-evidence
    analytics, stats, and check GET routes.
  - Moved unexpected-error logging to the shared object-overload logger
    contract.
  - Preserved `canReport` auth, no-store wrapping, billing month calculations,
    query shapes, RLS `withOrgContext` timeout use, patient href encoding, and
    response DTOs.
- Validation:
  - Focused route/logger tests passed `4` files / `24` tests.
  - Scoped Prettier, ESLint, and diff-check passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-01 18:51 JST - Ops Refactor Artifact Sync

- Change ID: `RR-DOC-20260701-1851-ops-refactor-artifacts`.
- Category: state artifact / documentation.
- Purpose:
  - Create the objective-required `ops/refactor` state, map, findings, plan,
    log, and verification files.
  - Make the current loop resumable from repository files instead of relying on
    conversation state.
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
- Behavior:
  - Documentation/state only. No runtime code path changed.
- Validation:
  - `ops/refactor` markdown Prettier passed.
  - Changed-file format check passed.
  - Scoped diff-check for updated state/progress files passed.

## 2026-07-01 18:47 JST - Comments Logger Convergence

- Change ID: `RR-LOG-20260701-1847-comments-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/comments/route.ts`
  - `src/app/api/comments/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication.
  - Moved GET/POST unexpected-error logging to the shared object-overload
    logger contract.
  - Preserved comments auth, list/create behavior, mentions, notifications,
    realtime broadcast, no-store wrapping, and fixed internal-error response.
- Validation:
  - Focused route/logger tests passed.
  - Protected GET/POST matrix tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and build passed.

## 2026-07-01 18:40 JST - Communication Request Responses Logger Convergence

- Change ID: `RR-LOG-20260701-1840-communication-responses-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/communication-requests/[id]/responses/route.ts`
  - `src/app/api/communication-requests/[id]/responses/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication.
  - Preserved response listing/create auth, patient/case access checks,
    care-report permission gates, idempotent writes, audit payload redaction,
    no-store wrapping, and fixed internal-error behavior.
- Validation:
  - Focused route/logger tests passed.
  - Protected GET/POST matrix tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and build passed.

## 2026-07-01 18:33 JST - Consent Records Logger Convergence

- Change ID: `RR-LOG-20260701-1833-consent-records-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - `src/app/api/consent-records/route.ts`
  - `src/app/api/consent-records/route.test.ts`
- Summary:
  - Removed route-local error-name sanitizer duplication.
  - Preserved consent list/create auth, patient/case checks, audit fail-closed
    behavior, document URL/file validation, no-store wrapping, and fixed
    internal-error response.
- Validation:
  - Focused route/logger tests passed.
  - Protected GET/POST matrix tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and build passed.

## 2026-07-01 18:27 JST - Drug Master Imports Logger Convergence

- Change ID: `RR-LOG-20260701-1827-drug-master-imports-logger`.
- Category: inconsistency / security hardening / duplicate code removal.
- Files changed:
  - Six `src/app/api/drug-master-imports/**/route.ts` files and their tests.
- Summary:
  - Removed route-local sanitizer duplication across MHLW price/generic, HOT,
    SSK, PMDA, and manual clinical import routes.
- Validation:
  - Focused import route/logger tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and build passed.

## 2026-07-02 05:20 JST - PDF Bulk Export Safe Failure Diagnostics

- Change ID: `RR-BUG-20260702-0520-pdf-bulk-export-safe-error-log`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/server/services/pdf-bulk-export.ts`
  - `src/server/services/pdf-bulk-export.test.ts`
  - `src/app/api/jobs/[jobType]/route.ts`
  - `src/app/api/jobs/[jobType]/route.test.ts`
- Summary:
  - Sanitized terminal medication-history PDF bulk-export failures before
    writing `integrationJob.error_log` or requester failure notifications.
  - Kept actionable `MedicationHistoryBulkExportError` messages for expected
    workflow failures such as invalid input and size-limit failures.
  - Sanitized queue-drain error entries and changed
    `/api/jobs/medication-history-bulk-export-drain` to return `errorCount`
    without raw `errors[]`.
  - Replaced raw `console.error(..., Error)` cleanup and notification logging
    with shared safe `logger.warn` metadata.
- Safety:
  - Original exceptions still propagate for control flow and tests.
  - No DB schema, migration, RLS/auth semantics, external send semantics,
    billing behavior, PHI payload shape, secret handling, push/deploy, or
    destructive operation changed.
- Validation:
  - Red focused regressions failed before the fix for raw PHI/secret/storage
    sentinels reaching persisted job logs, notifications, or drain responses.
  - Focused service/API tests passed.
  - Full typecheck, no-unused, lint, format check, diff check, and production
    build passed.

## 2026-07-02 05:38 JST - Daily Job Safe Error Results

- Change ID: `RR-BUG-20260702-0538-daily-job-safe-errors`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/server/jobs/daily/shared.ts`
  - `src/server/jobs/daily/orchestrator.ts`
  - `src/server/jobs/daily/visits.ts`
  - `src/server/jobs/daily.test.ts`
- Summary:
  - Added a shared fixed daily operation failure message.
  - Sanitized rejected daily subtasks and fulfilled subtask `errors[]` entries
    before returning the aggregate daily job result.
  - Sanitized unexpected visit-demand generation errors while preserving the
    existing workflow-gate operational task path.
- Safety:
  - Job failure counts remain visible through one safe error entry per failed
    subtask/result entry.
  - Original expected workflow-gate handling, daily task ordering, concurrency,
    processed-count aggregation, DB schema/migrations, RLS/auth semantics,
    audit semantics, external sends, billing, production config/secrets,
    push/deploy, and destructive operations remain unchanged.
- Validation:
  - Red focused regressions failed before the fix because raw PHI/secret-like
    sentinels reached returned daily job `errors[]`.
  - Focused safe-error regressions and the full daily job test file passed.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 05:52 JST - Rate Limit Safe Failure Log And Route Catalog Sync

- Change ID: `RR-BUG-20260702-0552-rate-limit-safe-failure-log`.
- Category: bug fix / security hardening / rate-limit correctness.
- Files changed:
  - `src/lib/api/rate-limit.ts`
  - `src/lib/api/rate-limit.test.ts`
- Summary:
  - Replaced raw DynamoDB rate-limit failure `console.error(message, error)`
    calls with safe event/operation/error-name metadata.
  - Preserved production fail-closed behavior and non-production memory fallback
    behavior.
  - Added the live
    `/api/visit-schedules/:id/conflict-reconfirmation` endpoint to the
    rate-limit route template catalog.
- Safety:
  - No auth/authz semantics, proxy response shape, route implementation,
    rate-limit quota values, DB schema/migrations, external sends, billing,
    production config/secrets, push/deploy, or destructive operations changed.
- Validation:
  - Red focused regression failed before the fix because a raw PHI/secret-like
    sentinel remained in the console error call.
  - The full rate-limit suite initially exposed the missing route template and
    passed after the catalog entry was added.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 06:06 JST - Secrets Manager Fallback Safe Log

- Change ID: `RR-BUG-20260702-0606-secrets-safe-fallback-log`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/lib/config/secrets.ts`
  - `src/lib/config/secrets.test.ts`
- Summary:
  - Replaced raw Secrets Manager fallback `console.warn` arguments with fixed
    event/operation/error-name metadata.
  - Removed the configured secret id from fallback warning text.
  - Applied the same safe metadata logger to the
    `bootstrapSecretsIntoEnv()` catch path.
- Safety:
  - `getSecrets()` still consults Secrets Manager when configured and falls
    back to environment values on fetch/parse/provider failures.
  - `process.env` remains authoritative during bootstrap; existing env values
    are not overwritten.
  - No secret values, auth/RLS behavior, DB schema/migrations, external sends,
    billing, production config, push/deploy, or destructive operations changed.
- Validation:
  - Red focused regression failed before the fix because raw provider,
    secret-id, token-like, and PHI-like sentinels remained in the captured
    `console.warn` call.
  - Focused safe-log regression and full secrets config test file passed.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 06:12 JST - PHOS Lambda Observability Safe Log

- Change ID: `RR-BUG-20260702-0612-phos-lambda-safe-observability-log`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/phos/backend/lambda-handler.ts`
  - `src/phos/backend/lambda-handler.test.ts`
  - `src/phos/backend/lambda-observability.ts`
  - `src/phos/backend/lambda-observability.test.ts`
- Summary:
  - Replaced PHOS Lambda observability flush failure raw error messages with
    safe `error_name` metadata.
  - Replaced PHOS security-event persistence failure raw error messages with
    safe `error_name` metadata.
  - Added regression assertions that PHI-like and token-like provider messages
    are not copied into Lambda failure logs.
- Safety:
  - Request handling, timeout behavior, observability flush attempts,
    security-event persistence attempts, correlation fields, hashed tenant/user
    metadata, DB schema/migrations, RLS/auth semantics, external sends, billing,
    production config/secrets, push/deploy, and destructive operations remain
    unchanged.
- Validation:
  - Red focused regressions failed before the fix because the old log contract
    lacked `error_name` and used raw error-message fields.
  - Focused PHOS Lambda safe-log regressions and the full PHOS Lambda
    handler/observability test files passed.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 06:23 JST - PHOS Evidence Cleanup Safe Principal Log

- Change ID: `RR-BUG-20260702-0623-phos-evidence-cleanup-safe-principal-log`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/phos/backend/evidence-upload-verification.ts`
  - `src/phos/backend/evidence-upload-verification.test.ts`
- Summary:
  - Replaced default PHOS S3 evidence cleanup fallback logs' raw
    `tenant_id`/`user_id` fields with hash-only principal fields.
  - Reused the same hash-only log shaping when a custom cleanup failure reporter
    throws.
  - Preserved the custom `on_cleanup_failure` callback payload contract.
- Safety:
  - S3 verification, mismatch detection, cleanup attempts, custom cleanup
    callback behavior, request/correlation fields, safe cleanup error names, DB
    schema/migrations, RLS/auth semantics, external sends, billing, production
    config/secrets, push/deploy, and destructive operations remain unchanged.
- Validation:
  - Red focused regression failed before the fix because fallback logs lacked
    hashed principal fields and still included raw tenant/user identifiers.
  - Focused safe-principal-log regression and evidence verifier plus structured
    logger test files passed.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 06:30 JST - Security Event Audit Failure Safe Log

- Change ID: `RR-BUG-20260702-0630-security-event-safe-failure-log`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/lib/auth/security-events.ts`
  - `src/lib/auth/security-events.test.ts`
- Summary:
  - Replaced security-event AuditLog persistence failure legacy
    `console.error` arguments with shared safe `logger.warn` metadata.
  - Removed raw request path and raw caught error object from the fallback log.
  - Added regression coverage for path/query/error-message PHI/secret sentinels.
- Safety:
  - Fire-and-forget behavior, deduplication, AuditLog create payload, auth/RLS
    caller semantics, request-path non-blocking behavior, DB schema/migrations,
    external sends, billing, production config/secrets, push/deploy, and
    destructive operations remain unchanged.
- Validation:
  - Red focused regression failed before the fix because the old log contract
    was not JSON safe-log output.
  - Focused security-event regression and related security-events/logger/auth/RLS
    tests passed.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 06:37 JST - Me Profile MFA Failure Safe Log

- Change ID: `RR-BUG-20260702-0637-me-profile-mfa-safe-failure-log`.
- Category: bug fix / security hardening / privacy-safe diagnostics.
- Files changed:
  - `src/app/api/me/profile/route.ts`
  - `src/app/api/me/profile/route.test.ts`
- Summary:
  - Replaced `/api/me/profile` Cognito MFA state lookup failure legacy
    `console.warn` with shared safe `logger.warn` metadata.
  - Removed raw Cognito/provider error objects from the optional MFA enrichment
    fallback log.
  - Added regression coverage for PHI-like and token-like MFA provider failure
    text.
- Safety:
  - Successful profile response behavior, `mfaEnabled: false` fallback, Cognito
    not-configured handling, profile update behavior, auth resolution, DB
    schema/migrations, RLS/auth semantics, external sends, billing, production
    config/secrets, push/deploy, and destructive operations remain unchanged.
- Validation:
  - Red focused regression failed before the fix because the old warning
    forwarded a raw error object.
  - Focused profile MFA safe-log regression and profile route plus logger tests
    passed.
  - Scoped ESLint/Prettier/diff-check, full typecheck, no-unused, lint, format
    check, and production build passed.

## 2026-07-02 07:21 JST - Patient Medication Allergy Fetch Failure Surface

- Change ID: `RR-FE-20260702-A-allergy-false-negative`.
- Category: bug fix / medical safety / frontend false-empty prevention.
- Files changed:
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.test.tsx`
- Summary:
  - Added an allergy-section guard for `patientSummaryQuery.isError` when the
    component has no prop-provided `allergyInfo`.
  - The allergy section now renders inline `ErrorState` with retry instead of
    `登録なし` when patient summary allergy data fails to load.
  - Added regression coverage proving the failure path does not show the false
    empty text and that successful fetched `allergy_info` still renders.
  - Preserved API calls, query keys, auth/org headers, success rendering, and
    adjacent medication issue / side-effect behavior.
- Validation:
  - Initial focused regression failed before the fix because
    `アレルギー情報を読み込めませんでした` was absent.
  - Focused patient summary failure/success tests passed after the fix.
  - Full medications content test file passed `1` file / `23` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - Claude checker independently verified the patch and returned `APPROVED`
    before commit.

## 2026-07-02 07:33 JST - Patient Safety Banner Fetch Failure Surface

- Change ID: `RR-FE-20260702-B-safety-banner-silent-loss`.
- Category: bug fix / medical safety / frontend pinned banner failure state.
- Files changed:
  - `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.tsx`
  - `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.test.tsx`
- Summary:
  - Added a `patientQuery.isError` branch in the pinned patient safety banner
    region.
  - The safety-check screen now shows inline `ErrorState` with retry when
    patient allergy/high-risk summary data fails to load.
  - The main safety workflow remains visible when medication issues load
    successfully.
  - Preserved existing `issuesQuery` handling and the documented CDS fail-open
    path.
- Validation:
  - Initial focused regression failed before the fix because the patient safety
    error text was absent.
  - Focused patient summary failure test passed after the fix.
  - Full safety-check component suite passed `1` file / `17` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - Claude checker independently verified the patch and returned `APPROVED`
    before commit.

## 2026-07-02 11:52 JST - Cockpit Rail False-Safe Loading/Error States

- Change ID: `RR-FE-20260702-F14-F27-cockpit-rail-false-safe`.
- Category: bug fix / medical safety / frontend false-empty prevention.
- Files changed:
  - `src/app/(dashboard)/handoff/handoff-workspace.tsx`
  - `src/app/(dashboard)/handoff/handoff-workspace.test.tsx`
  - `src/app/(dashboard)/schedules/schedule-team-board.tsx`
  - `src/app/(dashboard)/schedules/schedule-team-board.test.tsx`
- Summary:
  - Added handoff right-rail loading and retryable error states for cockpit
    loading/error so the UI no longer falls through to healthy no-blocker copy.
  - Added schedule Gantt risk-area and right-rail loading/error states for
    cockpit loading/error.
  - Dropped stale cockpit query data from rail/risk rendering when
    `cockpitQuery.isError` is true.
  - Added regression coverage for both loading and error paths, including stale
    schedule cockpit data on error and retry calls to `cockpitQuery.refetch()`.
- Safety:
  - Prevents false-safe / false-empty UI around narcotic audit risk, next
    actions, blocked reasons, and clerical follow-up counts.
  - Error copy is fixed and PHI-free; no raw API error text is echoed.
  - No API, DB, auth/RLS, route contract, org header, mutation payload,
    migration, external send, billing, production config, dependency,
    push/deploy, or destructive-operation behavior was changed.
- Validation:
  - Focused handoff/schedule component suites passed `2` files / `48` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Codex frontend and medical-safety reviewers found no actionable findings.
  - Codex test architect flagged loading-branch coverage as a low issue; loading
    regressions were added and revalidated before this log entry.

## 2026-07-02 12:06 JST - Schedule Drawer Error Envelope Handling

- Change ID: `RR-FE-20260702-F03-schedule-drawer-error-envelope`.
- Category: bug fix / frontend-backend contract compatibility.
- Files changed:
  - `src/app/(dashboard)/schedules/schedule-create-edit-drawer.tsx`
  - `src/app/(dashboard)/schedules/schedule-create-edit-drawer.test.ts`
- Summary:
  - Replaced the drawer failed-save `body.error`-only reader with a guarded
    standard-envelope parser.
  - Failed save toasts now prefer standard `message`, fall back to legacy
    `error`, then use `予定の保存に失敗しました`.
  - Non-string or missing `message` / `error` fields fail closed to the generic
    fallback and response `details` are never displayed.
  - Added regression coverage for standard envelope, both-field priority,
    legacy compatibility, non-JSON fallback, malformed fields, and missing
    fields.
- Safety:
  - Restores actionable schedule conflict / validation messages without
    changing API route behavior or mutation payloads.
  - Reduces malformed response/raw-detail leakage risk in the user-facing toast.
  - No API, DB, auth/RLS, route contract, org header, migration, external send,
    billing, production config, dependency, push/deploy, or destructive
    operation behavior was changed.
- Validation:
  - Drawer focused suite passed `1` file / `17` tests.
  - Drawer plus visit-schedule-proposals route bundle passed `2` files / `106`
    tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - `pnpm format:check` failed on unrelated untracked
    `ops/refactor/ultracode-crossreview-codex-workflow.mjs`; scoped Prettier for
    the changed drawer files passed.

## 2026-07-02 12:36 JST - Offline Base64 Chunking And Evidence Payload Integrity

- Change ID: `RR-PERF-20260702-F04-offline-base64-chunking`.
- Category: performance fix / duplicate helper consolidation / offline evidence
  integrity.
- Files changed:
  - `src/lib/utils/base64.ts`
  - `src/lib/utils/base64.test.ts`
  - `src/lib/offline/crypto.ts`
  - `src/lib/offline/crypto.test.ts`
  - `src/phos/api/offlineEvidenceQueue.ts`
  - `src/phos/api/offlineEvidenceQueue.test.ts`
  - `src/phos/contracts/phos_contracts.ts`
- Summary:
  - Added shared chunked base64 helpers with bounded `0x8000`
    `String.fromCharCode(...subarray)` calls.
  - Replaced `crypto.ts` per-byte encrypted payload encoding with the shared
    helper.
  - Removed the local PH-OS offline evidence queue base64 duplicate by using
    the same helper for encode/decode.
  - Added local replay integrity validation before external presign/upload:
    decode base64, require decoded length to match `size_bytes`, and require
    SHA-256 to match.
  - Addressed privacy and strict review findings: corrupt ciphertext,
    JSON-valid invalid base64, size mismatch, and SHA mismatch now remain
    visible as pending evidence with `EVIDENCE_PAYLOAD_UNREADABLE`, increment
    retry metadata, and never call presign/upload.
  - Replaced PHI-shaped test fixture strings in touched tests with synthetic
    sentinels.
- Safety:
  - Preserves encrypted payload prefix and AES-GCM storage behavior.
  - Preserves Dexie schema/version, quota limits, replay batch size, retry max,
    idempotency keys, upload URL safety checks, visit-completion server guard,
    auth/RLS, API route contracts, and external-send boundaries.
- Validation:
  - Focused offline/PH-OS bundle passed `6` files / `86` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - `pnpm format:check` failed only on unrelated existing `ops/refactor/*`
    formatting issues; scoped Prettier passed for all changed files.

## 2026-07-02 13:33 JST - DataTable Source Row Index And CSV Export Safety

- Change ID: `RR-FE-20260702-F02-data-table-source-row-index`.
- Category: bug fix / shared frontend component / CSV export safety.
- Files changed:
  - `src/components/ui/data-table.tsx`
  - `src/components/ui/data-table.test.tsx`
- Summary:
  - Fixed desktop DataTable selected-row highlighting and row activation to use
    TanStack `row.index` instead of the rendered sorted/filtered map index.
  - Kept zebra striping on the rendered map index.
  - Added regressions for both sorted and filtered desktop row models covering
    pointer activation, Enter activation, and selected-row highlight.
  - Validated the existing same-file CSV export hardening by using shared
    `quotedCsvRow()` and a client export regression for formula-prefix cells.
- Safety:
  - Prevents DataTable consumers that index into original arrays from opening or
    highlighting the wrong record after sort/filter, including medication master
    and QR-draft style workflows.
  - Client CSV export formula-prefix neutralization reduces spreadsheet formula
    injection risk.
  - No API, DB, auth/RLS, route contract, migration, billing, external send,
    production config, secret, dependency, push/deploy, or destructive-operation
    behavior changed.
- Performance:
  - No performance optimization is claimed.
  - The patch only changes row identity selection and CSV helper reuse.
- Validation:
  - Focused DataTable suite passed `1` file / `7` tests before hardening.
  - Final DataTable + safe-csv bundle passed `2` files / `17` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Codex frontend reviewer and test architect reported no blockers; their
    optional hardening suggestions were applied before final validation.

## 2026-07-02 13:47 JST - Patient Status Window Query Order

- Change ID: `RR-BUG-20260702-F01-patient-status-window-query-order`.
- Category: bug fix / backend raw SQL / daily job reliability.
- Files changed:
  - `src/server/services/patient-status-tracker.ts`
  - `src/server/services/patient-status-tracker.test.ts`
- Summary:
  - Replaced the outer raw SQL `ORDER BY target_id, created_at DESC` with
    `ORDER BY target_id, rn`.
  - Kept `rn` defined by the `created_at DESC` window order, preserving
    newest-first rows within each patient.
  - Added SQL-shape regression coverage for the `AS rn` alias, `rn <= 5`, the
    new outer order, and the absence of the old missing-column outer order.
- Safety:
  - Prevents the daily patient-status tracking job from crashing on PostgreSQL
    due to an outer-scope missing-column reference.
  - Preserves org scoping, `$queryRaw` bind parameters, audit writes,
    notification writes, DB schema, migrations, auth/RLS semantics, external
    sends, billing, secrets, push/deploy, and destructive-operation boundaries.
- Performance:
  - No performance optimization is claimed.
  - The existing bounded per-patient top-5 window query remains unchanged except
    for the outer sort key.
- Validation:
  - Focused patient-status tracker suite passed `1` file / `7` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Codex db steward and test architect reported no blockers.
  - gbrain write/readback:
    `projects/careviax/failures/2026-07-02/patient-status-window-query-outer-order-created-at`.

## 2026-07-02 14:02 JST - Admin Capacity Completed-Today JST DateTime Range

- Change ID:
  `RR-BUG-20260702-F06-admin-capacity-jst-completed-today`.
- Category: bug fix / backend KPI date boundary / admin dashboard reliability.
- Files changed:
  - `src/app/api/admin/capacity/route.ts`
  - `src/app/api/admin/capacity/route.test.ts`
- Summary:
  - Replaced the admin capacity completed-today `updated_at` predicate based on
    server-local midnight with `japanDayInstantRange(now)`.
  - Preserved `todayUtcRange(now)` for `@db.Date` sentinel columns
    `scheduled_date` and `date`.
  - Added a JST 00:30 boundary regression proving DateTime instant windows and
    `@db.Date` sentinel windows are not mixed.
  - Changed mocked `@db.Time` route-test fixtures to explicit UTC sentinel
    values to match the route's time-of-day decoding.
- Safety:
  - Aligns the admin capacity completed-today KPI with
    `/api/dashboard/dispensing-stats`.
  - Preserves org scoping, auth wrapper semantics, route response shape, DB
    schema, migrations, auth/RLS semantics, external sends, billing, secrets,
    production config, push/deploy, and destructive-operation boundaries.
- Performance:
  - No performance optimization is claimed.
  - The count query remains a single bounded org/status DateTime predicate and
    is now a half-open range.
- Validation:
  - Initial focused capacity suite exposed and then resolved the local-time
    `@db.Time` fixture drift.
  - Focused route suite passed `1` file / `2` tests.
  - Capacity + date-boundary suite passed `2` files / `24` tests.
  - Final capacity + date-boundary + sibling dispensing-stats bundle passed
    `3` files / `28` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Codex db steward and test architect reported no blockers.
  - gbrain write/readback:
    `projects/careviax/failures/2026-07-02/admin-capacity-completed-today-server-local-midnight`.

## 2026-07-02 14:17 JST - Shift Template Apply UTC Date Sentinel

- Change ID:
  `RR-BUG-20260702-F07-shift-template-apply-utc-date`.
- Category: bug fix / backend date boundary / RLS context hardening.
- Files changed:
  - `src/app/api/pharmacist-shift-templates/apply/route.ts`
  - `src/app/api/pharmacist-shift-templates/apply/route.test.ts`
  - `package.json`
- Summary:
  - Replaced local-time month iteration with UTC month/day iteration for shift
    template application.
  - Added exact UTC-midnight sentinel assertions for the generated April 2026
    Monday `PharmacistShift.date` upsert keys and create payloads.
  - Moved template reads into the same `withOrgContext` transaction as shift
    writes and passed explicit `requestContext`.
  - Added the apply route regression to the schedule/timezone CI gate.
- Safety:
  - Prevents template-applied shifts from being stored on the previous civil day
    under JST runtime.
  - Keeps RLS/audit context aligned with sibling pharmacist shift routes.
  - Preserves auth permission, route response shape, DB schema, migrations,
    external sends, billing, secrets, production config, push/deploy, and
    destructive-operation boundaries.
- Performance:
  - No performance optimization is claimed.
  - The route still performs one template read and the same per-date upserts.
- Validation:
  - Focused apply route suite passed `1` file / `3` tests.
  - Related shift/date-boundary bundle passed `4` files / `49` tests.
  - Targeted TZ bundles passed in Asia/Tokyo, UTC, and America/Los_Angeles.
  - `TZ=Asia/Tokyo pnpm test:schedule-time:tz` passed `31` files / `555` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Codex db steward and test architect reported no blockers for the date fix.
  - gbrain write/readback:
    `projects/careviax/failures/2026-07-02/pharmacist-shift-template-apply-local-date`.
