# REFACTOR_REPOSITORY_INVENTORY.md

Snapshot: 2026-07-01 JST

This inventory is the Phase 0 baseline for behavior-preserving refactoring in
CareViaX / PH-OS. It is based on live repository inspection, not on desired
architecture. Secret values were not inspected or recorded.

## Repository

- Name: `ph-os`
- Product: PH-OS Pharmacy / CareViaX
- Purpose: home-visit-focused pharmacy operations platform covering prescription
  intake, dispensing, audits, set preparation, visit scheduling, collaboration,
  reporting, billing, and administration.
- Runtime: Node `24.16.0`, pnpm `11.5.2`
- Package manager: pnpm workspace
- Primary app shape: Next.js App Router monorepo with Prisma/PostgreSQL,
  server-side services/jobs, Playwright/Vitest tests, and AWS deployment assets.

## Technology Stack

- Frontend: Next.js `16.2.9`, React `19.2.7`, TypeScript `6.0.3`,
  Tailwind CSS 4, Base UI, lucide-react, React Query, React Hook Form,
  TanStack Table, Recharts, Zustand.
- Backend/API: Next Route Handlers, NextAuth v4, Prisma `7.8.0`, PostgreSQL,
  Zod validation, server services and jobs under `src/server`.
- Offline/realtime: Dexie/offline store, service worker via Serwist, Yjs,
  y-websocket, Redis/ioredis adapters.
- Cloud/infra: AWS Cognito, RDS/Aurora PostgreSQL, S3, KMS, Secrets Manager,
  SES, SNS, DynamoDB, CloudWatch, API Gateway Management API, Docker, GitHub
  Actions.
- Observability/security: Sentry, CSP/security headers, audit logs, RLS,
  medical UI gates, deployment readiness scripts.
- Testing: Vitest, Testing Library, jsdom, Playwright, axe, custom DB/e2e
  preflight scripts.

## Classification

- Frontend/UI:
  - `src/app/(auth)`
  - `src/app/(dashboard)`
  - `src/components`
  - `src/phos/ui`
- Backend/API:
  - `src/app/api`
  - `src/server/services`
  - `src/server/jobs`
  - `src/server/adapters`
  - `src/phos/backend`
- Domain/shared libraries:
  - `src/lib`
  - `src/phos/domain`
  - `src/phos/contracts`
- Database/storage schema:
  - `prisma/schema/*.prisma`
  - `prisma/migrations/**`
  - `prisma/rls-policies.sql`
  - `prisma/seed.ts`
- Infrastructure/deployment:
  - `Dockerfile`
  - `docker-compose.yml`
  - `.github/workflows/*`
  - `tools/infra/**`
  - `src/phos/infra/**`
- Scripts/tests:
  - `tools/scripts/**`
  - `tools/tests/**`
  - `tools/browser-harness/**`

## Major Directory Structure

- `src/app`: App Router pages and route handlers.
  - `(auth)`: login, MFA, first-login, password, lockout.
  - `(dashboard)`: admin, dashboard, my-day, patients, prescriptions,
    dispense, set, set-audit, schedules, visits, reports, billing,
    communications, audit, search, workflow, settings, offline-sync.
  - `api`: broad API surface for patients, prescriptions, visits, reports,
    billing, pharmacy cooperation, files, notifications, jobs, drug masters,
    dispense flows, PH-OS proxy routes.
- `src/components`: reusable UI and feature components by domain.
- `src/lib`: auth, API helpers, RLS/db, audit, billing, dispensing, visits,
  prescription, pharmacy, files, offline, validation, realtime, env,
  observability helpers.
- `src/server`: external adapters, jobs, mappers, and server services.
- `src/phos`: PH-OS contract/runtime/backend/infra/UI modules.
- `prisma`: split schema, migrations, RLS policies, seed data.
- `tools`: scripts, Playwright tests, infra templates, DB prechecks,
  deployment/readiness tooling.
- `docs`: compliance, operations, testing, UI/UX SSOT, architecture/refactor
  notes, audit reports.

## Entrypoints

- Application:
  - `src/app/layout.tsx`
  - `src/app/page.tsx`
  - `src/app/(dashboard)/layout.tsx`
  - `src/app/(dashboard)/dashboard/page.tsx`
- Authentication:
  - `src/app/(auth)/login/page.tsx`
  - `src/app/(auth)/mfa`
  - `src/app/(auth)/first-login`
  - `src/app/(auth)/password`
