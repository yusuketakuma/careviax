---
type: ImplementationDecision
title: Make pharmacy cooperation share cases an exact bounded cursor spine
task_id: FE-PHARMACY-COOP-CURSOR-001A
memory_id: projects/careviax/decisions/2026-07-16/exact-share-case-cursor-spine
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 13440ddfe
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/patient-share-cases/route.ts
    - >-
      src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx
  directories:
    - src/app/api/patient-share-cases
    - src/app/(dashboard)/workflow/pharmacy-cooperation
    - src/lib/db
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-16T11:16:17.946Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - count-contract
  - cursor
  - frontend
  - pharmacy-cooperation
  - postgresql
---

# Make pharmacy cooperation share cases an exact bounded cursor spine

## Problem

- summary: The workflow requested only eight share cases, discarded continuation metadata, and treated a page-local count as the complete selectable scope. Exact counts were omitted on continuation and filtered requests.
- evidence: src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx, src/app/api/patient-share-cases/route.ts

## Decision

- adopted: Return filtered exact count and status metadata on every workflow page in one repeatable-read transaction, echo filters and request cursor, and consume pages with an explicit infinite query. Reject total/filter/cursor drift, duplicate IDs, cursor cycles, and terminal count mismatches while retaining loaded rows on continuation failure.
- reason: The workflow needs bounded I/O and explicit partial scope; eager full loading and legacy page-local counts cannot prove completeness.

## Alternatives rejected

- Eagerly fetch every page -- unbounded network, query, and render cost.
- Preserve visible_count and hidden_count -- ambiguous on continuation pages and unable to express filtered exact scope safely.
- Run count and groupBy concurrently on one interactive transaction client -- can queue concurrent pg client queries and emits a deprecation warning.

## Migration

- from: one useQuery page plus first-page-only legacy count metadata
- to: strict filtered counted cursor pages plus explicit load-more, server status filter, loaded/total/scope-complete UI, and fail-visible retry

## Verification

- focused Vitest: 2 files, 66 tests pass, including 8/9 loading, retry retention, filter reset, and legacy-meta rejection.
- PostgreSQL equal-key integration: 3 tests pass, including a filtered 8/9 share-case cursor chain without duplicates.
- focused route-mocked Chromium share-case test passes with exact counts, page-one server filter, 390px overflow 0, and instrumented console/page errors 0.
- full typecheck, exact ESLint and Prettier, frontend/API/client-schema/DTO/PHI/Plans static gates pass.
- authenticated agent-browser desktop and mobile checks have overflow 0 and no console/page errors; the local database contained zero share cases, so populated interaction proof remains in route-mocked Chromium.
- build skipped under the current no-frequent-build operating rule.

## Review

- reviewer: codex-lead; result: approved for the share-case sub-slice. The broad workflow test now passes the share-case path and stops at the separate visit-request list contract.

## Future rule candidate

- Each bounded workflow resource should expose an exact or explicitly qualified scope on every cursor page, echo server filters, and keep continuation failures visible without discarding already loaded rows.

## Links

- canonical: [[file:src/app/api/patient-share-cases/route.ts]]
- canonical: [[file:src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx]]
