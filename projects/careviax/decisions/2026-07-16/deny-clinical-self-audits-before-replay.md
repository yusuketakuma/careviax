---
type: ImplementationDecision
title: Deny clinical self-audits before terminal replay
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/dispense-audits/route.ts'
  - 'file:src/app/api/dispense-audits/route.test.ts'
  - 'file:src/app/api/set-audits/route.ts'
  - 'file:src/app/api/set-audits/route.test.ts'
  - 'commit:9c908623d316f6cca05e2f7f5cb18ac9ab85ab88'
  - >-
    test:pnpm exec vitest run src/app/api/dispense-audits/route.test.ts
    src/app/api/set-audits/route.test.ts
  - 'test:pnpm typecheck'
created: '2026-07-16T18:55:03+09:00'
task_id: AUTHZ-CLINICAL-AUDIT-ACTOR-001A
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/deny-clinical-self-audits-before-replay
confidence: high
created_at: '2026-07-16T09:55:03.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-16T09:55:03.000Z'
owner_agent: codex-lead
commit_after: 9c908623d316f6cca05e2f7f5cb18ac9ab85ab88
commit_before: 550ca58aa6d198905c1769909705f785ca76f758
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/dispense-audits/route.ts
    - src/app/api/dispense-audits/route.test.ts
    - src/app/api/set-audits/route.ts
    - src/app/api/set-audits/route.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/dispense-audits
    - src/app/api/set-audits
ingested_via: put_page
ingested_at: '2026-07-16T09:57:43.961Z'
source_kind: put_page
tags:
  - accepted
  - authorization
  - clinical-audit
  - codex
  - patient-safety
  - separation-of-duties
  - stability
---

# Deny clinical self-audits before terminal replay

## Problem

- summary: Classic dispense and set audit mutations allowed the same actor to perform and approve their own work when that actor supplied a reason and held an admin membership.
- evidence: The exception path treated the acting subject's own admin membership as approval; set audits also skipped detection when cell details were omitted.

## Decision

- adopted: Detect actor-owned dispense results or set batches before terminal replay and reject the mutation with one stable self-audit contract regardless of reason, admin role, cell details, or an existing terminal audit.
- reason: The approved account model requires separation of duties and keeps any distinct-approver exception unavailable until medical, legal, and operations ratification.

## Alternatives rejected

- Keep reason plus same-actor admin approval: rejected because execution, review, and approval remain the same subject.
- Design a second-approver exception in this slice: rejected because approver identity, qualification, TTL, reason, and evidence rules remain human-gated.

## Migration

- from: same-actor reason and admin-membership exception
- to: fail-closed self-audit denial before replay or writes

## Verification

- focused Vitest passed 2 files / 71 tests, including admin/reason, missing cell details, terminal replay, zero-side-effect denial, and normal two-person audit behavior.
- exact ESLint, Prettier, diff check, route-auth, API authorization/response, client schema, DTO, and full typecheck gates passed.
- independent read-only diff review approved the ordering, denial invariants, and unchanged permission/schema boundary.

## Review

- reviewer: codex-lead; result: approved as fail-closed slice 001A. Canonical qualification, PHOS actions, and any distinct-approver exception remain human-gated.

## Future rule candidate

- Clinical self-audit denial must execute before terminal replay and before any mutation, audit, transition, or notification side effect.

## Links

- canonical: [[file:src/app/api/dispense-audits/route.ts]]
- canonical: [[file:src/app/api/set-audits/route.ts]]