- API:
  - `src/app/api/**/route.ts`
  - `src/app/api/health/route.ts`
  - `src/app/api/phos/[...path]/route.ts`
- Jobs:
  - `src/app/api/jobs/[jobType]/route.ts`
  - `src/server/jobs/index.ts`
  - `src/server/jobs/runner.ts`
- Prisma:
  - `prisma/schema/`
  - `prisma/seed.ts`
- Deployment:
  - `Dockerfile`
  - `.github/workflows/ci.yml`
  - `.github/workflows/aws-container-image.yml`

## Commands

### Development

- `pnpm dev`
- `pnpm dev:e2e:local`
- `pnpm build:e2e:local`
- `pnpm start:e2e:local`

### Build

- `pnpm build`

### Validation

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm date-slices:check`
- `pnpm eventbridge-schedules:check`

### E2E / Medical UI

- `pnpm test:e2e`
- `pnpm test:e2e:local`
- `pnpm test:e2e:audit`
- `pnpm medical-ui:e2e:preflight`
- `pnpm medical-ui:e2e:targeted`
- `pnpm medical-ui:e2e:gate`

### Database

- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:migrate:deploy`
- `pnpm db:e2e:prepare`
- `pnpm db:e2e:seed`
- `pnpm db:e2e:verify-migration-preconditions`

### CI

GitHub Actions run frozen dependency install, dependency audit, lint, format
check, date-slice check, EventBridge check, typecheck, no-unused typecheck,
coverage, PH-OS deploy artifact proof, build, migration gate, RLS gate, and
medical UI E2E gate.

## Dependency Groups

- AWS SDK: Cognito, S3, SES, SNS, DynamoDB, RDS, Secrets Manager,
  CloudWatch, API Gateway Management API.
- Data/runtime: Prisma, PostgreSQL, date-fns, zod, bcryptjs.
- UI/state: React, Next, React Query, React Hook Form, TanStack Table,
  Recharts, Zustand, Base UI, lucide-react.
- Offline/realtime: Dexie, Serwist, Yjs, y-websocket, ioredis.
- Documents/files: react-pdf, qrcode, fflate, exceljs, web-push.
- Testing: Vitest, Testing Library, Playwright, axe, jsdom.
- Tooling: TypeScript, ESLint, Prettier, tsx, Tailwind.

## Important Environment Variables

Names only. Values must not be stored in refactor docs.

- Core app/auth: `APP_ENV`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
  `AUTH_SECRET`, `JWT_SIGNING_SECRET`, `ENCRYPTION_KEY`
- Public app/Cognito: `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_COGNITO_USER_POOL_ID`, `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- Database: `DATABASE_URL`, `DIRECT_URL`, `DATABASE_POOL_SIZE`
- AWS/secrets/storage: `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `SECRETS_MANAGER_ENABLED`,
  `SECRETS_MANAGER_SECRET_ID`, `S3_BUCKET_NAME`, `S3_BUCKET_REGION`,
  `S3_KMS_KEY_ID`, `S3_SERVER_SIDE_ENCRYPTION`
