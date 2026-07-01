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
