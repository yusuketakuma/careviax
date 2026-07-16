---
type: ImplementationDecision
title: Await application secrets before Node request readiness
task_id: OPS-SECRET-BOOTSTRAP-READINESS-001
memory_id: projects/careviax/decisions/2026-07-16/awaited-secret-startup-barrier
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 29ac08c0d
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/instrumentation.ts
    - src/instrumentation.node.ts
  directories:
    - src/lib/config
    - src/lib/db
    - src/lib/auth
    - src/app/api/health
ingested_via: put_page
ingested_at: '2026-07-16T03:16:44.538Z'
source_kind: put_page
tags:
  - accepted
  - aws-secrets-manager
  - codex1
  - readiness
  - runtime
  - security
  - startup
---

# Await application secrets before Node request readiness

## Problem

- summary: Prisma and NextAuth could synchronously bind environment secrets before fire-and-forget Secrets Manager hydration completed.
- evidence: src/lib/db/client.ts, src/lib/auth/config.ts

## Decision

- adopted: Use the awaited Next.js Node instrumentation register barrier as the single strict startup bootstrap. Secrets Manager requires explicit configuration, existing environment values win, and missing, invalid, expired, timeout, or provider failures reject startup without secret-bearing logs.
- reason: Next.js completes instrumentation registration before serving requests, eliminating the cold-start race while preserving AWS-free local development and env-only deployments.

## Alternatives rejected

- Keep module-evaluation fire-and-forget hydration — synchronous DB/Auth consumers can win the race and bind missing values.
- Infer Secrets Manager from APP_ENV alone — env-only production becomes an accidental AWS dependency.
- Continue after provider failure — readiness would be false-green and could admit traffic with incomplete auth or job secrets.

## Migration

- from: [src/lib/db/client.ts, src/lib/auth/config.ts] -> to: [src/instrumentation.node.ts, src/lib/config/secrets.ts]

## Verification

- focused Vitest 5 files / 46 tests, scoped ESLint, Prettier, Plans active board, diff check, full typecheck, and full no-unused typecheck passed.

## Review

- reviewer: codex2 unavailable in the current tmux session; result: not independently reviewed. Official Next.js and AWS contracts plus local gates passed.

## Future rule candidate

- Any asynchronous runtime configuration required by synchronous consumers must complete in an awaited startup barrier before request readiness.

## Links

- canonical: [[file:src/instrumentation.node.ts]]
- canonical: [[file:src/lib/config/secrets.ts]]
