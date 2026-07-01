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
