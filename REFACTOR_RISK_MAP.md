# REFACTOR_RISK_MAP.md

Snapshot: 2026-07-01 JST

This risk map classifies refactor work for CareViaX / PH-OS. It is intended to
stop broad cleanup from crossing medical, privacy, tenant, audit, billing, or
database boundaries without explicit design and validation.

## Rule Of Engagement

- P0: proposal-only by default. Do not implement unless explicitly approved for
  a narrow, tested slice.
- P1: implement only in small route/service families with contract tests.
- P2: implement as small UI/form/display slices with focused tests and no
  business-contract drift.
- P3: safe cleanup, but still prove unused status and avoid mixing with P0/P1
  changes.

## P0: Critical / Proposal-Only Areas

### Auth, Authz, Tenant, RLS

- Paths:
  - `src/lib/auth/context.ts`
  - `src/lib/auth/permission-matrix.ts`
  - `src/lib/db/rls.ts`
  - `prisma/rls-policies.sql`
  - `src/app/api/**`
- Risk:
  - `x-org-id`, membership lookup, permission checks, and RLS context are the
    tenant boundary.
  - Drift can create IDOR, cross-org PHI exposure, or unauthorized mutation.
- Allowed action:
  - Proposal-only for behavior changes.
  - Small tested helper usage changes are allowed only when permission, org
    resolution, response shape, and DB query semantics are unchanged.
- Required validation:
  - permission-denied tests
  - cross-org tests
  - org header mismatch tests
  - RLS context fail-closed tests
  - route contract tests

### DB Schema, Migration, RLS Policies, Audit Triggers

- Paths:
  - `prisma/schema/**`
  - `prisma/migrations/**`
  - `prisma/rls-policies.sql`
  - migration/precondition scripts under `tools/scripts`
- Risk:
  - Migration/RLS/audit trigger changes can permanently alter stored data,
    tenant isolation, audit history, or rollback ability.
- Allowed action:
  - Proposal-only unless the user explicitly approves schema/migration work.
  - No `db:e2e:push`; use migration/precondition paths.
- Required validation:
  - `pnpm db:e2e:prepare`
  - `pnpm db:e2e:verify-migration-preconditions`
  - RLS and audit trigger tests
  - rollback plan

### Audit Logs And Patient Revision History

- Paths:
  - `src/lib/audit/**`
  - `src/app/api/**` write routes
  - `prisma/schema/admin.prisma`
  - `prisma/schema/patient.prisma`
  - audit trigger migrations
- Risk:
  - Missing actor, org, request context, or PHI redaction undermines compliance.
  - Moving audit writes out of transactions can create mutation-without-audit.
- Allowed action:
  - Proposal-only for audit semantics.
  - Existing helper adoption is allowed only where tests prove identical or
    stronger audit fields and same transaction boundary.
- Required validation:
  - route tests for audit action/target/changes
  - PHI redaction checks
  - transaction boundary checks

### PHI Export, External Sharing, Care Reports, File Assets

- Paths:
  - `src/app/api/care-reports/**`
  - `src/app/api/external-access/**`
  - `src/app/api/files/**`
  - `src/app/shared/[token]`
  - `src/server/services/file-storage.ts`
  - `prisma/schema/communication.prisma`
  - `prisma/schema/admin.prisma`
- Risk:
  - Report content, PDFs, recipient details, tokens, grants, and file assets can
    leak PHI externally.
  - Re-send/idempotency drift can duplicate external communication.
- Allowed action:
  - Proposal-only for grants, token semantics, recipient behavior, file access,
    and external sends.
  - Path/helper extraction must prove identical URL/payload/header behavior.
- Required validation:
  - no-store response checks
  - external token expiry/revocation tests
  - case/org ownership tests
  - recipient minimization tests
  - idempotency tests

### Medical Safety Data

