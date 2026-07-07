---
type: PerformanceFinding
title: >-
  Care-report index candidates require SELECT-only EXPLAIN evidence before
  migration
branch: main
source:
  - 'file:tools/scripts/explain-care-report-index-candidates.ts'
  - 'file:tools/scripts/explain-care-report-index-candidates.test.ts'
  - 'file:Plans.md'
  - >-
    test:pnpm exec vitest run
    tools/scripts/explain-care-report-index-candidates.test.ts
    tools/scripts/db-precheck-cli-conventions.test.ts --reporter=dot
    --testTimeout=30000
  - >-
    test:pnpm exec eslint tools/scripts/explain-care-report-index-candidates.ts
    tools/scripts/explain-care-report-index-candidates.test.ts
    tools/scripts/db-precheck-cli-conventions.test.ts
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck'
task_id: PERF-DB-006D-EXPLAIN
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/reviews/2026-07-08/care-report-index-explain-tooling
confidence: high
created_at: '2026-07-07T20:50:00.000Z'
created_by: codex-lead
expires_at: null
feature_id: PERF-DB-006
project_id: careviax
updated_at: '2026-07-07T20:50:00.000Z'
ingested_at: '2026-07-07T20:53:11.104Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: null
ingested_via: put_page
commit_before: e3a27070682e9e948a6ab9b27257cc17bf51d814
superseded_by: null
evidence_level: tested
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - tools/scripts/explain-care-report-index-candidates.ts
    - tools/scripts/explain-care-report-index-candidates.test.ts
    - Plans.md
  tech_stack:
    - TypeScript
    - PostgreSQL
    - Prisma
  directories:
    - tools/scripts
tags:
  - care-report
  - db
  - explain
  - migration-gate
  - performance
---

# Care-report index candidates require SELECT-only EXPLAIN evidence before migration

finding_type: performance
severity: medium · status: fixed

## Finding

- summary: care-report index work should not jump directly to Prisma migration or live DDL. The current safe lane is a SELECT-only `EXPLAIN (FORMAT JSON)` artifact over representative read shapes.
- details: The active `PERF-DB-006D` lane separates safe evidence capture from human-gated index migration. The tool sets tenant RLS context inside a rollback-only transaction, blocks DDL/DML/ANALYZE/multi-statement SQL, and emits redacted plan summaries only.

## Evidence

- `tools/scripts/explain-care-report-index-candidates.ts`
- `tools/scripts/explain-care-report-index-candidates.test.ts`
- `Plans.md` rows `PERF-DB-006D-EXPLAIN` and `PERF-DB-006D-INDEX`

## Recommended action

- Before adding care-report pg_trgm or composite indexes, run `pnpm db:explain-care-report-index-candidates -- --org-id <org_id> --json-output projects/careviax/reviews/<date>/care-report-index-explain.json --markdown-output projects/careviax/reviews/<date>/care-report-index-explain.md` against an approved non-production or explicitly approved environment.
- Keep migration creation in the separate human-gated `PERF-DB-006D-INDEX` lane with rollback plan and Oracle/DB review.

## Resolution

- action_taken: added the SELECT-only EXPLAIN CLI, mocked pg-client tests, package script registration, DB precheck convention coverage, and plan candidate wording aligned to current `created_at DESC, id DESC` route order.
- fixed_in_commit: c3148fd6d

## Lesson candidate

- For high-risk DB performance work, first add redacted SELECT-only EXPLAIN tooling and tests; do not create blind indexes or run live ANALYZE without a separate human gate.

## Links

- targets: [[file:tools/scripts/explain-care-report-index-candidates.ts]], [[file:Plans.md]]
