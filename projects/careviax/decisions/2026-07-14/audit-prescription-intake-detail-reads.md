---
type: ImplementationDecision
title: Audit successful prescription intake detail reads
task_id: AUTHZ-PRESCRIPTION-INTAKE-READ-AUDIT-001
memory_id: projects/careviax/decisions/2026-07-14/audit-prescription-intake-detail-reads
confidence: high
created_by: codex1
expires_at: null
project_id: careviax
captured_at: '2026-07-14T02:46:14.350Z'
owner_agent: codex1
captured_via: capture-cli
commit_after: d5ecb9f9c
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex2
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/prescription-intakes/[id]/route.ts'
    - 'src/app/api/prescription-intakes/[id]/route.test.ts'
    - src/lib/audit/phi-read-audit.ts
  directories:
    - src/app/api/prescription-intakes
    - src/lib/audit
ingested_via: put_page
ingested_at: '2026-07-14T02:46:16.913Z'
source_kind: put_page
tags:
  - accepted
  - audit
  - authorization
  - codex
  - phi
  - prescription
---

# Audit successful prescription intake detail reads

## Problem

- The prescription intake detail endpoint returned patient identity, prescription lines, insurance-related JAHIS content, and inquiry details after authorization and assignment checks.
- The response was correctly no-store, but a successful detail read did not create the standard PHI read audit signal.

## Decision

- Invoke the existing PHI-safe, fire-and-forget read-audit helper only after a successful organization- and assignment-scoped detail lookup.
- Record the linked patient identifier when available and always identify the viewed prescription intake as the audit target.
- Keep response, query, authorization, assignment, no-store, and error behavior unchanged.

## Alternatives rejected

- Auditing before the lookup was rejected because invalid, unauthorized, missing, and failed reads must not be recorded as successful PHI access.
- Adding raw prescription, JAHIS, patient, or inquiry content to audit metadata was rejected because the audit signal must remain compact and PHI-safe.
- Making the existing detail endpoint require new purpose or read-reason parameters was rejected as an unrelated public contract change.

## Migration

- from: authorized detail response without a read audit
- to: successful detail response plus the canonical PHI read-audit helper

## Verification

- Focused route suite: 1 file / 26 tests passed.
- Linked and unlinked successful reads record the expected target; blank, missing, failed, and auth-rejected reads record nothing.
- Exact ESLint, Prettier, diff, authorization, route-auth, API-shape, PHI-log, and raw-org checks passed.
- Shared `pnpm typecheck` and bare `pnpm typecheck:no-unused` passed.

## Review

- reviewer: codex2
- result: approved; no medical, privacy, authorization, or audit-semantics blocker

## Future rule candidate

- Patient-level PHI detail GET routes should emit the canonical compact read audit only after successful scoped retrieval.

## Links

- canonical: [[file:src/lib/audit/phi-read-audit.ts]]
- route: [[file:src/app/api/prescription-intakes/[id]/route.ts]]
- guard: [[file:src/app/api/prescription-intakes/[id]/route.test.ts]]
