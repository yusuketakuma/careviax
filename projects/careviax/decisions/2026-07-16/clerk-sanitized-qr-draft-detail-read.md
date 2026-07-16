---
type: ImplementationDecision
title: Separate sanitized QR draft reads from source review
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/qr-scan-drafts/[id]/route.ts'
  - 'file:src/lib/api/route-catalog.ts'
  - 'commit:e49ce33f6'
  - >-
    test:pnpm vitest run 'src/app/api/qr-scan-drafts/[id]/route.test.ts'
    src/lib/api/route-catalog.test.ts
    src/app/api/meta/route-catalog/route.test.ts
  - 'test:pnpm vitest run src/app/api/__tests__/protected-get-routes.test.ts'
  - 'test:pnpm typecheck'
created: '2026-07-16T17:50:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S12
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/clerk-sanitized-qr-draft-detail-read
confidence: high
created_at: '2026-07-16T17:50:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T17:50:00+09:00'
captured_at: '2026-07-16T08:51:42.773Z'
ingested_at: '2026-07-16T08:53:13.554Z'
owner_agent: codex-lead
source_kind: put_page
captured_via: capture-cli
commit_after: e49ce33f6
ingested_via: put_page
commit_before: 9873a1a44
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/qr-scan-drafts/[id]/route.ts'
    - src/lib/api/route-catalog.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/qr-scan-drafts
    - src/lib/api
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - phi-audit
  - qr-scan
---

# Separate sanitized QR draft reads from source review

## Problem

- summary: QR scan draft detail GET was an assignment-aware, success-audited dashboard projection but shared `canVisit` with destructive discard. Prescription intake detail is a neighboring raw/source-review boundary that returns source-level JAHIS and prescription content.
- evidence: QR detail recursively removes raw QR text, payload hash, `rawText`, `rawLine`, and supplemental payload/raw line fields before returning; only a successful lookup records one compact PHI read audit.

## Decision

- adopted: Move only `/api/qr-scan-drafts/:id` GET to `canViewDashboard`; keep DELETE and confirm mutations on `canVisit`; register GET and DELETE as separate catalog entries.
- reason: Authorized clerks need the sanitized operational projection, while discard/confirm mutations and raw source review remain stricter workflow boundaries.

## Alternatives rejected

- Move prescription intake detail — it returns JAHIS supplemental payload/raw line, prescription document URL, and inquiry content without a purpose/read-reason gate.
- Move DELETE or confirm — dashboard read permission must not authorize draft destruction or prescription creation.
- Treat masking as sufficient for all neighboring routes — authorization follows the route purpose and response contract, not masking alone.

## Migration

- from: QR draft detail GET and DELETE shared `canVisit`.
- to: Sanitized GET uses `canViewDashboard`; DELETE and confirm remain `canVisit`.

## Verification

- Focused route/catalog 3 files / 26 tests and protected GET 384 tests passed.
- Route-auth wrapper, API authz, response shape, client schema, DTO, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: User-provided read-only review narrowed the slice to sanitized QR detail and explicitly excluded prescription intake source review.

## Future rule candidate

- Open a dashboard read only when its returned projection is explicitly sanitized, assignment-scoped, and success-audited; keep raw source review and mutations on their dedicated capability.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-audited-visit-record-detail-read]]
- canonical: [[file:src/app/api/qr-scan-drafts/[id]/route.ts]]
