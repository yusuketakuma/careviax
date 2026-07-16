---
type: ImplementationDecision
title: Use dashboard read capability for clerk reference lists
created: '2026-07-16T00:00:00.000Z'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S3
memory_id: >-
  projects/careviax/decisions/2026-07-16/clerk-reference-reads-use-dashboard-capability
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
ingested_at: '2026-07-16T07:38:47.470Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: ed4b9d59b
ingested_via: put_page
superseded_by: null
evidence_level: tested
reviewer_agent: unavailable
validity_scope:
  repo: careviax
  files:
    - src/app/api/org/members/route.ts
    - src/app/api/packaging-methods/route.ts
    - src/app/api/partner-pharmacies/route.ts
    - src/app/api/pharmacy-partnerships/route.ts
    - src/lib/api/route-catalog.ts
  directories:
    - src/app/api
    - src/lib/api
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - read-capability
---

# Use dashboard read capability for clerk reference lists

## Problem

- summary: Four ordinary reference-list GET routes reused canVisit, denying clerk access even though the fixed-role policy allows tenant operational reads.
- evidence: src/app/api/org/members/route.ts, src/app/api/packaging-methods/route.ts, src/app/api/partner-pharmacies/route.ts, src/app/api/pharmacy-partnerships/route.ts

## Decision

- adopted: Gate only the GET handlers with canViewDashboard; retain canAdmin or canManagePatientSharing on colocated mutations.
- reason: This grants the approved read behavior without granting visit, clinical, sharing, or administration execution.

## Alternatives rejected

- Grant canVisit to clerk — would also authorize visit and clinical-write surfaces.
- Reuse the GET wrapper for POST — would collapse read and mutation boundaries.

## Migration

- from: [canVisit on four GET handlers] → to: [canViewDashboard on four GET handlers]

## Verification

- focused 6 files / 47 tests, route-auth wrapper, API authz status, API response shape, client schema, scoped ESLint, Prettier, diff check, full typecheck: pass.

## Review

- reviewer: unavailable; codex2 pane was not available.

## Future rule candidate

- Classify mixed-method routes per method and never use a clinical execution capability for ordinary tenant reference reads.

## Links

- canonical: [[file:src/app/api/org/members/route.ts]]
