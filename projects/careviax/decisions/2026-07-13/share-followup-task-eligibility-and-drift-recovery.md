---
type: ImplementationDecision
title: Share follow-up task eligibility and authoritative drift recovery
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/server/services/dashboard-assignment-scope.ts'
  - 'file:src/app/api/tasks/route.ts'
  - 'file:src/app/api/patients/[id]/route.ts'
  - 'file:src/app/api/care-reports/[id]/route.ts'
  - 'file:src/app/(dashboard)/patients/[id]/share/external-share-content.tsx'
  - >-
    file:src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx
  - 'commit:dcff0860c9a7a25b1f286372a733bc9e637ce090'
  - 'test:pnpm exec vitest run focused-share-followup-files'
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm test'
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm build'
task_id: AUTHZ-SHARE-FOLLOWUP-ELIGIBILITY-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: >-
  projects/careviax/decisions/2026-07-13/share-followup-task-eligibility-and-drift-recovery
confidence: high
created_at: '2026-07-13T09:53:33.000Z'
created_by: codex-lead
dedupe_key: 22313edbd6c8a28f727cffddfdb186332e7039a33d676d2f31818fe4618b45fd
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-13T09:53:33.000Z'
owner_agent: codex-lead
commit_after: dcff0860c9a7a25b1f286372a733bc9e637ce090
commit_before: 42262e794e27aa2ee2356316c5b3b9d915677cd6
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/server/services/dashboard-assignment-scope.ts
    - src/app/api/tasks/route.ts
    - 'src/app/api/patients/[id]/route.ts'
    - 'src/app/api/care-reports/[id]/route.ts'
    - 'src/app/(dashboard)/patients/[id]/share/external-share-content.tsx'
    - 'src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx'
  tech_stack:
    - Next.js
    - React
    - TypeScript
    - Prisma
    - React Query
  directories:
    - src/server/services
    - src/app/api/tasks
    - src/app/api/patients
    - src/app/api/care-reports
    - src/app/(dashboard)/patients
    - src/app/(dashboard)/reports
ingested_via: put_page
ingested_at: '2026-07-13T09:54:35.891Z'
source_kind: put_page
tags:
  - accepted
  - assignment-scope
  - authorization
  - codex-lead
  - fail-closed
  - privacy
  - react-query
  - sharing
  - tasks
---

# Share follow-up task eligibility and authoritative drift recovery

## Problem

- Patient and care-report share workspaces could display an enabled follow-up-task action to a pharmacist or trainee who could read the resource but was outside the personal dashboard assignment scope enforced by `POST /api/tasks`.
- A cached positive permission could remain after assignment changed, allowing repeated rejected POST attempts even though the server stayed fail-closed.

## Decision

- Extract the existing task-route assignment predicate unchanged into the dashboard assignment service and reuse it for both the authoritative task write and authenticated patient/report permission projections.
- Preserve owner/admin unrestricted scope and pharmacist/trainee patient-assignment scope. Do not relax the POST authorization boundary.
- Partition all share PHI queries and local workspace state by organization, resource, actor ID, and role; do not start PHI queries before authorization hydration.
- Treat task POST 400, 401, 403, or 404 as an authoritative drift signal: lock every share write, refetch the primary authorization projection, hide cached PHI on primary 4xx, retain only read-only cached data on network/5xx, and remove the task action and retry when fresh permission is false.

## Alternatives rejected

- Role-only UI permission was rejected because org-wide read permission is broader than personal task assignment scope.
- Relaxing `POST /api/tasks` was rejected because it would weaken the existing authorization contract.
- Retrying from cached permission without primary refetch was rejected because it permits repeated known-invalid writes after assignment drift.
- Exposing this permission through public token DTOs was rejected; it remains authenticated patient/report metadata only.

## Migration

- From: a route-private assignment predicate and role-level share affordance.
- To: one shared predicate used by task POST and patient/report provider projections, with actor-isolated client caches and authoritative rejection recovery.

## Verification

- Focused Vitest: 7 files, 221 tests passed.
- Full Vitest: 1549 files passed, 3 skipped; 16059 tests passed, 13 skipped.
- Scoped ESLint and Prettier, 8 GiB typecheck and no-unused, frontend/API/schema/auth/raw-read/PHI/module/task/color/plan static gates passed.
- Next.js 16.2.9 production build passed with 311 pages; two pre-existing CSS optimizer warnings remained non-blocking.

## Review

- Read-only contract, independent, and medical/privacy reviewers approved the final implementation.
- No authorization weakening, PHI leakage, public DTO expansion, or repeat-write path remained.

## Future rule candidate

- Any UI write eligibility that is narrower than read access must be projected from the exact server write evaluator. A definitive authorization rejection must invalidate the primary permission projection and lock all related writes until fresh state is known.

## Follow-up

- Replace full personal-case enumeration with a target-patient eligibility query only if profiling proves the current detail-read cost meaningful; correctness and evaluator parity must remain unchanged.

## Links

- related: [[projects/careviax/decisions/2026-07-13/task-assignee-eligibility-and-idempotent-recovery]]
- canonical: [[file:src/server/services/dashboard-assignment-scope.ts]]
- canonical: [[file:src/app/api/tasks/route.ts]]
- consumers: [[file:src/app/(dashboard)/patients/[id]/share/external-share-content.tsx]]
- consumers: [[file:src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx]]
