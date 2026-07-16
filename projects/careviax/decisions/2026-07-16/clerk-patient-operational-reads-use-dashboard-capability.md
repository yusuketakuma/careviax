---
type: ImplementationDecision
title: Use dashboard capability for patient operational reads
created: '2026-07-16T00:00:00.000Z'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S5
memory_id: >-
  projects/careviax/decisions/2026-07-16/clerk-patient-operational-reads-use-dashboard-capability
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
ingested_at: '2026-07-16T07:54:05.905Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 905309b87
ingested_via: put_page
superseded_by: null
evidence_level: tested
reviewer_agent: unavailable
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patients/[id]/communications/route.ts'
    - 'src/app/api/patients/[id]/documents/route.ts'
    - 'src/app/api/patients/[id]/home-operations/route.ts'
    - 'src/app/api/patients/[id]/workflow-preview/route.ts'
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
---

# Use dashboard capability for patient operational reads

## Problem

- summary: Four read-only patient BFF routes reused canVisit and denied approved clerk access to communications, document metadata, home operations, and workflow preview.
- evidence: the four patient route handlers and their authorization-option tests.

## Decision

- adopted: Gate these read-only GET handlers with canViewDashboard while preserving assignment-aware services, PHI read audit, and no-store responses.
- reason: The authenticated operational surface disclosure rule includes communications and attachments, while external send, download, export, and mutation remain separate boundaries.

## Alternatives rejected

- Grant canVisit to clerk — broadens clinical execution.
- Include external send or document download — those require separate output-purpose review.

## Migration

- from: [canVisit on four read-only patient GET handlers] → to: [canViewDashboard]

## Verification

- focused 4 files / 32 tests, route-auth wrapper, API authz status, API response shape, client schema, scoped ESLint, Prettier, diff check, full typecheck: pass.

## Review

- reviewer: unavailable; codex2 pane was not available.

## Future rule candidate

- Treat authenticated operational display as read capability, but keep external output and irreversible actions on distinct capabilities.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-patient-clinical-reads-use-dashboard-capability]]
- canonical: [[file:src/app/api/patients/[id]/communications/route.ts]]
