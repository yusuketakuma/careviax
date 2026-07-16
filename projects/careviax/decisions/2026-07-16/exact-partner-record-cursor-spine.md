---
type: ImplementationDecision
title: Make partner visit records an exact bounded cursor spine
task_id: FE-PHARMACY-COOP-CURSOR-001C
memory_id: projects/careviax/decisions/2026-07-16/exact-partner-record-cursor-spine
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 156cce8ab
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/partner-visit-records/route.ts
    - >-
      src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx
  directories:
    - src/app/api/partner-visit-records
    - src/app/(dashboard)/workflow/pharmacy-cooperation
    - src/lib/db
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-16T11:49:32.538Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - count-contract
  - cursor
  - frontend
  - partner-visit-record
  - pharmacy-cooperation
  - postgresql
---

# Make partner visit records an exact bounded cursor spine

## Problem

- summary: The workflow fetched only eight partner visit records, discarded cursor metadata, and calculated submitted summaries and downstream action scope from the loaded subset.
- evidence: src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx, src/app/api/partner-visit-records/route.ts

## Decision

- adopted: Return workflow pages with filtered exact totals, status groups, filter echoes, and request cursors from one repeatable-read transaction that preserves request context. Consume them with a strict infinite query, explicit status filter/load-more, authoritative submitted count, and retained rows on continuation failure.
- reason: Partner record review and report actions need bounded loading without presenting a partial page as the complete operational scope.

## Alternatives rejected

- Eagerly load all records -- unbounded I/O and rendering.
- Use loaded rows for the submitted summary -- silently undercounts later pages.
- Accept legacy cursor-only workflow responses -- cannot establish complete or filtered scope.

## Migration

- from: one eight-row useQuery page with cursor-only metadata
- to: strict filtered counted cursor pages with explicit continuation, server status filter, exact submitted summary, and fail-visible retry

## Verification

- focused Vitest: 2 files, 61 tests pass, including 8/9, filter reset, retry retention, legacy rejection, and existing submit/review flows.
- PostgreSQL equal-key integration: 5 tests pass, including a filtered partner-record 8/9 chain without duplicates.
- focused route-mocked Chromium partner-record test passes with exact counts, page-one server filter, 390px overflow 0, and instrumented console/page errors 0.
- broad route-mocked workflow Chromium passes the full share consent, link activation, visit, partner record submit/review, report draft, and billing flow after adding an explicit enabled-state synchronization point.
- full typecheck, exact ESLint and Prettier, frontend/API/client-schema/DTO/PHI/Plans static gates pass.
- authenticated agent-browser desktop and mobile checks show exact empty record counts with overflow 0 and no console/page errors.
- build skipped under the current no-frequent-build operating rule.

## Review

- reviewer: codex-lead; result: approved after API, component, database, dedicated browser, and broad workflow verification.

## Future rule candidate

- Cursor-backed review queues must derive status summaries from provider-authoritative counts and keep loaded rows usable when continuation fails.

## Links

- canonical: [[file:src/app/api/partner-visit-records/route.ts]]
- canonical: [[file:src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx]]
