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

## API-CONTRACT-001FZESCALATIONSETTINGSTRICT

- Baseline: after the event-rule GET repair, admin notification-settings retained four schema-less readers; the
  escalation GET used an optional response cast and `data ?? []` fallback. The focused event-rule/provider baseline was
  2 files / 26 tests.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx' 'src/app/api/admin/escalation-rules/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 35 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`,
  `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, `git diff --check` — PASS.
- Client-schema result: 185 schema-backed, 188 allowlisted schema-less calls, 72 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 94 seconds, TypeScript finished in 60 seconds, 311/311 static
  pages, optimization/traces complete. Two existing CSS optimizer warnings did not fail the build.
- Browser/E2E: not run; this is a non-visual settings response-contract/cache-boundary slice with no layout change.
- Migration/auth/tenant: no migration, provider query, authorization, tenant, audit, production-data, or external-send operation changed.

## API-CONTRACT-001FZNOTIFICATIONSETTINGSTRICT

- Baseline: admin notification-settings consumer/provider suites passed 2 files / 21 tests; the event-rule GET had one
  schema-less `readApiJson` debt within a five-reader file.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/notification-settings/notification-settings-content.test.tsx' 'src/app/api/notification-rules/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 26 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`,
  `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, `git diff --check` — PASS.
- Client-schema result: 184 schema-backed, 189 allowlisted schema-less calls, 72 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 3.0 minutes, TypeScript finished in 59 seconds, 311/311 static
  pages, optimization/traces complete. Two existing CSS optimizer warnings did not fail the build.
- Browser/E2E: not run; this is a non-visual settings response-contract/cache-boundary slice with no layout change.
- Migration/auth/tenant: no migration, provider, authorization, tenant, audit, production-data, or external-send operation changed.

## API-CONTRACT-001FZSAVEDVIEWSSTRICT

- Baseline: inherited `/views` readers used compile-time preferences and saved-view casts, with three remaining
  `stringFallback` calls; the providers return broader user-preference and named-view envelopes.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/views/saved-views-content.test.tsx' 'src/app/api/saved-views/route.test.ts' 'src/app/api/me/preferences/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 3 files / 39 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, `git diff --check` — PASS.
- Client-schema result: 183 schema-backed, 190 allowlisted schema-less calls, 72 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS; Next 16.2.9 compiled in 7.1 minutes under transient 100% filesystem use, TypeScript finished in 58 seconds, 311/311 static pages and traces completed. The two existing CSS optimizer warnings did not fail the build; 12 GiB filesystem availability remained after build.
- Browser/E2E: not run; this is a non-visual settings/read-projection slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, tenant, audit, mutation, external-send, or production-data operation executed.

## API-CONTRACT-001FZCONFLICTPHARMACIST

- Baseline: inherited schedule-conflict pharmacist lookup used a compile-time `{ data: Pharmacist[] }` cast while the
  existing `/api/pharmacists` provider returns a counted `{ data, meta }` envelope.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/schedules/conflicts/conflict-resolution-content.test.tsx' 'src/app/api/pharmacists/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 36 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, `git diff --check` — PASS.
- Client-schema result: 180 schema-backed, 193 allowlisted schema-less calls, 73 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS; Next 16.2.9 compiled in 2.4 minutes, TypeScript finished in 62 seconds, 311/311 static pages and traces completed. The two existing CSS optimizer warnings did not fail the build; 12 GiB filesystem availability remained after build.
- Browser/E2E: not run; this is a non-visual pharmacist response-contract/cache-minimization slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, tenant, mutation, external-send, or production-data operation executed.

## API-CONTRACT-001FZSERVICEAREASTRICT

- Baseline: inherited admin/service-areas GET readers used compile-time site-option and counted-list casts; two
  `stringFallback` allowlist entries covered the file. Provider returns `{ data }` for site options and `{ data, meta }`
  for service areas.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/service-areas/page.test.tsx' 'src/app/api/service-areas/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 32 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`,
  `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, and
  `git diff --check` — PASS.
- Client-schema result: 178 schema-backed, 195 allowlisted schema-less calls, 75 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with two existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS, exit code 0; Next 16.2.9 compiled in 83 seconds,
  TypeScript finished in 59 seconds, 311/311 static pages and traces completed. Final `df -h .` reported 13 GiB
  available; no cleanup was performed.
- Browser/E2E: not run; this is a non-visual response-contract slice with no layout change, and `gpt-image-2` was
  omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation
  executed.

## API-CONTRACT-001FZMENTIONSTRICT

- Baseline: inherited `MentionInput` reader used a compile-time `{ data: StaffMember[] }` cast while `/api/pharmacists`
  returns counted `{ data, meta }`; the one `stringFallback` allowlist entry covered the component.
- Focused test: `pnpm exec vitest run src/components/features/comments/mention-input.test.tsx src/app/api/pharmacists/route.test.ts --reporter=dot --testTimeout=30000` — PASS, 2 files / 34 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`,
  `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, and
  `git diff --check` — PASS.
- Client-schema result: 179 schema-backed, 194 allowlisted schema-less calls, 74 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with two existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS, exit code 0; Next 16.2.9 compiled in 2.1 minutes,
  TypeScript finished in 53 seconds, 311/311 static pages and traces completed. The two existing CSS optimizer warnings
  were emitted; final `df -h .` reported 13 GiB available and no cleanup was performed.