- Paths:
  - `src/app/api/prescription-*`
  - `src/app/api/dispense-*`
  - `src/app/api/set-*`
  - `src/app/api/drug-*`
  - `src/app/api/residual-medications`
  - `src/app/api/pca-*`
  - `src/lib/dispensing/**`
  - `src/server/services/drug-master-import/**`
  - `prisma/schema/prescription.prisma`
  - `prisma/schema/drug.prisma`
  - `prisma/schema/pca-pump.prisma`
- Risk:
  - Drug identity, package quantity, audit status, PCA lifecycle, residual meds,
    and set/dispense state affect patient safety.
- Allowed action:
  - Proposal-only for domain behavior changes.
  - Helper-only refactors require medical safety review and focused tests.
- Required validation:
  - medication identity tests
  - workflow state tests
  - double-submit/idempotency tests
  - medical UI targeted checks when visible flows change

### Billing, Payment, Partnership

- Paths:
  - `src/app/(dashboard)/billing/**`
  - `src/app/api/billing-*`
  - `src/app/api/pharmacy-*`
  - `src/server/services/billing-*`
  - `prisma/schema/pharmacy-partnership.prisma`
  - billing/evidence models in Prisma
- Risk:
  - PHI and financial/contract state intersect here.
  - Refactors can change claim eligibility, evidence, invoice, or partner
    visibility.
- Allowed action:
  - Proposal-only for billing semantics.
  - Read-only helper changes require contract and privacy review.
- Required validation:
  - billing permission tests
  - export authorization tests
  - evidence/invoice join tests
  - E2E guardrail tests where relevant

## P1: High-Risk But Implementable In Small Slices

### API Contracts And Route Handlers

- Paths: `src/app/api/**`
- Risk:
  - Response envelope, status code, cache headers, validation errors, and params
    are external contracts.
- Safe stance:
  - Route-family by route-family only.
  - Preserve response shape unless explicitly additive and backward-compatible.
- Validation:
  - focused route tests
  - auth failure tests
  - validation failure tests
  - no-store/internal-error tests where sensitive

### Async, Jobs, Queues, Realtime, Offline Sync

- Paths:
  - `src/server/jobs/**`
  - `src/app/api/notifications/stream/**`
  - `src/lib/realtime/**`
  - `src/lib/stores/**`
  - `src/lib/offline/**`
  - `src/server/adapters/realtime/**`
- Risk:
  - Retry, idempotency, lock, stale event, and conflict behavior can be broken by
    seemingly small cleanup.
- Safe stance:
  - Contract inventory first.
  - Do not change retry/cancel/fallback semantics without proposal.
- Validation:
  - stale lock tests
  - duplicate event tests
  - offline conflict tests
  - SSE auth/org isolation tests

### External Adapters And Outbound Requests

- Paths:
  - `src/server/adapters/**`
  - webhook APIs
  - external send APIs
  - file presign/download services
- Risk:
  - SSRF-like request paths, secret leakage, duplicate sends, timeout drift.
- Safe stance:
  - Proposal-only for send semantics.
  - Helper-only work must preserve timeout/retry/idempotency.
- Validation:
  - URL allowlist tests
  - secret redaction tests
  - timeout/retry tests
  - no duplicate send tests

### Date, Time, Schedule Boundaries

- Paths:
  - schedules/visits routes and UI
  - date helper libraries
  - Prisma `@db.Date` fields
- Risk:
  - JST/UTC drift can misplace visits, deadlines, audit timestamps, or billing
    periods.
- Safe stance:
  - UI/helper cleanup is small-slice only.
  - DB/date semantics are proposal-only.
- Validation:
  - `pnpm test:schedule-time:tz`
  - `pnpm date-slices:check`
  - timezone-specific unit tests

## P2: UI / Forms / Validation / Display Logic

- Paths:
  - `src/app/(dashboard)/**`
  - `src/components/features/**`
  - `src/components/ui/**`
  - `src/lib/forms/**`
  - `src/lib/validations/**`
- Risks:
  - False-empty states, hidden truncation, stale sample data, error display
    masking, disabled/no-op actions, accessibility regressions.
  - Patient/report/drug/visit UI still carries PHI or medical context even when
    the change is "frontend only".
