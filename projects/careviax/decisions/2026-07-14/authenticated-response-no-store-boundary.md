---
type: ImplementationDecision
title: Centralize authenticated response no-store at the shared auth boundary
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/lib/auth/context.ts'
  - 'file:src/lib/auth/context.test.ts'
  - 'commit:ef25ef69588afd546bf6b8cd3b2ac36bbcb8f951'
  - 'test:pnpm vitest run --reporter=dot --testTimeout=30000'
  - 'test:pnpm build'
task_id: API-CONTRACT-001FZAUTHNOSTORE
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: >-
  projects/careviax/decisions/2026-07-14/authenticated-response-no-store-boundary
confidence: high
created_at: '2026-07-13T17:49:57.000Z'
created_by: codex-lead
dedupe_key: bf6e0655bd904b547d6549c38ef04913b85a645852f7bb098d59f0b7e211b81e
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-13T17:49:57.000Z'
owner_agent: codex-lead
commit_after: ef25ef69588afd546bf6b8cd3b2ac36bbcb8f951
commit_before: 784c52cf0a80d9aacc222627076e33410c141d86
superseded_by: null
evidence_level: gate_verified
memory_quality:
  gate: 5
  risk: 0
  reuse: 5
  total: 20
  recency: 5
  evidence: 5
  peer_agreement: 0
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/lib/auth/context.ts
    - src/lib/auth/context.test.ts
  tech_stack:
    - Next.js
    - TypeScript
  directories:
    - src/lib/auth
    - src/app/api
ingested_via: put_page
ingested_at: '2026-07-13T17:50:37.743Z'
source_kind: put_page
tags:
  - accepted
  - api
  - auth
  - codex
  - nextjs
  - phi
  - security
  - typescript
---

# Centralize authenticated response no-store at the shared auth boundary

## Problem

- Protected API responses depended on route-local cache headers, so omissions could leave authenticated operational or PHI-bearing responses cacheable.
- Direct `requireAuthContext` callers also received 401/403 responses without a cache guarantee from the auth helper itself.
- Evidence: 195 `withAuthContext` callsites across 144 route files and 251 direct auth calls across 175 route files.

## Decision

- Adopted: apply `withSensitiveNoStore` inside `requireAuthContext` for authentication and authorization failures, and inside `withAuthContext` for handler success, known errors, and sanitized unexpected 500 responses.
- Reason: the common auth boundary is the smallest fail-closed enforcement point and prevents route omissions while preserving response bodies, status codes, custom headers, authorization checks, security events, logging, and route performance measurement.

## Alternatives rejected

- Add headers route by route: rejected because the omission risk would remain distributed across protected routes.
- Enforce only on successful responses: rejected because authentication and authorization failures can also contain sensitive operational context and need the same cache boundary.

## Migration

- From: route-local no-store responsibility for wrapper-backed responses.
- To: shared auth-boundary enforcement, with route-local calls remaining harmless and idempotent.
- Remaining: 25 direct-auth routes still need their successful responses audited because they bypass `withAuthContext`.

## Verification

- Focused auth and no-store tests: pass.
- Full Vitest: 1554 files and 16237 tests passed; 3 files and 13 tests skipped.
- Typecheck and no-unused typecheck: pass.
- Next.js production build: pass, including 311 static pages.
- API shape, authorization, route-auth, client-schema, raw-org, module-boundary, frontend-contract, lint, format, and PHI client checks: pass.

## Review

- Reviewer: none; current repository operation is single Codex.
- Result: accepted after full local gates.

## Future rule candidate

- Any shared authenticated API wrapper must enforce sensitive no-store on every returned response class; direct-auth success paths require a separate success-response audit.

## Links

- canonical: [[file:src/lib/auth/context.ts]]
