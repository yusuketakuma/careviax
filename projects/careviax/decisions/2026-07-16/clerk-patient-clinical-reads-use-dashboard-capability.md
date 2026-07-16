---
type: ImplementationDecision
title: Use dashboard capability for assigned patient clinical reads
created: '2026-07-16T00:00:00.000Z'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S4
memory_id: >-
  projects/careviax/decisions/2026-07-16/clerk-patient-clinical-reads-use-dashboard-capability
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
ingested_at: '2026-07-16T07:47:25.493Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 910579bf7
ingested_via: put_page
superseded_by: null
evidence_level: tested
reviewer_agent: unavailable
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patients/[id]/care-team/route.ts'
    - 'src/app/api/patients/[id]/conditions/route.ts'
    - 'src/app/api/patients/[id]/contacts/route.ts'
    - 'src/app/api/patients/[id]/insurance/route.ts'
    - 'src/app/api/patients/[id]/labs/route.ts'
    - 'src/app/api/patients/[id]/packaging/route.ts'
    - tools/route-auth-wrapper-allowlist.json
  directories:
    - src/app/api/patients
    - tools
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - patient-read
  - phi-audit
---

# Use dashboard capability for assigned patient clinical reads

## Problem

- summary: Six patient-detail GET handlers reused canVisit and denied clerk reads approved by the fixed-role policy.
- evidence: care-team, conditions, contacts, insurance, labs, and packaging route handlers.

## Decision

- adopted: Gate only these GET paths with canViewDashboard while retaining canVisit on colocated PUT and POST handlers.
- reason: Clerk may read operationally relevant patient information, but this must not grant clinical mutation authority.

## Alternatives rejected

- Grant canVisit to clerk — broadens visit and clinical writes.
- Move colocated mutations to canViewDashboard — collapses read and execution boundaries.
- Include PDF, export, field revisions, or external sharing — those are distinct output or audit boundaries.

## Migration

- from: [canVisit on six assigned patient GET handlers] → to: [canViewDashboard on six GET handlers; canVisit retained on writes]

## Verification

- focused 6 files / 118 tests, route-auth wrapper, API authz status, API response shape, client schema, DTO return gate, scoped ESLint, Prettier, diff check, full typecheck: pass.

## Review

- reviewer: unavailable; codex2 pane was not available.

## Future rule candidate

- Preserve assignment, PHI-read audit, and no-store controls when separating ordinary patient reads from clinical mutations.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-reference-reads-use-dashboard-capability]]
- canonical: [[file:src/app/api/patients/[id]/conditions/route.ts]]
