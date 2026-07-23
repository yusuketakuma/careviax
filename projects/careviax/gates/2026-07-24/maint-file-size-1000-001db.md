---
type: GateResult
title: MAINT-FILE-SIZE-1000-001DB notification service test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/server/services/notifications.test.ts'
  - >-
    file:src/server/services/notifications/fixtures/notifications.test-support.ts
  - 'file:src/server/services/notifications/fixtures/notifications-core.cases.ts'
  - >-
    file:src/server/services/notifications/fixtures/notifications-delivery-routing.cases.ts
  - >-
    file:src/server/services/notifications/fixtures/notifications-durable-delivery.cases.ts
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'file:tools/authz-account-model-v1/inventory.json'
  - 'commit:8744cf46aadb0d7f9ea9d35424949b64c6c73bf1'
  - 'test:notifications-service-focused'
created: '2026-07-23T17:26:44.000Z'
task_id: MAINT-FILE-SIZE-1000-001DB
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/gates/2026-07-24/maint-file-size-1000-001db
confidence: high
created_at: '2026-07-23T17:26:44.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T17:26:44.000Z'
ingested_at: '2026-07-23T17:29:42.358Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 8744cf46aadb0d7f9ea9d35424949b64c6c73bf1
ingested_via: put_page
commit_before: a2f50d7e9b9c43fde2642e9f03859a63c5efe6b2
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/server/services/notifications.test.ts
    - src/server/services/notifications/fixtures/notifications.test-support.ts
    - src/server/services/notifications/fixtures/notifications-core.cases.ts
    - >-
      src/server/services/notifications/fixtures/notifications-delivery-routing.cases.ts
    - >-
      src/server/services/notifications/fixtures/notifications-durable-delivery.cases.ts
    - tools/human-maintained-file-size-baseline.json
    - tools/authz-account-model-v1/inventory.json
  tech_stack:
    - Next.js
    - TypeScript
    - Vitest
  directories:
    - src/server/services/notifications
    - src/server/services
tags:
  - accepted
  - authz-inventory
  - codex
  - file-size
  - maintainability
  - notification
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001DB notification service test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved hoisted adapter mocks, async assertion polling, transaction mock construction, and reset hooks into an explicit fixture-scoped support module.
- Split the original ordered cases into notification persistence/dedupe, recipient routing/transport intent, and durable external delivery registration modules.
- Reduced the canonical test from 1448 to 12 lines. The support and three case modules are 129, 512, 498, and 367 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 117 to 116.
- Reprojected the authz inventory from one test contract to three fixture contracts; browser cutover assets changed from 477 to 479 after the docs/ledger references froze the support, transport/durable case, and production service closure.

## Commands

- focused notification service Vitest: pass, 1 file / 22 tests.
- normalized pre/post case-body parity across all three extracted groups: SHA-256 `70826301316c04187399e4ff2c3871aa882185f031884c2b278ccad6ca16d3d9`.
- human-maintained file-size gate: pass, 4420 files / 116 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized.
- authz inventory: pass, 972 entries / 479 browser assets / 381 scenarios / 669 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.

## Failure evidence

- A direct canonical SUT import evaluated before the fixture-owned mocks and caused 4 focused failures with zero mock calls. Restoring support-first SUT import ownership returned the suite to 22/22. This confirms the existing Vitest support-first import-order FailurePattern for this service split.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing membership eligibility, tenant filtering, PHI redaction, fixed telemetry, provider side-effect suppression, dedupe, and durable outbox assertions all passed. No runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 22 cases and reduced the ratcheted baseline without product, PHI, network, database, dependency, or runtime changes.

## Links

- canonical: [[file:src/server/services/notifications.test.ts]]
- support: [[file:src/server/services/notifications/fixtures/notifications.test-support.ts]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
- inventory: [[file:tools/authz-account-model-v1/inventory.json]]
- import-order failure: [[projects/careviax/failures/2026-07-24/vitest-support-first-sut-import-order]]
