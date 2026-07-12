# Verification Evidence

## API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT

- Baseline: inherited working-tree slice; target readers were compile-time casts and were present in the client-schema allowlist.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/business-holidays/business-holidays-content.test.tsx' 'src/app/(dashboard)/admin/shifts/shifts-content.test.tsx' --reporter=dot --testTimeout=30000` — PASS, 2 files / 39 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, `git diff --check` — PASS.
- Client-schema result: 161 schema-backed, 212 allowlisted schema-less calls, 88 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with two existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm plans:active:check && pnpm build` — PASS; Next 16.2.9 compile 4.1 minutes, TypeScript 57 seconds, 311/311 static pages, traces complete. Two existing CSS optimizer warnings did not fail the build.
- Browser/E2E: not run; this is a non-visual response-contract slice and no visual behavior changed.
- Migration/auth/tenant: no migration or backend authorization change; no production data operation executed.

## API-CONTRACT-001FZNOTIFICATIONBELLSTRICT

- Baseline: inherited notification-bell summary/list refreshes used optional compile-time payload casts and one `stringFallback` allowlist entry; provider returns a bounded `{ data: { unreadCount } }` summary and `{ data, meta }` list envelope.
- Focused test: `pnpm exec vitest run 'src/components/features/notifications/notification-bell.fetch.test.tsx' 'src/components/features/notifications/notification-bell.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 12 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 168 schema-backed, 205 allowlisted schema-less calls, 81 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 2.5 minutes, TypeScript finished in 65 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build; no ENOSPC warning was emitted and `df -h .` reported 14 GiB available before and after the build.
- Browser/E2E: not run; this is a non-visual notification badge/drawer response-contract slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZNOTIFICATIONSREADSTRICT

- Baseline: inherited notifications GET reader used a compile-time data-only cast while `/api/notifications` returns `{ data, meta.limit, meta.has_more, meta.next_cursor }`; the existing PATCH and SSE-safe paths were already covered and remain unchanged.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/notifications/notifications-content.test.tsx' 'src/app/api/notifications/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 29 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 166 schema-backed, 207 allowlisted schema-less calls, 83 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 3.8 minutes, TypeScript finished in 58 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build; no ENOSPC warning was emitted.
- Browser/E2E: not run; this is a non-visual notification-data contract slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZFACILITYUNITSSTRICT

- Baseline: inherited facilities editor unit GET reader used a compile-time `{ data: FacilityUnit[] }` cast while `/api/admin/facilities/[id]/units` returns a projected `{ data }` list with patient counts; facility list, unit mutations, and authz were already covered and remain unchanged.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/facilities/facilities-content.test.tsx' 'src/app/api/admin/facilities/[id]/units/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 25 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 167 schema-backed, 206 allowlisted schema-less calls, 82 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 3.7 minutes, TypeScript finished in 63 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build; no ENOSPC warning was emitted.
- Browser/E2E: not run; this is a non-visual facility-unit data-contract slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZSTAFFMETRICSSTRICT

- Baseline: inherited admin/staff KPI reader used a compile-time response cast and one `stringFallback` allowlist entry; provider returned `{ data: { month, summary, items } }` from the existing authorized organization-scoped aggregate route.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/staff/staff-kpi-panel.test.tsx' 'src/app/api/admin/staff-metrics/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 16 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 163 schema-backed, 210 allowlisted schema-less calls, 86 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 6.0 minutes, TypeScript finished in 68 seconds, 311/311 static pages, and traces completed. Webpack emitted an ENOSPC pack-cache warning on the 95%-full filesystem and two existing CSS optimizer warnings; exit was 0.
- Browser/E2E: not run; this is a non-visual response-contract and query-cache minimization slice with no UI layout change.
- Migration/auth/tenant: no migration or backend authorization change; no production data operation executed.

## API-CONTRACT-001FZOPSINSIGHTSTRICT

- Baseline: inherited admin/operations-insights reader used a compile-time response cast and one `stringFallback` allowlist entry; provider returned five-month visit buckets, process durations, and generated hints.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/operations-insights/operations-insights-content.test.tsx' src/lib/analytics/operations-insights.test.ts --reporter=dot --testTimeout=30000` — PASS, 2 files / 14 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 164 schema-backed, 209 allowlisted schema-less calls, 85 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 5.0 minutes, TypeScript finished in 67 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build; filesystem usage peaked at 99% during compilation and no cleanup was performed.
- Browser/E2E: not run; this is a non-visual aggregate response-contract slice with no layout change.
- Migration/auth/tenant: no migration or backend authorization change; no production data operation executed.

## API-CONTRACT-001FZSITESELECTREADSTRICT

- Baseline: inherited select-site GET reader used a compile-time data-only cast while `/api/me/sites` returns `{ data, meta.limit, meta.has_more }`; existing PUT acknowledgement tests were already present.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/select-site/select-site-content.test.tsx' --reporter=dot --testTimeout=30000` — PASS, 1 file / 6 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 165 schema-backed, 208 allowlisted schema-less calls, 84 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 3.5 minutes, TypeScript finished in 66 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build.
- Browser/E2E: not run; this is a non-visual navigation-data response-contract slice with no layout change.
- Migration/auth/tenant: no migration or backend authorization change; no production data operation executed.

## API-CONTRACT-001FZSITESELECTREADSTRICT

- Baseline: inherited select-site GET reader used a compile-time data-only cast while `/api/me/sites` returns `{ data, meta.limit, meta.has_more }`; existing PUT acknowledgement tests were already present.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/select-site/select-site-content.test.tsx' --reporter=dot --testTimeout=30000` — PASS, 1 file / 6 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 165 schema-backed, 208 allowlisted schema-less calls, 84 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 3.5 minutes, TypeScript finished in 66 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build.
- Browser/E2E: not run; this is a non-visual navigation-data response-contract slice with no layout change.
- Migration/auth/tenant: no migration or backend authorization change; no production data operation executed.

## API-CONTRACT-001FZJOBLISTSTRICT

- Baseline: inherited admin/jobs reader used a compile-time response cast and one `stringFallback` allowlist entry; provider returned 33 fixed definitions with redacted latest run/export DTOs.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/jobs/jobs-dashboard-content.test.tsx' 'src/app/api/jobs/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 16 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 162 schema-backed, 211 allowlisted schema-less calls, 87 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compile 2.6 minutes, TypeScript 55 seconds, 311/311 static pages, traces complete. Two existing CSS optimizer warnings did not fail the build.
- Browser/E2E: not run; this is a non-visual response-contract slice and no visual behavior changed.
- Migration/auth/tenant: no migration or backend authorization change; no production data operation executed.
