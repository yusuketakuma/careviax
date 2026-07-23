---
type: GateResult
title: MAINT-FILE-SIZE-1000-001DC patient board UI test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/(dashboard)/patients/patients-board.test.tsx'
  - 'file:src/app/(dashboard)/patients/fixtures/patients-board.test-support.tsx'
  - 'file:src/app/(dashboard)/patients/fixtures/patients-board.cases.tsx'
  - 'file:src/app/(dashboard)/patients/patients-board.tsx'
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'commit:16e5feb91fc126df7bc8e394836eb66d04f54c6d'
  - 'test:patients-board-focused'
created: '2026-07-23T17:45:03.000Z'
task_id: MAINT-FILE-SIZE-1000-001DC
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/gates/2026-07-24/maint-file-size-1000-001dc
confidence: high
created_at: '2026-07-23T17:45:03.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T17:45:03.000Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 16e5feb91fc126df7bc8e394836eb66d04f54c6d
ingested_via: put_page
commit_before: 71b1cb79f8326b5fc8c9da6d320f3e3493c8f2c6
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/app/(dashboard)/patients/patients-board.test.tsx
    - src/app/(dashboard)/patients/fixtures/patients-board.test-support.tsx
    - src/app/(dashboard)/patients/fixtures/patients-board.cases.tsx
    - tools/human-maintained-file-size-baseline.json
  tech_stack:
    - Next.js
    - React
    - TypeScript
    - Vitest
    - Testing Library
  directories:
    - src/app/(dashboard)/patients
ingested_at: '2026-07-23T17:45:25.232Z'
tags:
  - accepted
  - codex
  - file-size
  - maintainability
  - patient-board
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001DC patient board UI test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved DOM setup, hoisted realtime/client-log mocks, patient board fixtures, and suite-local reset hooks into an explicit fixture-scoped support module.
- Moved all PatientsBoard behavior cases into one ordered registration module while retaining the loading-shell and pure formatting/safety-tag suites at the canonical test path.
- Reduced the canonical test from 1326 to 83 lines. The support and behavior case modules are 311 and 982 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 116 to 115.

## Commands

- focused patient board Vitest: pass, 1 file / 32 tests.
- exact pre/post case-body parity across the behavior and utility suites: SHA-256 `5af176b831608517b072cc7ced0db1a235461e6b0f575da81ce3b6458714a46f`.
- human-maintained file-size gate: pass, 4422 files / 115 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized.
- authz inventory: pass, unchanged at 972 entries / 479 browser assets / 381 scenarios / 669 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.
- browser QA and image generation: skipped; this slice only reorganized existing test code and did not change rendered UI, interaction, copy, or visual structure.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing provider-contract rejection, PHI-safe retry/error, realtime stale-data retention, hidden-address exclusion, patient-link, safety-tag, and accessibility assertions all passed. No product runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 32 patient board and utility cases and reduced the ratcheted baseline without product, PHI, network, database, dependency, UI, or runtime changes.

## Links

- canonical: [[file:src/app/(dashboard)/patients/patients-board.test.tsx]]
- support: [[file:src/app/(dashboard)/patients/fixtures/patients-board.test-support.tsx]]
- cases: [[file:src/app/(dashboard)/patients/fixtures/patients-board.cases.tsx]]
- product: [[file:src/app/(dashboard)/patients/patients-board.tsx]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
