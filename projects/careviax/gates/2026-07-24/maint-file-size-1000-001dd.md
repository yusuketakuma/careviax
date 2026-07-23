---
type: GateResult
title: MAINT-FILE-SIZE-1000-001DD set batch generation route test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/set-plans/[id]/generate-batches/route.test.ts'
  - >-
    file:src/app/api/set-plans/[id]/generate-batches/fixtures/route.test-support.ts
  - >-
    file:src/app/api/set-plans/[id]/generate-batches/fixtures/route-guard-reuse.cases.ts
  - >-
    file:src/app/api/set-plans/[id]/generate-batches/fixtures/route-generation.cases.ts
  - >-
    file:src/app/api/set-plans/[id]/generate-batches/fixtures/route-concurrency.cases.ts
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'file:tools/authz-account-model-v1/inventory.json'
  - 'commit:6783bda60cfdd06ff5085b63b5c1b9f3a6d87aab'
  - 'test:set-plan-generate-batches-focused'
created: '2026-07-23T18:01:30.000Z'
task_id: MAINT-FILE-SIZE-1000-001DD
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/gates/2026-07-24/maint-file-size-1000-001dd
confidence: high
created_at: '2026-07-23T18:01:30.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T18:01:30.000Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 6783bda60cfdd06ff5085b63b5c1b9f3a6d87aab
ingested_via: put_page
commit_before: 5fd651d83bdefb335bbd6cb4bcb9eab12d97fd92
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/set-plans/[id]/generate-batches/route.test.ts'
    - 'src/app/api/set-plans/[id]/generate-batches/fixtures/route.test-support.ts'
    - >-
      src/app/api/set-plans/[id]/generate-batches/fixtures/route-guard-reuse.cases.ts
    - >-
      src/app/api/set-plans/[id]/generate-batches/fixtures/route-generation.cases.ts
    - >-
      src/app/api/set-plans/[id]/generate-batches/fixtures/route-concurrency.cases.ts
    - tools/human-maintained-file-size-baseline.json
    - tools/authz-account-model-v1/inventory.json
  tech_stack:
    - Next.js
    - TypeScript
    - Vitest
    - Prisma
  directories:
    - 'src/app/api/set-plans/[id]/generate-batches'
ingested_at: '2026-07-23T18:01:52.550Z'
tags:
  - accepted
  - authz-inventory
  - codex
  - file-size
  - maintainability
  - set-plan
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001DD set batch generation route test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved hoisted auth/RLS/service mocks, request builders, serializable-conflict construction, and common setup into an explicit fixture-scoped support module.
- Split the original ordered cases into guard/reuse, quantity/packaging generation, and concurrent-create/serializable-retry registration modules.
- Reduced the canonical test from 1485 to 12 lines. The support and three case modules are 196, 447, 595, and 314 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 115 to 114.
- Reprojected one test authz contract into three fixture contracts, increasing non-runtime contracts from 669 to 671 without changing runtime surface entries or browser assets.

## Commands

- focused generate-batches route Vitest: pass, 1 file / 27 tests.
- normalized pre/post case-body parity across all three extracted groups: SHA-256 `720b84f4a91e0903fc5a69a0b5c49f13e3d6bc14cccf6ddff74d44b30fb7c882`.
- human-maintained file-size gate: pass, 4426 files / 114 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized.
- authz inventory: pass, 972 entries / 479 browser assets / 381 scenarios / 671 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.

## Failure evidence

- The initial guard-case extraction omitted its direct Prisma runtime import and failed one focused assertion path with `ReferenceError: Prisma is not defined`. Restoring the exact case-local Prisma import returned the suite to 27/27.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing auth context, assignment scope, tenant RLS, OCC, serializable retry, audit-ready state, PHI-safe error, latest-intake, audited-result, packaging, narcotic, duplicate prevention, and no-store assertions all passed. No product runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 27 clinical generation cases and reduced the ratcheted baseline without product, PHI, network, database, dependency, or runtime changes.

## Links

- canonical: [[file:src/app/api/set-plans/[id]/generate-batches/route.test.ts]]
- support: [[file:src/app/api/set-plans/[id]/generate-batches/fixtures/route.test-support.ts]]
- route: [[file:src/app/api/set-plans/[id]/generate-batches/route.ts]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
- inventory: [[file:tools/authz-account-model-v1/inventory.json]]
