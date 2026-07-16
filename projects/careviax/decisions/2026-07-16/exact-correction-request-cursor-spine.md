---
type: ImplementationDecision
title: Make correction requests an exact share-case cursor spine
task_id: FE-PHARMACY-COOP-CURSOR-001D
memory_id: projects/careviax/decisions/2026-07-16/exact-correction-request-cursor-spine
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 75afce897
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patient-share-cases/[id]/correction-requests/route.ts'
    - >-
      src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx
  directories:
    - 'src/app/api/patient-share-cases/[id]/correction-requests'
    - src/app/(dashboard)/workflow/pharmacy-cooperation
    - src/lib/db
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-16T12:06:37.637Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - correction-request
  - count-contract
  - cursor
  - frontend
  - pharmacy-cooperation
  - postgresql
---

# Make correction requests an exact share-case cursor spine

## Problem

- summary: The workflow fetched only the first eight correction requests for the selected share case, discarded cursor metadata, and presented that subset as the complete request scope.
- evidence: src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx, src/app/api/patient-share-cases/[id]/correction-requests/route.ts

## Decision

- adopted: Return workflow pages with filtered exact totals, status groups, share-case and status filter echoes, and request cursors from one repeatable-read transaction. Consume them with a strict infinite query, explicit server status filter/load-more, selected-share-case page-one reset, and retained rows on continuation failure.
- reason: Correction review must remain bounded while clearly separating loaded rows from the complete authorized share-case scope.

## Alternatives rejected

- Eagerly load all correction requests -- unbounded I/O and rendering.
- Treat the first eight rows as complete -- hides later actionable requests.
- Accept legacy cursor-only workflow responses -- cannot prove share-case scope or completion.

## Migration

- from: one eight-row useQuery page with cursor-only metadata
- to: strict filtered counted cursor pages with explicit continuation, server status filter, share-case-dependent reset, exact loaded/total display, and fail-visible retry

## Verification

- focused Vitest: 2 files, 67 tests pass, including 8/9, status reset, continuation retry with row retention, legacy rejection, and existing correction mutations.
- PostgreSQL equal-key integration: 6 tests pass, including a share-case and status filtered correction-request 8/9 chain without duplicates.
- focused route-mocked Chromium passes exact empty counts, page-one status filter, 390px overflow 0, and instrumented console/page errors 0.
- broad route-mocked workflow Chromium passes share consent, link activation, visit, record, report draft, and billing flow.
- full 8 GB typecheck, exact ESLint and Prettier, frontend/API/client-schema/DTO/PHI/boundary/Plans static gates pass.
- build skipped under the current no-frequent-build operating rule.

## Review

- reviewer: codex-lead; result: approved after API, component, database, dedicated browser, and broad workflow verification.

## Future rule candidate

- Share-case-dependent cursor resources must echo the selected parent ID and start a fresh page-one scope when either parent or server filter changes.

## Links

- canonical: [[file:src/app/api/patient-share-cases/[id]/correction-requests/route.ts]]
- canonical: [[file:src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx]]