- Mail/notifications: `SES_FROM_EMAIL`, `VAPID_PRIVATE_KEY`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`
- Rate limit/realtime: `RATE_LIMIT_STORE`, `RATE_LIMIT_DDB_REGION`,
  `RATE_LIMIT_DDB_TABLE_NAME`, `RATE_LIMIT_DDB_TIMEOUT_MS`, `REDIS_URL`
- Observability: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
- External adapters: Google Maps/Routes, e-prescription, qualification check,
  rececom claims, LINE, SMS/Twilio, webhook secret keys.
- PH-OS infra: `PHOS_API_BASE_URL`, `NEXT_PUBLIC_PHOS_API_BASE_URL`,
  `PHOS_DYNAMODB_TABLE_NAME`, `PHOS_SECURITY_EVENT_TABLE_NAME`,
  `PHOS_EVIDENCE_BUCKET`, `PHOS_EVIDENCE_KMS_KEY_ARN`,
  `PHOS_AURORA_DATABASE_SECRET_ARN`
- Test/e2e: `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_REUSE_SERVER`,
  `NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM`

## External APIs / Services

- AWS Cognito for auth identity.
- PostgreSQL / RDS / Aurora through Prisma and raw SQL migrations.
- S3/KMS for file/evidence storage.
- SES/SNS/web-push for communications and notifications.
- DynamoDB for rate limit / PH-OS event/security backing surfaces.
- CloudWatch/EventBridge for operations.
- API Gateway/Lambda-style PH-OS backend contract under `src/phos`.
- Sentry for error reporting.
- Google Maps/Routes.
- External healthcare/ops adapters under `src/server/adapters`:
  e-prescription, FHIR, claims export, qualification check, LINE, SMS,
  realtime.

## DB / Storage / Auth Connections

- DB: Prisma datasource is PostgreSQL; schema is split under `prisma/schema`.
- RLS: `src/lib/db/rls.ts` and `prisma/rls-policies.sql` enforce org context.
- Auth: `src/lib/auth/context.ts`, NextAuth, Cognito fields in Prisma user
  models, org membership and permission matrix.
- Audit: `AuditLog` model, DB audit triggers, `src/lib/audit/**`, route-level
  audit helpers.
- Storage: `FileAsset` model, S3 file services, legacy file API boundary,
  PH-OS evidence paths.
- Secrets: AWS Secrets Manager helper and production env validation.

## Important Domain Logic

- Patient/case/care team/insurance/clinical history/MCS:
  `prisma/schema/patient.prisma`, `src/server/services/patient-*`,
  `src/app/(dashboard)/patients`.
- Prescription intake/QR/JAHIS/dispensing/set audit/cycle state:
  `prisma/schema/prescription.prisma`, `src/lib/dispensing/**`,
  `src/app/(dashboard)/prescriptions`, `src/app/(dashboard)/dispense`.
- Drug master/package/formulary/import/safety alerts:
  `prisma/schema/drug.prisma`, `src/server/services/drug-master-import/**`,
  `src/app/(dashboard)/admin/drug-masters`.
- Visits/schedules/routes/vehicles/preparation/handoff:
  `prisma/schema/visit.prisma`, `src/app/(dashboard)/schedules`,
  `src/app/(dashboard)/visits`, `src/server/services/visit-*`.
- Billing/evidence/rules/claims/PCA guardrails:
  `src/server/services/billing-*`, `src/app/(dashboard)/billing`,
  billing/PCA E2E tests.
- Reports/external sharing/files:
  `src/app/(dashboard)/reports`, `src/app/api/care-reports`,
  `src/app/api/files`, `src/app/api/external-access`.
- Pharmacy cooperation/partnership/contracts/invoices:
  `prisma/schema/pharmacy-partnership.prisma`, `src/app/api/pharmacy-*`.
- PH-OS runtime contract:
  `src/phos/**`.

## Dangerous Areas

- Auth/authz, permission matrix, `x-org-id`, org membership resolution.
- Tenant isolation and `withOrgContext` / RLS context propagation.
- DB schema, migrations, triggers, RLS policies, backfills.
- Audit logs and PatientFieldRevision history.
- Patient PHI, care reports, PDFs, file assets, external-access grants.
- Drug master identity, prescriptions, dispensing, set audit, residual meds,
  PCA pump lifecycle.
- Billing/payment/evidence/contracts.
- Notifications, external sends, webhooks, LINE/SMS/email/FAX-like flows.
- Japan-time/date-only boundaries for schedules, visits, deadlines, audit
  interpretation.
- Offline sync and conflict handling.
- Realtime/SSE/collaboration presence.
- Production config, secrets, AWS templates, deployment scripts.

## Refactor Candidates

- Low-risk helper convergence:
  - API path helpers for raw fetch path construction.
  - Org header helper usage in read-only UI fetches.
  - URL encoding helpers for hostile IDs and search params.
- UI false-empty/truncation:
  - Additive count metadata only where response compatibility is preserved.
  - Display labels that distinguish visible-window counts from full totals.
- Large modules, only with characterization tests first:
  - `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
  - schedule day/proposal components
  - prescription intake form
  - patient detail services
  - billing evidence core
  - server daily jobs
- Docs/process:
  - Keep this Phase 0 inventory, risk map, execution plan, and progress
    ledgers tied to actual validation evidence.

## Current Phase 0 Bounds

- This inventory covers the current `careviax` checkout as a single repo.
- It does not claim every API route contract has been individually audited.
- It does not inspect or store secret values.
- It does not approve DB/auth/RLS/audit/PHI behavior changes.
