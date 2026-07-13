---
type: RejectedApproach
title: Collapse DrugMaster code lookups into one multi-column OR query
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/server/services/prescription-intake-service.ts'
  - 'file:docs/operations/db-pool-policy.md'
  - 'test:pnpm db:query-shape:check'
task_id: PERF-DB-RX-INTAKE-DRUGCODE-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: >-
  projects/careviax/rejected/2026-07-13/collapse-drugmaster-code-lookups-into-multicolumn-or
confidence: high
created_at: '2026-07-13T10:33:30.000Z'
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/server/services/prescription-intake-service.ts
    - docs/operations/db-pool-policy.md
  directories:
    - src/server/services
    - docs/operations
ingested_via: put_page
ingested_at: '2026-07-13T10:35:03.606Z'
source_kind: put_page
tags:
  - db-performance
  - drugmaster
  - query-shape
  - rejected
  - sequential-scan
---

# Collapse DrugMaster code lookups into one multi-column OR query

## Proposal

- Replace the column-specific DrugMaster prescription-code lookups with one query that ORs conditions across all supported code columns.

## Rejection reason

- The existing helper emits a constant maximum of three column-specific indexed lookups, plus at most one explicit-ID lookup; query count does not grow with prescription line count and is not an N+1.
- Repository DB evidence records a 33.7-second sequential scan for the multi-column OR shape, while the column-specific form preserves index selection.
- Collapsing the calls would trade a small bounded number of indexed queries for a known severe query-plan regression.

## Do not repeat until

- A representative production-shaped dataset and `EXPLAIN (ANALYZE, BUFFERS)` show that a new index or planner change makes the multi-column form faster without a sequential scan.
- The query-shape guard and prescription-intake regression suite remain green after any future experiment.

## Links

- linked_decision: [[projects/careviax/decisions/2026-07-13/serialize-medication-profile-sync]]
- evidence: [[file:docs/operations/db-pool-policy.md]]
- canonical: [[file:src/server/services/prescription-intake-service.ts]]
