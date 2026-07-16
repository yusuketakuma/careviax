---
type: ImplementationDecision
title: Add PHI audit before opening clerk patient reads
created: '2026-07-16T00:00:00.000Z'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S7
memory_id: projects/careviax/decisions/2026-07-16/audit-clerk-patient-read-migration
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
ingested_at: '2026-07-16T08:06:51.827Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 80bb2f592
ingested_via: put_page
superseded_by: null
evidence_level: tested
reviewer_agent: unavailable
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patients/[id]/prescriptions/route.ts'
    - 'src/app/api/patients/[id]/visit-brief/route.ts'
    - 'src/app/api/patients/[id]/visit-constraints/route.ts'
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
  - prescriptions
  - visit
---

# Add PHI audit before opening clerk patient reads

## Problem

- summary: Prescription history, visit brief, and visit constraints were ordinary assigned-patient reads, but lacked explicit PHI-read audit and reused canVisit.
- evidence: the three GET handlers and direct-auth inventory.

## Decision

- adopted: Record a compact PHI read audit only after the authoritative assigned patient and response data are successfully resolved, then gate GET with canViewDashboard. Keep visit-constraints PUT on canVisit.
- reason: Approved clerk disclosure must remain attributable without generating false audit success for denied, missing, invalid, or failed reads.

## Alternatives rejected

- Permission-only replacement — would broaden PHI read without the repository audit control.
- Audit before patient resolution — would record reads that did not occur and could use an untrusted route ID.
- Move visit-constraints PUT to read capability — would authorize clinical scheduling mutation.

## Migration

- from: [canVisit and no explicit PHI audit on three GET paths] → to: [canViewDashboard plus success-only canonical patient audit]

## Verification

- implementation b60132f10 plus route catalog sync 80bb2f592; focused 3 files / 37 tests and catalog 3 files / 29 tests, success and failure audit assertions, route-auth wrapper, API authz status, API response shape, client schema, DTO gate, scoped ESLint, Prettier, diff check, full typecheck: pass.

## Review

- reviewer: unavailable; codex2 pane was not available.

## Future rule candidate

- Add canonical success-only PHI read audit in the same slice when broadening authenticated patient read roles.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-audited-timeline-detail-read]]
- canonical: [[file:src/app/api/patients/[id]/prescriptions/route.ts]]
