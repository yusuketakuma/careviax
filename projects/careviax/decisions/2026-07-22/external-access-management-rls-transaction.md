---
type: ImplementationDecision
title: External access management uses explicit tenant transactions
memory_id: projects/careviax/decisions/2026-07-22/external-access-management-rls-transaction
project_id: careviax
repo_url: https://github.com/yusuketakuma/careviax.git
branch: codex1/continuous-optimization-20260716
commit_before: e3ca0307c
commit_after: e72b0b527
task_id: RLS-EXTERNAL-ACCESS-MANAGEMENT-001
feature_id: null
created_at: 2026-07-22T14:45:56+09:00
updated_at: 2026-07-22T14:45:56+09:00
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: codex-lead
source:
  - file:src/app/api/external-access/route.ts
  - file:src/lib/api/org-reference.ts
  - commit:e8a89788b
  - commit:d77cf44c7
  - commit:24843502b
  - commit:419c6048e
  - commit:e72b0b527
  - test:pnpm vitest run external-access focused suites
  - test:pnpm rls-policy-contract:check
confidence: high
evidence_level: peer_reviewed
validity_scope:
  repo: careviax
  directories: [src/app/api/external-access, src/lib/api]
  files: [src/app/api/external-access/route.ts, src/lib/api/org-reference.ts]
  tech_stack: [Next.js, TypeScript, Prisma, PostgreSQL, RLS]
expires_at: null
superseded_by: null
tags: [external-access, api, rls, security, concurrency, prisma, codex, accepted]
---

# External access management uses explicit tenant transactions

## Problem

- Management GET and POST precondition reads used the global Prisma client. FORCE RLS application roles require transaction-local tenant context, so an `org_id` predicate alone could fail with missing RLS context.
- POST checked patient, archive, case, and consent state before a separate write transaction, leaving a time-of-check/time-of-use gap.

## Decision

- Route-local data helpers require an explicit transaction client and have no global fallback.
- GET performs cursor validation, visible grant selection, patient enrichment, and self-report aggregates sequentially in one request-context-bound Repeatable Read transaction.
- POST performs a cheap tenant preflight before bcrypt, then revalidates the same conditions authoritatively inside the Serializable create, token-update, and audit transaction.
- Serializable conflict P2034 is bounded to two attempts (one retry). Exhaustion returns a fixed no-store 409. SMS remains outside the transaction and runs only after a successful commit.
- `validateOrgReferences` keeps two-argument compatibility but accepts an explicit third database client; every internal delegate uses the injected client.

## Alternatives rejected

- Keeping global Prisma with `org_id` filters: FORCE RLS still lacks transaction context.
- Catching RLS failures as empty results: this would hide infrastructure failure as an authorization result.
- Hashing inside the database transaction: bcrypt would hold the interactive transaction open.
- One non-authoritative preflight followed by unchecked write: this preserves the TOCTOU gap.

## Verification

- external-access route, org-reference, and service suites: 6 files / 102 tests pass
- final route suites: 42 tests pass, including commit-time P2034 and non-P2034 propagation
- RLS policy contract: 24 tests pass
- exact ESLint, Prettier, boundaries, typecheck, and typecheck:no-unused pass
- actual NOBYPASSRLS nonempty and cross-tenant proof remains pending because the dedicated proof database URLs are unavailable

## Future rule candidate

- A FORCE RLS route must pass an explicit transaction client through every helper; an organization predicate is defense in depth, not a substitute for tenant context.
