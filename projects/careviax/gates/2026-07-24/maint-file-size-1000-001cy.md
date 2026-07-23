---
type: GateResult
title: MAINT-FILE-SIZE-1000-001CY tasks collection route test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/tasks/route.test.ts'
  - 'file:src/app/api/tasks/fixtures/route.test-support.ts'
  - 'file:src/app/api/tasks/fixtures/route-get.cases.ts'
  - 'file:src/app/api/tasks/fixtures/route-post.cases.ts'
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'file:tools/authz-account-model-v1/inventory.json'
  - 'commit:495c42f0770c581f183db76967867c9c68d4b6a2'
  - 'test:tasks-collection-route-focused'
created: '2026-07-23T16:43:23.000Z'
task_id: MAINT-FILE-SIZE-1000-001CY
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/gates/2026-07-24/maint-file-size-1000-001cy
confidence: high
created_at: '2026-07-23T16:43:23.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T16:43:23.000Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 495c42f0770c581f183db76967867c9c68d4b6a2
ingested_via: put_page
commit_before: be670eee4
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/app/api/tasks/route.test.ts
    - src/app/api/tasks/fixtures/route.test-support.ts
    - src/app/api/tasks/fixtures/route-get.cases.ts
    - src/app/api/tasks/fixtures/route-post.cases.ts
    - tools/human-maintained-file-size-baseline.json
    - tools/authz-account-model-v1/inventory.json
  tech_stack:
    - Next.js
    - TypeScript
    - Vitest
  directories:
    - src/app/api/tasks
ingested_at: '2026-07-23T16:44:53.152Z'
tags:
  - accepted
  - authz-inventory
  - codex
  - file-size
  - maintainability
  - tasks
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001CY tasks collection route test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved hoisted route mocks and shared beforeEach registration into a fixture-scoped support module.
- Split collection GET and POST cases into registration modules while retaining one canonical describe and the original test registration order.
- Reduced the canonical test from 1387 to 10 lines. The support, GET, and POST modules are 150, 564, and 718 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 120 to 119.

## Commands

- focused tasks collection route Vitest: pass, 1 file / 69 tests.
- exact pre/post executable body parity excluding only the formatter-removed GET/POST seam blank line: SHA-256 `77dd1a273837f840e6626809d2e66660808a0f15f0357a385d707da66061acbc`.
- human-maintained file-size gate: pass, 4407 files / 119 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized after the final fixture move.
- authz inventory: pass, 972 entries / 477 browser assets / 381 scenarios / 665 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing permission, assignment-scope, archived-patient, no-store, error-sanitization, role-eligibility, and write-start assertions all passed. No runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 69 GET/POST cases and reduced the ratcheted baseline without product, PHI, network, database, dependency, or runtime changes.

## Links

- canonical: [[file:src/app/api/tasks/route.test.ts]]
- support: [[file:src/app/api/tasks/fixtures/route.test-support.ts]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
- inventory: [[file:tools/authz-account-model-v1/inventory.json]]
