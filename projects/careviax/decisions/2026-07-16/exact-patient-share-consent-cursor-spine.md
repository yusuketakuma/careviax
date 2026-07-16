---
type: ImplementationDecision
title: Make patient share consents an exact share-case cursor spine
task_id: FE-PHARMACY-COOP-CURSOR-001E
memory_id: >-
  projects/careviax/decisions/2026-07-16/exact-patient-share-consent-cursor-spine
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 434da14ca
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patient-share-cases/[id]/consents/route.ts'
    - >-
      src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx
  directories:
    - 'src/app/api/patient-share-cases/[id]/consents'
    - src/app/(dashboard)/workflow/pharmacy-cooperation
    - src/lib/db
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-16T12:19:47.787Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - consent
  - count-contract
  - cursor
  - frontend
  - pharmacy-cooperation
  - postgresql
---

# Make patient share consents an exact share-case cursor spine

## Problem

- summary: The workflow fetched only the first eight consents for the selected share case, discarded cursor metadata, and limited visible revoke targets to that local subset.
- evidence: src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx, src/app/api/patient-share-cases/[id]/consents/route.ts

## Decision

- adopted: Return workflow pages with exact filtered totals, active and revoked counts, share-case/status echoes, and request cursors from one repeatable-read transaction. Consume them with a strict infinite query, explicit server status filter/load-more, parent-dependent reset, retained rows on continuation failure, and mutation-family invalidation after register or revoke.
- reason: Consent operations must remain bounded without hiding authorized revoke targets or presenting a partial page as the complete share-case history.

## Alternatives rejected

- Eagerly load all consents -- unbounded I/O and rendering.
- Keep revoke actions on the first page only -- silently hides later authorized targets.
- Accept legacy cursor-only workflow responses -- cannot prove selected share-case scope or completion.

## Verification

- focused Vitest: 3 files, 72 tests pass, including 8/9, status reset, continuation retry with row retention, legacy rejection, create, and revoke flows.
- PostgreSQL equal-key integration: 7 tests pass, including an active consent 8/9 chain without duplicates or cross-case/revoked leakage.
- focused route-mocked Chromium passes exact empty counts, page-one status filter, 390px overflow 0, and instrumented console/page errors 0.
- broad route-mocked workflow Chromium passes consent, link activation, visit, record, report draft, and billing flow.
- full 8 GB typecheck, exact ESLint and Prettier, frontend/API/client-schema/DTO/PHI/boundary/Plans static gates pass.
- build skipped under the current no-frequent-build operating rule.

## Review

- reviewer: codex-lead; result: approved after API, component, revoke path, database, dedicated browser, and broad workflow verification.

## Future rule candidate

- Cursor-backed consent histories must derive active and revoked scope from provider-authoritative counts and invalidate every filtered cache after lifecycle mutations.

## Links

- canonical: [[file:src/app/api/patient-share-cases/[id]/consents/route.ts]]
- canonical: [[file:src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx]]
