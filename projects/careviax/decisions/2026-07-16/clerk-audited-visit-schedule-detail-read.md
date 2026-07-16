---
type: ImplementationDecision
title: Audit patient visit schedule detail reads
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/visit-schedules/[id]/route.ts'
  - 'file:src/lib/auth/visit-schedule-access.ts'
  - 'file:src/lib/api/route-catalog.ts'
  - 'file:tools/route-auth-wrapper-allowlist.json'
  - 'commit:c3f09c84e'
  - >-
    test:pnpm vitest run 'src/app/api/visit-schedules/[id]/route.test.ts'
    src/lib/api/route-catalog.test.ts
    src/app/api/meta/route-catalog/route.test.ts
  - 'test:pnpm vitest run src/app/api/__tests__/protected-get-routes.test.ts'
  - 'test:pnpm typecheck'
created: '2026-07-16T18:07:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S14
repo_url: null
memory_id: >-
  projects/careviax/decisions/2026-07-16/clerk-audited-visit-schedule-detail-read
confidence: high
created_at: '2026-07-16T18:07:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T18:07:00+09:00'
captured_at: '2026-07-16T09:07:01.594Z'
owner_agent: codex-lead
captured_via: capture-cli
commit_after: c3f09c84e
commit_before: bf8d56a6c
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/visit-schedules/[id]/route.ts'
    - src/lib/auth/visit-schedule-access.ts
    - src/lib/api/route-catalog.ts
    - tools/route-auth-wrapper-allowlist.json
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/visit-schedules
    - src/lib/auth
    - src/lib/api
    - tools
ingested_via: put_page
ingested_at: '2026-07-16T09:07:02.252Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - phi-audit
  - visit-schedule
---

# Audit patient visit schedule detail reads

## Problem

- summary: Visit schedule detail GET is an org-scoped patient dashboard projection but used lifecycle `canVisit` permission and had no explicit PHI read audit.
- evidence: The detail response contains patient identity and operational safety summary plus visit record and preparation state; it resolves the canonical patient through the tenant case after access checks and returns no-store.

## Decision

- adopted: Move only `/api/visit-schedules/:id` GET to `canViewDashboard`, add one PHI read audit after successful response construction, and keep PATCH/DELETE on `canVisit`; split catalog and direct-auth inventory by method.
- reason: Clerks have org-wide read access under the current disclosure SSOT, while schedule update/cancel remain visit lifecycle mutations.

## Alternatives rejected

- Change permission without audit — the PHI-rich detail needs the same success-only read evidence as other patient detail projections.
- Move PATCH/DELETE — dashboard read permission must not authorize schedule lifecycle changes.
- Audit before case resolution or response construction — failed/not-found projections must remain audit zero.

## Migration

- from: GET, PATCH, and DELETE required `canVisit`; GET had no PHI read audit.
- to: GET requires `canViewDashboard` and records patient `visit_schedule_detail`; PATCH/DELETE retain `canVisit`.

## Verification

- Focused route/catalog 3 files / 99 tests and protected GET 384 tests passed.
- Success and clerk reads audit once; invalid ID, missing schedule, missing case, and error audit zero.
- Route-auth wrapper `147 routes / 212 calls / 0 new`, API authz, response shape, client schema, DTO, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: null; live plan review confirmed org-wide clerk access, canonical case patient resolution, no-store response, and method-separated mutations.

## Future rule candidate

- For PHI-rich schedule detail, build the response and resolve the canonical patient before firing one success-only read audit; never audit invalid, denied, missing, or failed reads.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-audited-patient-mcs-overview-read]]
- canonical: [[file:src/app/api/visit-schedules/[id]/route.ts]]
