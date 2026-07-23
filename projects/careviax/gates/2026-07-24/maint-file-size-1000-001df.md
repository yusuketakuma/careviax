---
type: GateResult
title: MAINT-FILE-SIZE-1000-001DF report share workspace test split gate
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/(dashboard)/reports/report-share-workspace.test.tsx'
  - >-
    file:src/app/(dashboard)/reports/fixtures/report-share-workspace.test-support.tsx
  - 'file:src/app/(dashboard)/reports/fixtures/report-share-workspace.cases.tsx'
  - 'file:tools/human-maintained-file-size-baseline.json'
  - 'commit:e671a6213f3357dc9e22f6d3855e7321d4a802ee'
  - 'test:report-share-workspace-focused'
created: '2026-07-23T18:29:51.000Z'
task_id: MAINT-FILE-SIZE-1000-001DF
confidence: high
ingested_at: '2026-07-23T18:32:28.501Z'
source_kind: put_page
ingested_via: put_page
evidence_level: gate_verified
validity_scope:
  repo: careviax
  files:
    - src/app/(dashboard)/reports/report-share-workspace.test.tsx
    - >-
      src/app/(dashboard)/reports/fixtures/report-share-workspace.test-support.tsx
    - src/app/(dashboard)/reports/fixtures/report-share-workspace.cases.tsx
    - tools/human-maintained-file-size-baseline.json
  tech_stack:
    - TypeScript
    - React
    - Vitest
    - Testing Library
  directories:
    - src/app/(dashboard)/reports
tags:
  - accepted
  - codex
  - file-size
  - maintainability
  - reports
  - test
  - validation
---

# MAINT-FILE-SIZE-1000-001DF report share workspace test split gate

run_context: { os: macOS, node: 24.16.0, package_manager: pnpm, env: local }

## Scope

- Moved the DOM environment, hoisted mocks, strict provider fixture, fetch stubs, navigation spies, query wrapper, and global hooks into an explicit fixture-scoped support module.
- Moved all 25 rendered workspace behavior cases into one registration module while retaining the four pure helper cases in the canonical entry.
- Reduced the canonical test from 1405 to 55 lines. The support and behavior case modules are 455 and 941 lines, all below the 1000-line ceiling.
- Removed the exact baseline entry, reducing the repository baseline from 113 to 112.

## Commands

- focused report share workspace Vitest: pass, 1 file / 30 tests.
- exact pre/post registration-body parity: SHA-256 `bf8a5730e64edaf0d16e3d7d03d9270f8014e0813c734c3a6d26f59a3a190723`.
- human-maintained file-size gate: pass, 4433 files / 112 baseline / 3 exclusions.
- exact ESLint and Prettier: pass.
- module boundaries: pass, zero new violations and zero allowlisted debt.
- `pnpm typecheck` and `pnpm typecheck:no-unused`: pass, serialized.
- authz inventory: pass, unchanged at 972 entries / 479 browser assets / 381 scenarios / 671 non-runtime / 58 migration contracts.
- full build: skipped; repository policy defers Next builds to the large integration boundary.

## Security

secret_scan: skipped; no secret-bearing source changed. Existing strict provider schema, organization headers, navigation encoding, hostile identifier, unsafe error redaction, failed-delivery redaction, stale-data retention, inbound decision retry, optimistic-lock, and no-dashboard-refetch assertions all passed. No product runtime behavior changed.

## Overall

result: pass; accepted_for_next_step: true; reason: test-only responsibility extraction preserved all 30 contract, UI, recovery, realtime, navigation, privacy, and helper cases while reducing the ratcheted baseline without product, external share/send, database, dependency, or runtime changes.

## Links

- canonical: [[file:src/app/(dashboard)/reports/report-share-workspace.test.tsx]]
- support: [[file:src/app/(dashboard)/reports/fixtures/report-share-workspace.test-support.tsx]]
- cases: [[file:src/app/(dashboard)/reports/fixtures/report-share-workspace.cases.tsx]]
- product: [[file:src/app/(dashboard)/reports/report-share-workspace.tsx]]
- baseline: [[file:tools/human-maintained-file-size-baseline.json]]
