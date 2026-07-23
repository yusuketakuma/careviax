---
type: FailurePattern
title: Vitest mock support must load before an SUT-importing helper
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/tasks/fixtures/route.test-support.ts'
  - 'file:src/app/api/tasks/fixtures/route-get.cases.ts'
  - 'file:src/app/api/tasks/fixtures/route-post.cases.ts'
  - 'file:src/app/api/tasks/route.test-helpers.ts'
  - 'commit:495c42f0770c581f183db76967867c9c68d4b6a2'
  - 'test:tasks-collection-route-focused'
created: '2026-07-23T16:43:23.000Z'
task_id: MAINT-FILE-SIZE-1000-001CY
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/failures/2026-07-24/vitest-support-first-sut-import-order
confidence: high
created_at: '2026-07-23T16:43:23.000Z'
created_by: codex-lead
dedupe_key: 0d729f2ef3d8035817f1af9e42cadcf6ef1a1f1f67384692d929862da979ed26
expires_at: null
feature_id: null
project_id: careviax
times_seen: 1
updated_at: '2026-07-23T16:43:23.000Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 495c42f0770c581f183db76967867c9c68d4b6a2
ingested_via: put_page
commit_before: be670eee4
superseded_by: null
evidence_level: tested
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/app/api/tasks/fixtures/route.test-support.ts
    - src/app/api/tasks/fixtures/route-get.cases.ts
    - src/app/api/tasks/fixtures/route-post.cases.ts
    - src/app/api/tasks/route.test-helpers.ts
  tech_stack:
    - TypeScript
    - Vitest
  directories:
    - src/app/api/tasks
ingested_at: '2026-07-23T16:44:55.293Z'
tags:
  - codex
  - esm
  - failure-pattern
  - maintainability
  - mocking
  - test
  - vitest
---

# Vitest mock support must load before an SUT-importing helper

## Symptom

- After splitting one Vitest file, 64 of 69 route cases returned the shared sanitized 500 response instead of their expected status.
- The run emitted the real auth wrapper error event, showing that the intended test mock had not wrapped the route.

## Root cause

- Each case module imported `route.test-helpers.ts`, which imports the route SUT, before importing the module that owns `vi.hoisted` and `vi.mock` registrations.
- ESM dependency evaluation loaded the SUT before the mock-owning support module, so import order inside the original monolith was not preserved by the split.

## Bad fix

- Do not loosen assertions, accept sanitized 500 responses, duplicate mocks in every case module, or disable module isolation.

## Good fix

- In every extracted case module, import the mock-owning support module before any helper or module that imports the SUT.
- Keep support under a fixture boundary when it contains test-only role or override literals so authorization discovery classifies it as a non-runtime contract.
- Re-run the canonical focused test after the final file move; import resolution alone does not prove that the intended mocks execute.

## Applies to

- patterns: Vitest hoisted mocks, ESM test splits, helper modules that re-export or wrap SUT handlers
- directories: `src/app/api`, `src/server`

## Evidence

- first split run: 5 passed / 64 failed, with route responses collapsing to sanitized 500.
- support-first import fix: 69 passed / 69 total.
- final implementation: commit `495c42f0770c581f183db76967867c9c68d4b6a2`.

## Tests to run

- canonical focused Vitest path
- exact ESLint and Prettier for support and case modules
- `pnpm typecheck`
- `pnpm typecheck:no-unused`
- `pnpm authz-account-model-v1:inventory:check`
