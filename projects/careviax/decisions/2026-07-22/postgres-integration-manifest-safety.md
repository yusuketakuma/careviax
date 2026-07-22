---
type: ImplementationDecision
title: PostgreSQL integration suites require a disposable CI service proof
memory_id: projects/careviax/decisions/2026-07-22/postgres-integration-manifest-safety
project_id: careviax
repo_url: https://github.com/yusuketakuma/careviax.git
branch: codex1/continuous-optimization-20260716
commit_before: 1c7f72da1
commit_after: f505e7c57
task_id: CI-POSTGRES-INTEGRATION-MANIFEST-001
feature_id: null
created_at: 2026-07-22T15:58:00+09:00
updated_at: 2026-07-22T15:58:00+09:00
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: codex-lead
source:
  - file:tools/postgres-integration-manifest.json
  - file:tools/scripts/run-postgres-integration-manifest.ts
  - file:.github/workflows/ci.yml
  - commit:d7fa55948
  - commit:54145ce74
  - commit:f505e7c57
  - test:pnpm vitest run tools/scripts/run-postgres-integration-manifest.test.ts tools/scripts/prepare-e2e-db-core.test.ts
confidence: high
evidence_level: peer_reviewed
validity_scope:
  repo: careviax
  directories: [.github/workflows, tools/scripts]
  files:
    [
      .github/workflows/ci.yml,
      tools/postgres-integration-manifest.json,
      tools/scripts/run-postgres-integration-manifest.ts,
    ]
  tech_stack: [GitHub Actions, PostgreSQL, Vitest, TypeScript]
expires_at: null
superseded_by: null
tags: [ci, postgres, integration-test, safety, vitest, codex, accepted]
---

# PostgreSQL integration suites require a disposable CI service proof

## Problem

- Three database integration suites silently became skipped when their dedicated URL variables were absent.
- A local database name and port alone do not prove disposability; the display-ID suite clears protected global allocator keys.

## Decision

- Register the exact three suites and expected counts in a machine-readable manifest and run each serially with Vitest JSON output.
- Require the GitHub Actions run identity and an exact workflow-owned disposable PostgreSQL service marker before opening the database.
- Accept only literal `localhost:5433/ph_os_e2e?schema=public` as user `ph_os` because every registered suite recognizes that form.
- Before running suites, prove completed migrations and zero pre-existing `__global__` allocator rows for prefixes `bg`, `drug`, and `dpv` using SELECT-only queries.
- Treat failures, skips, pending tests, and count drift as hard failures.

## Alternatives rejected

- Generic `pnpm test`: missing environment variables can convert required suites into skips.
- Local host/database checks alone: a persistent developer database can satisfy those checks.
- Accepting `127.0.0.1` or IPv6 aliases: the display-ID suite currently enables its DB block only for literal `localhost`.

## Verification

- manifest runner and E2E preparation helper: 2 files / 30 tests pass
- exact ESLint, Prettier, diff check, and typecheck:no-unused pass
- independent review rejected the first version for two P2 safety gaps and accepted the constrained follow-up with no remaining findings
- actual 3 files / 37 database tests remain pending observation in the required disposable CI job

## Future rule candidate

- Required database tests must prove both an exact disposable execution context and protection of every non-run-specific cleanup key before mutation.
