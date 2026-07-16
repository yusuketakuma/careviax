---
type: ImplementationDecision
title: Allow clerk audited timeline detail reads
created: '2026-07-16T00:00:00.000Z'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S6
memory_id: projects/careviax/decisions/2026-07-16/clerk-audited-timeline-detail-read
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
ingested_at: '2026-07-16T07:59:45.139Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 836ad576a
ingested_via: put_page
superseded_by: null
evidence_level: tested
reviewer_agent: unavailable
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patients/[id]/timeline/[eventId]/route.ts'
  directories:
    - src/app/api/patients
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - patient-read
  - phi-audit
  - purpose
---

# Allow clerk audited timeline detail reads

## Problem

- summary: Timeline detail was an ordinary authenticated patient read but reused canVisit, denying clerk despite stronger purpose, read-reason, audit, and raw-data controls.
- evidence: src/app/api/patients/[id]/timeline/[eventId]/route.ts

## Decision

- adopted: Use canViewDashboard for timeline detail GET and retain required purpose, read_reason, request ID, PHI audit, assignment-aware service, no-store, and raw_text exclusion.
- reason: This is a controlled read, not visit or clinical execution.

## Alternatives rejected

- Grant canVisit to clerk — broadens writes.
- Open prescription/visit reads in the same slice — those routes need explicit PHI-read audit review first.

## Migration

- from: [canVisit on audited timeline detail GET] → to: [canViewDashboard]

## Verification

- focused 1 file / 11 tests, explicit permission option test, route-auth wrapper, API authz status, API response shape, client schema, scoped ESLint, Prettier, diff check, full typecheck: pass.

## Review

- reviewer: unavailable; codex2 pane was not available.

## Future rule candidate

- Prefer purpose-bound audited reads for clerk disclosure and do not open unaudited PHI reads as a mechanical permission replacement.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-patient-operational-reads-use-dashboard-capability]]
- canonical: [[file:src/app/api/patients/[id]/timeline/[eventId]/route.ts]]
