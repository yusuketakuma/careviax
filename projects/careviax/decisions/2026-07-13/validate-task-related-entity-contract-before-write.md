---
type: ImplementationDecision
title: Validate task related-entity contracts before write-side work
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/lib/tasks/task-related-entity.ts'
  - 'file:src/app/api/tasks/route.ts'
  - 'commit:38ed665ea'
  - >-
    test:TZ=UTC pnpm exec vitest run src/lib/tasks/task-related-entity.test.ts
    src/app/api/tasks/route.test.ts
task_id: API-TASK-RELATED-ENTITY-CONTRACT-001
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: >-
  projects/careviax/decisions/2026-07-13/validate-task-related-entity-contract-before-write
confidence: high
created_at: '2026-07-13T11:07:49.000Z'
created_by: codex-lead
dedupe_key: 6f90642aee2297a629b08c20ff8674f11488cc386ed0c6e8e4b3cd9432c866b2
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-13T11:07:49.000Z'
captured_at: '2026-07-13T11:09:05.931Z'
owner_agent: codex-lead
captured_via: capture-cli
commit_after: 38ed665ea
commit_before: 6f60b6663a4472168ee50983db0d151197b2b125
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/lib/tasks/task-related-entity.ts
    - src/app/api/tasks/route.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Zod
    - Prisma
  directories:
    - src/lib/tasks
    - src/app/api/tasks
ingested_via: put_page
ingested_at: '2026-07-13T11:09:06.869Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authorization
  - codex
  - contract
  - tasks
---

# Validate task related-entity contracts before write-side work

## Problem

- The task registry defined `allowedRelatedEntityTypes`, but generic task creation only checked whether the task type was registered.
- A complete but disallowed related-entity tuple, or a half-specified tuple, could reach assignment scope and write preparation before rejection.

## Decision

- Resolve canonical and legacy task types through one registry-backed evaluator.
- Accept either no related entity or a complete, nonblank, allowlisted type and ID pair.
- Reject unknown task types first, preserve the dedicated handoff-flow gate second, then reject related-entity contract violations before assignment, membership, display-ID, RLS, or Task writes.
- Keep context-free creation valid for registered task types whose related entity is optional.

## Alternatives rejected

- Duplicating a route-local task type matrix was rejected because it would drift from the task registry and canonical aliases.
- Treating a disallowed tuple as a later assignment-scope failure was rejected because it performs unnecessary scoped reads and obscures the input contract.

## Migration

- from: route-only registered-type check
- to: shared registry-backed related-entity evaluator plus route contract tests

## Verification

- Focused task route/evaluator tests: 2 files / 80 tests passed.
- Task registry tests: 2 files / 11 tests passed.
- Full Vitest, typecheck, no-unused, API shape, route auth, task registry, lint, format, and Next build passed at integration.

## Review

- Independent security review and codex1 integration review approved the rejection order and zero-write boundary.

## Future rule candidate

- Enforce registry metadata at the first write boundary with the same resolver used for canonical and legacy identifiers.

## Links

- canonical: [[file:src/lib/tasks/task-related-entity.ts]]
