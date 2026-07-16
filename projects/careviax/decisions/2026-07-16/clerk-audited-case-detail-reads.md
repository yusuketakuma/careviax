---
type: ImplementationDecision
title: Separate audited case reads from case mutations
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/cases/[id]/route.ts'
  - 'file:src/app/api/cases/[id]/risk-cockpit/route.ts'
  - 'file:tools/route-auth-wrapper-allowlist.json'
  - 'commit:7c4c45caf'
  - >-
    test:pnpm vitest run 'src/app/api/cases/[id]/route.test.ts'
    'src/app/api/cases/[id]/risk-cockpit/route.test.ts'
  - 'test:pnpm route-auth-wrapper:check'
  - 'test:pnpm typecheck'
created: '2026-07-16T17:15:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S8
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/clerk-audited-case-detail-reads
confidence: high
created_at: '2026-07-16T17:15:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T17:15:00+09:00'
owner_agent: codex-lead
commit_after: 7c4c45caf
commit_before: 0380726cc
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/cases/[id]/route.ts'
    - 'src/app/api/cases/[id]/risk-cockpit/route.ts'
    - tools/route-auth-wrapper-allowlist.json
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/cases
    - tools
ingested_via: put_page
ingested_at: '2026-07-16T08:15:50.244Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authz
  - case-read
  - clerk
  - codex
  - phi-audit
---

# Separate audited case reads from case mutations

## Problem

- summary: Case detail and case risk cockpit were assignment-aware ordinary dashboard reads with successful PHI audit, but still reused the clinical visit capability.
- evidence: Both GET handlers required `canVisit`; the case detail PATCH and risk-task sync remain mutations with separate execution semantics.

## Decision

- adopted: Gate case detail GET and risk cockpit GET with `canViewDashboard`, while preserving assignment-aware lookup, tenant context, sensitive no-store, and success-only patient PHI audit.
- reason: Approved clerk disclosure should not require visit execution authority, and the existing canonical success audit makes the read attributable without widening mutation or output boundaries.

## Alternatives rejected

- Move the case list in the same slice — the list spans multiple patients and needs an explicit bounded multi-patient audit contract first.
- Move case PATCH or risk-task sync — both mutate operational or clinical state and are not ordinary reads.
- Remove assignment or audit controls — role expansion does not replace patient scope or accountability.

## Migration

- from: Case detail and risk cockpit GET used `canVisit`.
- to: Those two GETs use `canViewDashboard`; case PATCH and risk-task sync retain `canVisit`.

## Verification

- Focused 2 files / 26 tests, route-auth wrapper `147 routes / 211 calls / 0 new`, API authz status, API response shape, client schema `364 / 0`, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: unavailable; codex2 pane was not available.

## Future rule candidate

- Open only canonical success-audited case reads to dashboard capability; design bounded multi-patient audit before migrating case lists.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/audit-clerk-patient-read-migration]]
- canonical: [[file:src/app/api/cases/[id]/route.ts]]
