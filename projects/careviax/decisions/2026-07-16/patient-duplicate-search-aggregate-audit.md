---
type: ImplementationDecision
title: Audit patient duplicate search as one purpose-bound read
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/app/api/patients/check-duplicate/route.ts'
  - 'file:src/lib/api/route-catalog.ts'
  - 'commit:0c8f0d245'
  - >-
    test:pnpm vitest run src/app/api/patients/check-duplicate/route.test.ts
    src/lib/api/route-catalog.test.ts
    src/app/api/meta/route-catalog/route.test.ts
  - 'test:pnpm route-auth-wrapper:check'
  - 'test:pnpm typecheck'
created: '2026-07-16T17:32:00+09:00'
task_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001-S10
repo_url: null
memory_id: >-
  projects/careviax/decisions/2026-07-16/patient-duplicate-search-aggregate-audit
confidence: high
created_at: '2026-07-16T17:32:00+09:00'
created_by: codex-lead
expires_at: null
feature_id: AUTHZ-CLERK-PHARMACIST-BOUNDARY-001
project_id: careviax
updated_at: '2026-07-16T17:32:00+09:00'
owner_agent: codex-lead
commit_after: 0c8f0d245
commit_before: faa890209
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/app/api/patients/check-duplicate/route.ts
    - src/lib/api/route-catalog.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/patients/check-duplicate
    - src/lib/api
ingested_via: put_page
ingested_at: '2026-07-16T08:33:04.905Z'
source_kind: put_page
tags:
  - accepted
  - api
  - authz
  - clerk
  - codex
  - patient-search
  - phi-audit
---

# Audit patient duplicate search as one purpose-bound read

## Problem

- summary: Patient duplicate check returned up to ten candidate identities but required `canVisit` and emitted no successful PHI read audit.
- evidence: The GET route returned candidate ID, name, birth date, and gender after an assignment-aware tenant query.

## Decision

- adopted: Gate the GET with `canViewDashboard` and record exactly one success-only audit after the bounded query resolves. Use fixed view `patient_duplicate_check`, purpose `patient_registration`, target `patient_search/duplicate_check`, no patient ID, and metadata containing only `result_count`.
- reason: Registration staff need the ordinary lookup, while one aggregate event avoids up to ten separate fire-and-forget RLS transactions and prevents query or candidate PHI from entering audit changes.

## Alternatives rejected

- Audit once per candidate — creates unnecessary asynchronous RLS transactions and overstates one search as many reads.
- Store search inputs or candidate identifiers in audit metadata — would persist query and candidate PHI outside the response boundary.
- Audit before validation/query completion — would record denied, invalid, or failed requests as successful PHI reads.

## Migration

- from: `canVisit` with no explicit duplicate-search read audit.
- to: `canViewDashboard` plus one purpose-bound aggregate audit on successful zero-or-more result responses.

## Verification

- Focused route/catalog 3 files / 24 tests cover one result, zero results, auth denial, malformed queries, unsupported gender, impossible date, and DB error audit behavior. Route-auth, API authz/response, client schema, DTO, scoped ESLint, Prettier, diff check, and full typecheck passed.

## Review

- reviewer: read-only review proposed the exact aggregate audit contract; implementation matched it.

## Future rule candidate

- Audit bounded multi-patient search once with fixed purpose and count-only metadata, never once per candidate or with search PHI.

## Links

- builds_on: [[projects/careviax/decisions/2026-07-16/clerk-audited-care-planning-reads]]
- canonical: [[file:src/app/api/patients/check-duplicate/route.ts]]
