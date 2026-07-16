---
type: ImplementationDecision
title: Separate patient MCS overview reads from MCS operations
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/patients/[id]/mcs/route.ts'
  - 'file:src/server/services/patient-mcs.ts'
  - 'file:src/lib/api/route-catalog.ts'
  - 'file:tools/route-auth-wrapper-allowlist.json'
  - 'commit:1df162430'
  - >-
    test:pnpm vitest run 'src/app/api/patients/[id]/mcs/route.test.ts'
    src/lib/api/route-catalog.test.ts
    src/app/api/meta/route-catalog/route.test.ts
  - 'test:pnpm vitest run src/app/api/__tests__/protected-get-routes.test.ts'
  - 'test:pnpm typecheck'
created: '2026-07-16T18:01:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S13
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/clerk-audited-patient-mcs-overview-read
confidence: high
created_at: '2026-07-16T18:01:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T18:01:00+09:00'
captured_at: '2026-07-16T09:01:10.324Z'
owner_agent: codex-lead
captured_via: capture-cli
commit_after: 1df162430
commit_before: 6e17b0fa4
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patients/[id]/mcs/route.ts'
    - src/server/services/patient-mcs.ts
    - src/lib/api/route-catalog.ts
    - tools/route-auth-wrapper-allowlist.json
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/patients
    - src/server/services
    - src/lib/api
    - tools
ingested_via: put_page
ingested_at: '2026-07-16T09:01:10.993Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - mcs
  - phi-audit
---

# Separate patient MCS overview reads from MCS operations

## Problem

- summary: The assigned-patient MCS overview GET was a success-audited internal dashboard read but shared `canVisit` authorization code with profile PATCH.
- evidence: The route validates the patient assignment before loading a bounded MCS overview, uses tenant RLS for link, summary, message, check-log, and profile reads, returns no-store, and records one patient PHI read audit only after a successful projection.

## Decision

- adopted: Move only `/api/patients/:id/mcs` GET to `canViewDashboard`; keep PATCH, MCS sync, and MCS logs on `canVisit`; split direct auth and catalog entries by method.
- reason: Authorized clerks need the saved internal MCS messages, summary, and participation context for ordinary patient work, while synchronization and profile mutation remain operational actions.

## Alternatives rejected

- Grant `canVisit` to clerks — this would open unrelated visit and clinical mutations.
- Move PATCH or sync — dashboard read permission must not update profile tasks, write audit changes, or invoke external synchronization.
- Move all MCS routes together — logs and sync have different purpose and side-effect boundaries.

## Migration

- from: MCS GET and PATCH shared one direct `canVisit` auth call.
- to: GET directly requires `canViewDashboard`; PATCH directly requires `canVisit`; shared code only validates sensitive-display role and route ID.

## Verification

- Focused route/catalog 3 files / 25 tests and protected GET 384 tests passed.
- Route-auth wrapper `147 routes / 212 calls / 0 new`, API authz, response shape, client schema, DTO, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: null; live plan review compared MCS overview with visit preparation and schedule detail and selected the bounded single-patient read.

## Future rule candidate

- When a mixed route shares an auth helper, keep method-specific `requireAuthContext` calls explicit so static auth inventory can prove the read/write split.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-sanitized-qr-draft-detail-read]]
- canonical: [[file:src/app/api/patients/[id]/mcs/route.ts]]
