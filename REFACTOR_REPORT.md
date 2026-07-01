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
