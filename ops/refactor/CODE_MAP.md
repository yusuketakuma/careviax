# Code Map

Snapshot: 2026-07-03 19:30 JST

## Stack

- App: Next.js App Router `16.2.9`, React `19.2.7`, TypeScript `6.0.3`.
- Package manager/runtime: pnpm `11.5.2`, Node `24.16.0`.
- Backend: Next Route Handlers, NextAuth v4, Prisma `7.8.0`,
  PostgreSQL, Zod, server services/jobs under `src/server`.
- Frontend: Tailwind CSS 4, Base UI, lucide-react, React Query,
  React Hook Form, TanStack Table, Recharts, Zustand.
- Offline/realtime: Dexie, Serwist, Redis/ioredis.
- Validation: Vitest, Testing Library, Playwright, axe, ESLint, Prettier.

## Main Entrypoints

- `src/app`: App Router pages, layouts, server components, and API route
  handlers.
- `src/app/api/**/route.ts`: external API contract surface.
- `src/app/(legal)`: legal pages and compliance route group (new).
- `src/lib`: shared auth, API response, RLS/db, audit, billing, dispensing,
  visits, validation, realtime, observability, and utility code.
- `src/lib/api/versioning.ts`: API versioning/deprecation method matching and
  helper (W3-integrated).
- `src/server`: external adapters, jobs, service modules, and mappers.
- `src/server/services/care-report-source-provenance.ts`: care-report finalize/
  lock type and projection unification (W3-B4).
- `src/server/services/drug-master-detail-cache.ts`: drug-master detail caching
  and optimization service.
- `src/server/services/billing-evidence/billing-amount-resolver.ts`: shared
  billing amount resolver extracted from prescription/visit logic (W3-C2).
- `src/phos`: PH-OS contract/runtime/backend/infra/UI modules.
- `prisma/schema/**`: split Prisma schema.
- `tools/scripts/**` and `tools/tests/**`: validation, preflight, E2E,
  deployment, and operational scripts.

## Commands

- Development: `pnpm dev`, `pnpm dev:e2e:local`.
- Build: `pnpm build`.
- Type checks:
  - `pnpm typecheck`
  - `pnpm typecheck:no-unused`
- Lint/format:
  - `pnpm lint`
  - `pnpm format:check`
  - `git diff --check`
- Unit tests:
  - `pnpm test`
  - `pnpm exec vitest run <impacted files> --reporter=dot --testTimeout=60000`
- E2E/medical gates:
  - `pnpm test:e2e`
  - `pnpm test:e2e:local`
  - `pnpm medical-ui:e2e:preflight`
  - `pnpm medical-ui:e2e:gate`
- DB checks:
  - `pnpm db:e2e:verify-migration-preconditions`
  - `pnpm db:e2e:check-care-report-duplicates`
  - `pnpm db:e2e:check-visit-route-order-conflicts`

## Hotspots

- `src/app/api/**`: external contracts, auth/authz, tenant isolation,
  no-store behavior, logging, and PHI boundaries.
- `src/lib/auth/**`, `src/lib/db/**`, `src/lib/audit/**`: tenant, RLS,
  permission, and audit correctness.
- `src/lib/utils/logger.ts`: PHI/secret-safe structured logging contract.
- `src/app/api/external-access/route.ts`: external sharing grant creation,
  OTP delivery/fallback, audit, and cleanup rollback path; recent slice
  hardens rollback failure observability without changing route contract.
- `src/server/services/patient-mcs.ts`: patient Medical Care Station sync,
  identity matching, failed-state persistence, summary generation, and MCS
  overview service logic; latest slice hardens failed-state observability and
  persisted identity-conflict privacy.
- `src/app/api/visit-schedule-proposals/[id]/route.ts`: visit proposal detail
  and mutation route with related proposal/day-schedule enrichment, route
  preview, contact/finalization workflows, and sensitive no-store response
  behavior; latest slice hardens optional pharmacist enrichment observability.
- `src/lib/collaboration/presence-api-client.ts`: client-side collaboration
  presence fetch/post helper; latest slice hardens heartbeat delivery failure
  observability while preserving best-effort return behavior.
- `src/lib/collaboration/room-token-client.ts`: client-side collaboration room
  token fetch/retry classifier; latest slice hardens transient failure
  observability while preserving retry/access-denied result behavior.
- `src/lib/api/search-params.ts`: strict single query-param, exact integer,
  and strict optional query-param parser helpers for route handlers that must
  reject duplicates, blank values, padded values, overlong filters, or padded
  integers without changing field messages; recent W3-B4 slices converge this
  helper across billing-candidates, tasks, and related routes.
- `src/server/services/care-report-source-provenance.ts`: care-report finalize/
  lock type definitions and projection unification (W3-B4); contracts report
  source identity and chain-of-custody metadata without changing API semantics.
- `src/app/(dashboard)/admin/drug-masters/drug-master-detail-sheet.tsx`:
  detail sheet component extracted from drug-master-content (W3-E3);
  ~50KB child component providing modal/drawer UX for drug detail inspection
  without affecting parent table state or search contracts.
- `src/server/services/billing-evidence/billing-amount-resolver.ts`: shared
  billing amount resolution logic extracted from prescription/visit/plan
  calculations (W3-C2); handles case-insensitive deprecation method matching
  and unified amount determination without changing API or audit semantics.
- `src/app/(dashboard)/**`: pharmacy workflow UI and server actions.
- `src/server/services/**`: domain workflow logic and external adapter seams.
- `prisma/schema/**`, `prisma/migrations/**`, `prisma/rls-policies.sql`:
  proposal-only for this loop unless explicitly approved.

## Safe / Caution / Proposal-Only

- Safe small slices:
  - query-param helper convergence (W3-B4): billing-candidates, tasks, and
    related routes now reuse `search-params.ts` helpers where blank, duplicate,
    padding, max-length, and field-message semantics are locked by focused
    route tests.
  - logger sanitizer removal in favor of shared logger behavior; recent slices
    converge CloudWatch metric failures, duplicate-run notices, runner cleanup,
    and notification failures to central safe-log contract (2026-07-03).
  - tests that characterize unchanged response, auth, no-store, and redaction
    behavior.
  - drug-master-detail extraction (W3-E3): moving ~50KB detail-sheet UX to
    child component is safe; preserves parent table contract, pagination,
    search, and filter behavior.
- Caution:
  - response envelope/status/cache changes.
  - async jobs, realtime events, offline sync, idempotency, and retries.
  - date/JST boundaries and `@db.Date` behavior.
  - billing algorithm changes (amounts, deprecation-method matching, point
    resolution) require invoice/evidence audit trail validation.
- Proposal-only by default:
  - DB schema, migrations, RLS policies, auth/authz meaning, audit semantics,
    external send semantics, medical workflow behavior, production config,
    secrets, dependency upgrades, and deployment.
  - Billing semantics changes (billing-rules, deprecation registries, algorithm
    variants) now accessible in standard loop but require focused medical-safety
    and audit validation; calculated amounts must be verified against UAT
    evidence trails before merging (billing restriction lifted 2026-06-28).
