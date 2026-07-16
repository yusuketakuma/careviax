---
type: ImplementationDecision
title: Separate visit record detail from audit-diff governance
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/visit-records/[id]/route.ts'
  - 'file:src/lib/api/route-catalog.ts'
  - 'file:tools/route-auth-wrapper-allowlist.json'
  - 'commit:229e2410f'
  - >-
    test:pnpm vitest run 'src/app/api/visit-records/[id]/route.test.ts'
    src/lib/api/route-catalog.test.ts
    src/app/api/meta/route-catalog/route.test.ts
  - 'test:pnpm route-auth-wrapper:check'
  - 'test:pnpm typecheck'
created: '2026-07-16T17:41:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S11
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/clerk-audited-visit-record-detail-read
confidence: high
created_at: '2026-07-16T17:41:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T17:41:00+09:00'
owner_agent: codex-lead
commit_after: 229e2410f
commit_before: b1463ba06
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/visit-records/[id]/route.ts'
    - src/lib/api/route-catalog.ts
    - tools/route-auth-wrapper-allowlist.json
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/visit-records
    - src/lib/api
    - tools
ingested_via: put_page
ingested_at: '2026-07-16T08:40:59.858Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - phi-audit
  - visit-record
---

# Separate visit record detail from audit-diff governance

## Problem

- summary: Visit record detail was an assignment-aware, success-audited ordinary dashboard GET but shared `canVisit` with PATCH. A neighboring reflected-fields GET exposes old/new patient-field revision history and belongs to a stricter audit-diff boundary.
- evidence: Visit detail records canonical patient audit after the full projection succeeds; reflected-fields returns revision values and remains separately authorized.

## Decision

- adopted: Move only `/api/visit-records/:id` GET to `canViewDashboard`, keep PATCH on `canVisit`, and split the catalog/allowlist by method. Leave reflected-fields, PDF, handoff, stock observation, and other visit execution/output routes unchanged.
- reason: Clerk ordinary disclosure includes the visit detail, while change-history governance and mutations must not be opened merely because values are privacy-masked.

## Alternatives rejected

- Move reflected-fields with the detail — privacy masking is not authorization and Plans keeps audit diff separate.
- Move PATCH — dashboard read permission must not authorize visit-record mutation.
- Move PDF or handoff — output and execution are separate boundaries.

## Migration

- from: Visit detail GET and PATCH shared `canVisit`.
- to: GET uses `canViewDashboard`; PATCH remains `canVisit`; reflected-fields remains `canVisit`.

## Verification

- Focused route/catalog 3 files / 47 tests, route-auth wrapper `147 routes / 211 calls / 0 new`, API authz/response, client schema, DTO gate, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: read-only review narrowed the slice to exclude reflected-fields; implementation follows that boundary.

## Future rule candidate

- Treat old/new field revision and audit-diff views as governance data, not ordinary dashboard reads, even when values are masked.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/patient-duplicate-search-aggregate-audit]]
- canonical: [[file:src/app/api/visit-records/[id]/route.ts]]
