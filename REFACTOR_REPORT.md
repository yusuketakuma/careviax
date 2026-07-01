# REFACTOR_REPORT.md

Snapshot: 2026-07-01 JST

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
