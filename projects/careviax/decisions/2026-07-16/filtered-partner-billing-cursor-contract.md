---
type: ImplementationDecision
title: Complete partner billing filters with exact counted cursor contracts
task_id: FE-PARTNER-BILLING-CURSOR-001
memory_id: >-
  projects/careviax/decisions/2026-07-16/filtered-partner-billing-cursor-contract
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 10719f228
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/pharmacy-invoices/route.ts
    - src/app/api/visit-billing-candidates/route.ts
    - >-
      src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx
  directories:
    - src/app/api
    - src/app/(dashboard)/billing
    - src/lib/db
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-16T10:47:28.532Z'
source_kind: put_page
tags:
  - accepted
  - billing
  - codex-lead
  - count-contract
  - cursor
  - frontend
  - postgresql
---

# Complete partner billing filters with exact counted cursor contracts

## Problem

- summary: Partner billing loaded only a bounded cursor window while status and provider filtering remained local or incomplete, and the UI could not distinguish loaded rows from the exact filtered total.
- evidence: src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx, src/app/api/pharmacy-invoices/route.ts, src/app/api/visit-billing-candidates/route.ts

## Decision

- adopted: Keep independent bounded candidate and invoice cursor chains, send month, status, and partner pharmacy filters to the providers, and return each page with returned_count, filtered exact total_count, count_basis, and echoed filters from one repeatable-read transaction. The client rejects filter echo drift, total drift, duplicate rows, cursor cycles, and terminal loaded-count mismatches.
- reason: This preserves bounded I/O while making partial scope explicit and preventing a page-sized subset from being presented as the complete billing history.

## Alternatives rejected

- Eagerly fetch every page to populate filters -- unbounded network and rendering cost.
- Keep active-contract-only provider options -- historical invoices tied to inactive contracts would be hidden; loaded historical rows are therefore merged into the option set.
- Keep legacy cursor-only meta -- cannot prove exact scope or detect cross-page count drift.

## Migration

- from: cursor-only meta plus client-local list filters
- to: strict filtered counted cursor contract consumed by server filter controls and loaded-scope table search

## Verification

- focused Vitest: 3 files, 58 tests pass.
- PostgreSQL equal-key integration: 20/21 filtered rows across two pages, 2 tests pass.
- full pnpm typecheck, exact ESLint and Prettier, frontend/API/client-schema/DTO/PHI/Plans static gates pass.
- focused route-mocked Chromium test passes with provider/status page-one query, exact loaded/total copy, 390px overflow 0, critical/serious axe 0, and instrumented console/page errors 0.
- authenticated agent-browser desktop and mobile checks pass; screenshots stored outside the repository.
- build skipped under the current no-frequent-build operating rule.

## Review

- reviewer: codex-lead; result: approved after live-code contract audit and browser verification. The older broad pharmacy-cooperation workflow test still fails before reaching billing at the patient-share list and is classified separately.

## Future rule candidate

- A bounded operational list that exposes server filters must echo applied filters and exact or explicitly qualified total scope; local search labels must state that they search only loaded rows.

## Links

- canonical: [[file:src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx]]
- canonical: [[file:src/app/api/pharmacy-invoices/route.ts]]
- canonical: [[file:src/app/api/visit-billing-candidates/route.ts]]
