---
type: project
title: Pharmacy Invoice Transition Idempotency
ingested_via: put_page
ingested_at: '2026-07-16T00:26:33.550Z'
source_kind: put_page
---

---

type: ImplementationDecision
title: Pharmacy invoice transitions use durable intent and version CAS
memory_id: projects/careviax/decisions/2026-07-16/pharmacy-invoice-transition-idempotency
project_id: careviax
repo_url: null
branch: codex1/continuous-optimization-20260716
commit_before: 0f57674ca7860f19b7b222558226a9aa216e87a2
commit_after: null
task_id: BILLING-PARTNER-INVOICE-TRANSITION-IDEMPOTENCY-001
feature_id: null
created_at: 2026-07-16T00:26:02Z
updated_at: 2026-07-16T00:26:02Z
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: null
source:

- file:prisma/schema/pharmacy-partnership.prisma
- file:src/app/api/pharmacy-invoices/[id]/route.ts
- file:src/server/services/pharmacy-invoices.ts
- test:pnpm exec vitest run pharmacy invoice focused suite
- test:pnpm typecheck:no-unused
- test:pnpm rls-policy-contract:check
  confidence: high
  evidence_level: gate_verified
  validity_scope:
  repo: careviax
  directories: [prisma, src/app/api/pharmacy-invoices, src/server/services]
  files: [prisma/schema/pharmacy-partnership.prisma, src/app/api/pharmacy-invoices/[id]/route.ts, src/server/services/pharmacy-invoices.ts]
  tech_stack: [Next.js, React, TypeScript, Prisma, PostgreSQL]
  expires_at: null
  superseded_by: null
  dedupe_key: b547a2f7a02085655e4af8d17f47eb22eccde75e0ddd3937f0fe979e1ecceab4
  tags: [billing, idempotency, concurrency, prisma, rls, codex-lead, accepted]

---

# Pharmacy invoice transitions use durable intent and version CAS

## Problem

- summary: Status-only CAS cannot serialize same-status reissue, and response loss can repeat revision and audit side effects.
- evidence: `src/server/services/pharmacy-invoices.ts`, `src/app/api/pharmacy-invoices/[id]/route.ts`

## Decision

- adopted: Persist one tenant-RLS intent keyed by org, route, invoice, and hashed idempotency key. Bind it to a normalized request fingerprint and original result. Require expected invoice version for every transition, increment it in the guarded write, and retry P2002/P2034 conflicts at most three times with the same intent.
- reason: The database transaction becomes the exact-once boundary for invoice revision, lifecycle snapshot, result replay, and audit; process-local dedupe and status-only guards cannot provide this guarantee.

## Alternatives rejected

- Status-only CAS — reissue preserves status and permits duplicate effects.
- Process-local request cache — does not survive restart or cross-instance retries.
- New idempotency key per retry — cannot replay the committed result after response loss.

## Migration

- from: status-only guarded lifecycle update → to: durable transition intent plus expected-version CAS and stable client retry key.

## Verification

- Focused route, service, client, and DB-contract tests passed.
- Prisma schema validation, migration application through 165 migrations, RLS policy contract, NOBYPASSRLS proof, client JSON schema check, exact ESLint, and no-unused typecheck passed.

## Review

- reviewer: codex-lead · result: self-reviewed; independent codex2 review remains optional under the active two-seat workflow.

## Future rule candidate

- Same-status financial transitions require a durable intent and version CAS; status alone is never a concurrency token.

## Links

- canonical: [[file:src/server/services/pharmacy-invoices.ts]]
