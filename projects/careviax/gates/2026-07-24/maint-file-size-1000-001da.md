---
type: GateResult
title: MAINT-FILE-SIZE-1000-001DA QR scan draft route test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/qr-scan-drafts/route.test.ts'
  - 'file:src/app/api/qr-scan-drafts/fixtures/route.test-support.ts'
  - 'file:src/app/api/qr-scan-drafts/fixtures/route-get.cases.ts'
  - 'file:src/app/api/qr-scan-drafts/fixtures/route-post-transport.cases.ts'
  - 'file:src/app/api/qr-scan-drafts/fixtures/route-post-identity-split.cases.ts'
  - 'file:src/app/api/qr-scan-drafts/fixtures/route-post-dedupe.cases.ts'
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'file:tools/authz-account-model-v1/inventory.json'
  - 'commit:7a6deb9ca8227ad49354daadb5eb21aab228e53c'
  - 'test:qr-scan-drafts-route-focused'
created: '2026-07-23T17:06:38.000Z'
task_id: MAINT-FILE-SIZE-1000-001DA
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/gates/2026-07-24/maint-file-size-1000-001da
confidence: high
created_at: '2026-07-23T17:06:38.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T17:06:38.000Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 7a6deb9ca8227ad49354daadb5eb21aab228e53c
ingested_via: put_page
commit_before: bcf330651
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/app/api/qr-scan-drafts/route.test.ts
    - src/app/api/qr-scan-drafts/fixtures/route.test-support.ts
    - src/app/api/qr-scan-drafts/fixtures/route-get.cases.ts
    - src/app/api/qr-scan-drafts/fixtures/route-post-transport.cases.ts
    - src/app/api/qr-scan-drafts/fixtures/route-post-identity-split.cases.ts
    - src/app/api/qr-scan-drafts/fixtures/route-post-dedupe.cases.ts
    - tools/human-maintained-file-size-baseline.json
    - tools/authz-account-model-v1/inventory.json
  tech_stack:
    - Next.js
    - TypeScript
    - Vitest
  directories:
    - src/app/api/qr-scan-drafts
ingested_at: '2026-07-23T17:07:11.250Z'
tags:
  - accepted
  - authz-inventory
  - codex
  - file-size
  - maintainability
  - qr-scan
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001DA QR scan draft route test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved hoisted route mocks, GET/POST setup hooks, bounded-body request builders, response-header assertion, and SUT wrappers into a fixture-scoped support module.
- Split route cases into GET, POST transport/persistence, patient identity/split validation, and reassembly/dedupe/error registration modules while preserving the original two describe scopes and registration order.
- Reduced the canonical test from 1436 to 24 lines. The support and four case modules are 385, 134, 332, 351, and 344 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 118 to 117.

## Commands

- focused QR scan draft route Vitest: pass, 1 file / 31 tests.
- exact pre/post case-body parity across all four extracted groups: SHA-256 `b6de6564d051c18ba325d2bb43cfc5da3c33ab9393ec368e6ed158b34f673140`.
- human-maintained file-size gate: pass, 4416 files / 117 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized.
- authz inventory: pass, 972 entries / 477 browser assets / 381 scenarios / 667 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing permission, tenant, bounded body, timeout, patient identity, split-page, duplicate hash, response minimization, no-store, and fixed-error assertions all passed. No runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 31 GET/POST cases and reduced the ratcheted baseline without product, PHI, network, database, dependency, or runtime changes.

## Links

- canonical: [[file:src/app/api/qr-scan-drafts/route.test.ts]]
- support: [[file:src/app/api/qr-scan-drafts/fixtures/route.test-support.ts]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
- inventory: [[file:tools/authz-account-model-v1/inventory.json]]
