---
type: ImplementationDecision
title: Audit self-report detail only after stable assignment validation
task_id: AUTHZ-SELF-REPORT-READ-AUDIT-001
memory_id: >-
  projects/careviax/decisions/2026-07-14/audit-self-report-detail-after-stable-assignment
confidence: high
created_by: codex1
expires_at: null
project_id: careviax
captured_at: '2026-07-14T03:02:36.983Z'
owner_agent: codex1
captured_via: capture-cli
commit_after: f9e141185
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex2
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patient-self-reports/[id]/route.ts'
    - 'src/app/api/patient-self-reports/[id]/route.test.ts'
    - src/lib/audit/phi-read-audit.ts
  directories:
    - src/app/api/patient-self-reports
    - src/lib/audit
ingested_via: put_page
ingested_at: '2026-07-14T03:02:38.285Z'
source_kind: put_page
tags:
  - accepted
  - audit
  - authorization
  - codex
  - phi
  - self-report
  - toctou
---

# Audit self-report detail only after stable assignment validation

## Problem

- The self-report detail endpoint returned reporter identity, relationship, subject, free-text content, and preferred contact time without the canonical PHI read-audit signal.
- Its access check used an initial report-to-patient reference, but the final detail query constrained only report and organization identifiers. A concurrent patient reassignment could make the final row differ from the assignment-checked patient.

## Decision

- Constrain the final detail query with the previously assignment-checked patient identifier.
- Emit the existing PHI-safe, fire-and-forget read audit only after that final constrained query succeeds.
- Use the authoritative final report and patient identifiers as the compact audit target, without reporter identity or self-report content.
- Apply the same audit rule to unmasked pharmacist and masked clerk responses.

## Alternatives rejected

- Auditing after the initial reference lookup was rejected because assignment, final-row drift, missing rows, and failures must remain zero-audit.
- Trusting an unconstrained final read was rejected because its patient relationship could drift after the assignment check.
- Copying reporter, subject, content, or contact fields into audit metadata was rejected because the access signal must stay compact and PHI-safe.

## Migration

- from: assignment check followed by an unconstrained final detail read and no access audit
- to: patient-pinned final read followed by canonical PHI read audit

## Verification

- Focused route suite: 1 file / 20 tests passed.
- Pharmacist and clerk success paths audit; blank, assignment miss, final patient drift, lookup failure, and auth rejection remain no-store and zero-audit.
- Exact ESLint, Prettier, diff, authorization, route-auth, API-shape, PHI-log, and raw-org checks passed.
- `pnpm typecheck` and bare `pnpm typecheck:no-unused` passed after the final drift guard.

## Review

- reviewer: codex2
- result: approved after the patient reassignment TOCTOU guard was added

## Future rule candidate

- When authorization is derived from a related entity, constrain the final PHI read with the same relationship before returning or auditing the row.

## Links

- canonical: [[file:src/lib/audit/phi-read-audit.ts]]
- route: [[file:src/app/api/patient-self-reports/[id]/route.ts]]
- guard: [[file:src/app/api/patient-self-reports/[id]/route.test.ts]]