- Safe stance:
  - Use `docs/ui-ux-design-guidelines.md` for UI changes.
  - Prefer behavior-preserving helper extraction, empty/error/loading state
    tightening, and tests.
  - Use browser/Playwright only when visible behavior changes materially.
- Validation:
  - focused component tests
  - no PHI leakage in errors/logs
  - keyboard/a11y checks for interactive surfaces
  - targeted E2E for high-risk visible flows

## P3: Low-Risk Cleanup

- Areas:
  - unused imports
  - unused variables/functions
  - dead code with reference proof
  - comments that contradict current code
  - duplicated helper functions
  - naming consistency
  - small constants/types extraction
- Safe stance:
  - Do not mix P3 cleanup into P0/P1 changes.
  - Prove unused status with `rg`/typecheck.
  - Do not remove tests unless they only cover demonstrably obsolete/dead code
    and remaining tests preserve the live behavior.
- Validation:
  - `rg` before/after
  - focused tests where behavior surface is touched
  - `pnpm typecheck`
  - `pnpm typecheck:no-unused`
  - `pnpm lint`
  - `pnpm format:check`

## Current Safe First Candidates

These are candidates, not pre-approved implementation. Re-check live files before
editing.

1. `src/components/layout/use-nav-badges.ts`
   - Centralize `/api/nav-badges` path/header use.
   - Validate hook behavior when org is missing and fetch fails.
2. `src/lib/reports/generate-from-visit-client.ts`
   - Centralize `/api/care-reports/generate-from-visit` path.
   - Preserve payload and org JSON headers.
3. `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
   - Centralize notification/escalation rule API paths.
   - Do not change escalation or notification semantics.
4. `src/app/(dashboard)/admin/capacity/capacity-content.tsx`
   - Read-only admin capacity fetch helper cleanup.
   - Preserve 403/500 behavior.
5. `src/app/(dashboard)/admin/realtime/page.tsx`
   - Read-only realtime dashboard fetch helper cleanup.
   - Preserve streaming/fallback semantics.
6. `src/app/(dashboard)/patients/patients-board.tsx`
   - Patient board read API helper cleanup.
   - Requires privacy/medical review because patient list is PHI-adjacent.
7. `src/components/features/patients/residual-medication-chart.tsx`
   - Residual med read path helper cleanup.
   - Requires medication safety review.
8. `src/components/features/patients/patient-history-summary.tsx`
   - Prescription/visit history read helper cleanup.
   - Preserve `limit=5` and cache behavior.
9. `src/components/features/patients/patient-field-revision-timeline.tsx`
   - Field revision timeline path helper cleanup.
   - Preserve audit visibility and category param.
10. `src/components/visit-brief/patient-visit-brief-section.tsx`
    - Visit brief read path helper cleanup.
    - Preserve null/error handling and patient route shape.

## Validation Matrix By Risk

- P3 docs/dead-code/helper-only:
  - `git status --short --untracked-files=all`
  - focused `rg` proof
  - focused tests if any behavior surface changes
  - `pnpm typecheck`
  - `pnpm typecheck:no-unused`
  - `pnpm lint`
  - `pnpm format:check`
  - `git diff --check`
- P2 UI:
  - P3 checks
  - focused component tests
  - `docs/ui-ux-design-guidelines.md` inspection
  - browser/Playwright screenshot check when visible layout changes
- P1 API/async:
  - P3 checks
  - route/service tests
  - auth/validation/error/no-store cases
  - idempotency/retry tests where relevant
- P0:
  - proposal first
  - explicit approval before implementation
  - route tests, DB/e2e preconditions, migration/RLS proof, privacy/medical
    review, rollback plan.

## Non-Findings

- Raw `x-org-id` fetches are not classified as immediate vulnerabilities by
  themselves. They are refactor drift candidates when helper convergence can be
  proven behavior-preserving.
- This map does not authorize old UI removal, schema changes, RLS policy edits,
  auth wrapper replacement, or broad response envelope migration.