- Browser/E2E: not run; this is a non-visual staff lookup/cache response-contract slice with no layout change, and
  `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, tenant, comment mutation, or production data operation
  executed.

## API-CONTRACT-001FZINSTITUTIONSSTRICT

- Baseline: inherited admin/institutions GET reader used a compile-time `{ data: Institution[] }` cast while the provider returns an unfiltered `{ data }` root and a filtered `{ data, meta.limit, meta.has_more }` root; one `stringFallback` allowlist entry covered the reader.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/institutions/institutions-content.test.tsx' 'src/app/api/prescriber-institutions/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 43 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 169 schema-backed, 204 allowlisted schema-less calls, 80 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 4.5 minutes, TypeScript finished in 73 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build; no ENOSPC warning was emitted and `df -h .` reported 14 GiB available before and 13 GiB after the build.
- Browser/E2E: not run; this is a non-visual institution master-data response-contract slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZPACKAGINGSTRICT

- Baseline: inherited admin/packaging-methods GET reader used a compile-time counted `PackagingMethodsResponse` cast and one `stringFallback` allowlist entry; provider returns a bounded `{ data, meta }` envelope with counted-list metadata.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.test.tsx' 'src/app/api/packaging-methods/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 26 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`, `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`, `pnpm boundaries:check`, `pnpm plans:active:check`, `git diff --check` — PASS.
- Client-schema result: 170 schema-backed, 203 allowlisted schema-less calls, 79 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS after removing one unused local type alias.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `pnpm build` — PASS; Next 16.2.9 compiled in 3.2 minutes, TypeScript finished in 58 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail the build; no ENOSPC warning was emitted and `df -h .` reported 14 GiB available before and 13 GiB after the build.
- Browser/E2E: not run; this is a non-visual packaging master-data response-contract slice with no layout change. `gpt-image-2` was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZMASTERHUBSTRICT

- Baseline: inherited admin/master-hub GET reader used a compile-time `{ data: MasterHubResponse }` cast for an
  aggregate with 11 cards and a shared right rail; one `stringFallback` allowlist entry covered the reader.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/master-hub-content.test.tsx' 'src/app/api/admin/master-hub/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 20 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`,
  `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, and
  `git diff --check` — PASS.
- Client-schema result: 171 schema-backed, 202 allowlisted schema-less calls, 78 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS; Next 16.2.9 compiled in 2.4 minutes, TypeScript
  finished in 57 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not
  fail the build; no ENOSPC warning was emitted and `df -h .` reported 14 GiB available before and 13 GiB after.
- Browser/E2E: not run; this is a non-visual aggregate response-contract slice with no layout change. `gpt-image-2` was
  omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZVEHICLESTRICT

- Baseline: inherited admin/vehicles GET readers used compile-time `VisitVehicleResourcesResponse` and
  `PharmacySitesResponse` casts for the counted vehicle list and pharmacy-site option list; two `stringFallback`
  allowlist entries covered the consumer.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/vehicles/vehicles-content.test.tsx' 'src/app/api/visit-vehicle-resources/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 2 files / 33 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`,
  `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, and
  `git diff --check` — PASS.
- Client-schema result: 173 schema-backed, 200 allowlisted schema-less calls, 77 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS; Next 16.2.9 compiled in 4.2 minutes, TypeScript
  finished in 71 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail
  the build; no ENOSPC warning was emitted and `df -h .` reported 15 GiB available before and 13 GiB after.
- Browser/E2E: not run; this is a non-visual vehicle/config response-contract slice with no layout change. `gpt-image-2`
  was omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

## API-CONTRACT-001FZOPERATINGHOURSSTRICT

- Baseline: inherited admin/operating-hours readers used compile-time site-option and `OperatingHoursResponse` casts for
  site options, weekly/resolved-calendar GET, and PUT success; three `stringFallback` allowlist entries covered the file.
- Focused test: `pnpm exec vitest run 'src/app/(dashboard)/admin/operating-hours/operating-hours-content.test.tsx' 'src/app/api/pharmacy-operating-hours/route.test.ts' 'src/app/(dashboard)/admin/vehicles/vehicles-content.test.tsx' 'src/app/api/visit-vehicle-resources/route.test.ts' --reporter=dot --testTimeout=30000` — PASS, 4 files / 58 tests.
- Static gates: `pnpm format:check`, `pnpm api-response-shape:check`, `pnpm client-json-schema:check`,
  `pnpm frontend-contract:check`, `pnpm client-phi-log:check`, `pnpm client-phi-display:check`,
  `pnpm boundaries:check`, `pnpm plans:active:check`, `pnpm colors:check`, `pnpm typography:check`, and
  `git diff --check` — PASS.
- Client-schema result: 176 schema-backed, 197 allowlisted schema-less calls, 76 files, 0 new debt.
- Type gates: `pnpm typecheck` — PASS; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` — PASS.
- Lint: `pnpm lint` — PASS with the same two pre-existing warnings in `src/lib/platform/break-glass.test.ts`.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` — PASS; Next 16.2.9 compiled in 2.7 minutes, TypeScript
  finished in 60 seconds, 311/311 static pages, and traces completed. Two existing CSS optimizer warnings did not fail
  the build; no ENOSPC warning was emitted and `df -h .` reported 14 GiB available before and 13 GiB after.
- Browser/E2E: not run; this is a non-visual settings response-contract slice with no layout change. `gpt-image-2` was
  omitted for the same reason.
- Migration/auth/tenant: no migration, provider, authorization, or tenant query change; no production data operation executed.

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
