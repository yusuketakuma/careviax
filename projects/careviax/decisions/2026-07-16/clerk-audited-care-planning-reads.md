---
type: ImplementationDecision
title: Separate audited care planning reads from mutations
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/interventions/[id]/route.ts'
  - 'file:src/app/api/management-plans/[id]/route.ts'
  - 'file:src/lib/api/route-catalog.ts'
  - 'file:tools/route-auth-wrapper-allowlist.json'
  - 'commit:9e803f357'
  - 'commit:81862ed06'
  - >-
    test:pnpm vitest run 'src/app/api/interventions/[id]/route.test.ts'
    'src/app/api/management-plans/[id]/route.test.ts'
    src/lib/api/route-catalog.test.ts
    src/app/api/meta/route-catalog/route.test.ts
  - 'test:pnpm route-auth-wrapper:check'
  - 'test:pnpm typecheck'
created: '2026-07-16T17:26:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S9
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/clerk-audited-care-planning-reads
confidence: high
created_at: '2026-07-16T17:26:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T17:26:00+09:00'
owner_agent: codex-lead
commit_after: 81862ed06
commit_before: 448a7d119
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/interventions/[id]/route.ts'
    - 'src/app/api/management-plans/[id]/route.ts'
    - src/lib/api/route-catalog.ts
    - tools/route-auth-wrapper-allowlist.json
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/interventions
    - src/app/api/management-plans
    - src/lib/api
    - tools
ingested_via: put_page
ingested_at: '2026-07-16T08:26:46.418Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authz
  - care-planning
  - clerk
  - codex
  - phi-audit
---

# Separate audited care planning reads from mutations

## Problem

- summary: Intervention detail and management plan detail were assignment-aware ordinary dashboard reads with successful PHI audit, but still reused the clinical visit capability.
- evidence: Both GET handlers required `canVisit`; their colocated PATCH handlers mutate intervention or management-plan state.

## Decision

- adopted: Gate intervention detail GET and management plan detail GET with `canViewDashboard`, preserving canonical patient success-only PHI audit, assignment/org scope, and no-store. Keep both PATCH handlers on `canVisit` and catalog each method explicitly.
- reason: Approved clerk disclosure should not require mutation authority, while clinical updates, approval, archive, and intervention edits remain execution boundaries.

## Alternatives rejected

- Move list GETs in the same slice — multi-patient read audit semantics require separate design.
- Move management-plan PDF — external/output rendering remains a distinct boundary.
- Move PATCH handlers — read permission must not authorize clinical state mutation.

## Migration

- from: Two detail GETs and their PATCH handlers shared `canVisit`.
- to: Detail GETs use `canViewDashboard`; PATCH handlers remain `canVisit`; route catalog records the method split.

## Verification

- Focused route and catalog 4 files / 44 tests plus catalog follow-up 2 files / 11 tests, route-auth wrapper `147 routes / 211 calls / 0 new`, API authz status, API response shape, client schema `364 / 0`, DTO gate `30 / 0 new`, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: read-only review found the missing intervention detail catalog entries; fixed in `81862ed06`.

## Future rule candidate

- Catalog every method when a mixed GET/mutation route is split across dashboard-read and execution capabilities.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-audited-case-detail-reads]]
- canonical: [[file:src/app/api/interventions/[id]/route.ts]]
