---
type: GateResult
title: MAINT-FILE-SIZE-1000-001DE MHLW drug master import test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/server/services/drug-master-import/mhlw.test.ts'
  - 'file:src/server/services/drug-master-import/fixtures/mhlw.test-support.ts'
  - >-
    file:src/server/services/drug-master-import/fixtures/mhlw-resolution.cases.ts
  - >-
    file:src/server/services/drug-master-import/fixtures/mhlw-price-import.cases.ts
  - >-
    file:src/server/services/drug-master-import/fixtures/mhlw-generic-flags.cases.ts
  - >-
    file:src/server/services/drug-master-import/fixtures/mhlw-generic-mappings.cases.ts
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'commit:b1c54cab6805065afc206841fcbe25aee32a72de'
  - 'test:mhlw-drug-master-import-focused'
created: '2026-07-23T18:14:27.000Z'
task_id: MAINT-FILE-SIZE-1000-001DE
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/gates/2026-07-24/maint-file-size-1000-001de
confidence: high
created_at: '2026-07-23T18:14:27.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T18:14:27.000Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: b1c54cab6805065afc206841fcbe25aee32a72de
ingested_via: put_page
commit_before: ec3e11a2e2e280146ae927f6599b85554704120a
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/server/services/drug-master-import/mhlw.test.ts
    - src/server/services/drug-master-import/fixtures/mhlw.test-support.ts
    - src/server/services/drug-master-import/fixtures/mhlw-resolution.cases.ts
    - src/server/services/drug-master-import/fixtures/mhlw-price-import.cases.ts
    - >-
      src/server/services/drug-master-import/fixtures/mhlw-generic-flags.cases.ts
    - >-
      src/server/services/drug-master-import/fixtures/mhlw-generic-mappings.cases.ts
    - tools/human-maintained-file-size-baseline.json
  tech_stack:
    - TypeScript
    - Vitest
    - Prisma
    - ExcelJS
  directories:
    - src/server/services/drug-master-import
ingested_at: '2026-07-23T18:14:49.534Z'
tags:
  - accepted
  - codex
  - drug-master
  - file-size
  - maintainability
  - mhlw
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001DE MHLW drug master import test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved the display-id mock, MHLW source functions, workbook builders, and response helpers into an explicit fixture-scoped support module.
- Split top-level suites into ordered side-effect case modules for source/workbook resolution, price import/preview, generic flags, and generic-name mappings.
- Reduced the canonical test from 1609 to 4 lines. The support and four case modules are 152, 199, 711, 183, and 425 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 114 to 113.

## Commands

- focused MHLW import Vitest: pass, 1 file / 34 tests.
- normalized pre/post suite-body parity across all four extracted groups: SHA-256 `a843ecc741f4027ad21e6f0a33cd8d2a70664d96a2ca4aade5073ce5566d3600`.
- human-maintained file-size gate: pass, 4431 files / 113 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized.
- authz inventory: pass, unchanged at 972 entries / 479 browser assets / 381 scenarios / 671 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing MHLW URL policy, strict Japanese-era/source-date validation, bounded quarantine summaries, preview no-write guarantees, transactional price-version close, malformed YJ rejection, workbook shape, and generic mapping assertions all passed. No product runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 34 parser/import/preview suites and reduced the ratcheted baseline without product, external fetch, database, dependency, or runtime changes.

## Links

- canonical: [[file:src/server/services/drug-master-import/mhlw.test.ts]]
- support: [[file:src/server/services/drug-master-import/fixtures/mhlw.test-support.ts]]
- product: [[file:src/server/services/drug-master-import/mhlw.ts]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
