---
type: ImplementationDecision
title: Make pharmacy cooperation visit requests an exact bounded cursor spine
task_id: FE-PHARMACY-COOP-CURSOR-001B
memory_id: projects/careviax/decisions/2026-07-16/exact-visit-request-cursor-spine
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 7893b7dd3
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/pharmacy-visit-requests/route.ts
    - >-
      src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx
  directories:
    - src/app/api/pharmacy-visit-requests
    - src/app/(dashboard)/workflow/pharmacy-cooperation
    - src/lib/db
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-16T11:32:10.025Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - count-contract
  - cursor
  - frontend
  - pharmacy-cooperation
  - postgresql
  - visit-request
---

# Make pharmacy cooperation visit requests an exact bounded cursor spine

## Problem

- summary: The workflow fetched only eight visit requests, discarded continuation metadata, and used loaded-row length for the requested summary and downstream options. The route exposed cursor position but no exact filtered scope.
- evidence: src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx, src/app/api/pharmacy-visit-requests/route.ts

## Decision

- adopted: For the workflow view, read each visit-request page, exact filtered count, and status groups inside one repeatable-read transaction, echo filters and request cursor, and consume the response with a strict infinite query. Add an explicit status filter and load-more/retry UI; reject total, filter, cursor, duplicate, cycle, and terminal-count drift.
- reason: Bounded operational loading must remain honest about partial scope while preserving existing authorization, active-consent predicates, mutation invalidation, and PHI-safe row projection.

## Alternatives rejected

- Eagerly fetch every page -- unbounded I/O and rendering.
- Keep a page-only summary -- the requested count and message/record options would silently exclude later pages.
- Accept legacy cursor-only metadata in the workflow -- cannot prove completeness or filtered scope.

## Migration

- from: one eight-row useQuery page with cursor-only metadata
- to: strict filtered counted cursor pages with explicit continuation, server status filter, exact requested summary, and retained rows on continuation failure

## Verification

- focused Vitest: 2 files, 58 tests pass, including visit-request 8/9, filter reset, retry retention, and legacy-meta rejection.
- PostgreSQL equal-key integration: 4 tests pass, including a filtered visit-request 8/9 chain without duplicates.
- focused route-mocked Chromium visit-request test passes with exact counts, page-one server filter, 390px overflow 0, and instrumented console/page errors 0.
- broad workflow Chromium passes share-case and visit-request creation, display, filtering, and message-option paths, then stops at the next separate partner-visit-record contract.
- full typecheck, exact ESLint and Prettier, frontend/API/client-schema/DTO/PHI/Plans static gates pass.
- authenticated agent-browser desktop and mobile checks show the empty exact count and visit status filter with overflow 0 and no console/page errors.
- build skipped under the current no-frequent-build operating rule.

## Review

- reviewer: codex-lead; result: approved for the visit-request sub-slice after API, component, database, browser, and static verification.

## Future rule candidate

- A workflow summary derived from a bounded list must use provider-authoritative status counts, not loaded-row length, and downstream controls must disclose when their options are still limited to loaded pages.

## Links

- canonical: [[file:src/app/api/pharmacy-visit-requests/route.ts]]
- canonical: [[file:src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx]]
