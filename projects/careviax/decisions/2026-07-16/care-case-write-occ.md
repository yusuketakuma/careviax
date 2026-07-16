---
type: project
title: Care Case Write Occ
ingested_via: put_page
ingested_at: '2026-07-16T00:41:52.761Z'
source_kind: put_page
---

---

type: ImplementationDecision
title: Care case writes use fresh authorization and version CAS
memory_id: projects/careviax/decisions/2026-07-16/care-case-write-occ
project_id: careviax
repo_url: null
branch: codex1/continuous-optimization-20260716
commit_before: a47ce740b3898ef5f15f2a9ff766155ac7ad8cc5
commit_after: null
task_id: MEDSAFE-CARE-CASE-WRITE-OCC-001
feature_id: null
created_at: 2026-07-16T00:40:00Z
updated_at: 2026-07-16T00:40:00Z
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: null
source:

- file:prisma/schema/patient.prisma
- file:src/app/api/cases/[id]/route.ts
- file:src/app/api/cases/[id]/transition/route.ts
- test:pnpm exec vitest run care case focused suite
- test:pnpm typecheck:no-unused
- test:pnpm rls-policy-contract:check
- test:pnpm test:rls-proof
  confidence: high
  evidence_level: gate_verified
  validity_scope:
  repo: careviax
  directories: [prisma, src/app/api/cases, src/app/api/patients, src/server/services]
  files: [prisma/schema/patient.prisma, src/app/api/cases/[id]/route.ts, src/app/api/cases/[id]/transition/route.ts]
  tech_stack: [Next.js, TypeScript, Prisma, PostgreSQL]
  expires_at: null
  superseded_by: null
  dedupe_key: 59216896f6f85cb6c0a1cee87c03b537804301c091aca0a285d986004df87b07
  tags: [medsafe, care-case, concurrency, authorization, audit, prisma, rls, codex-lead, accepted]

---

# Care case writes use fresh authorization and version CAS

## Problem

- summary: CareCase edits and transitions authorized against pre-transaction state and guarded updates without a version token, so membership, assignment, or background-write races could permit stale overwrites or split operational history from the mutation.
- evidence: `src/app/api/cases/[id]/route.ts`, `src/app/api/cases/[id]/transition/route.ts`

## Decision

- adopted: Require the caller's current CareCase version, re-read active membership, permission, assignment, case status, and assignable target memberships inside the tenant transaction, then update by organization, assignment, status, and version while incrementing version. Write patient-facing field revisions, PHI-minimized audit, and transition tasks in that same transaction.
- reason: Authorization and concurrency predicates must be evaluated at the write boundary. A status guard alone cannot detect background edits that preserve status, and history written outside the transaction can diverge from the CareCase row.

## Alternatives rejected

- Timestamp-only comparison — less explicit for API consumers and can depend on database timestamp precision.
- Preflight authorization plus ID-only update — membership or assignment can change between reads and mutation.
- Revision and audit after transaction commit — permits a successful mutation with missing operational history.

## Migration

- from: preflight reads and status-only or ID-only writes → to: `CareCase.version` with fresh transactional authorization and compare-and-swap updates.

## Verification

- Focused case, transition, patient-intake, and conference-sync tests passed: 80/80.
- Prisma validation/generation, local migration application through 166 migrations, client JSON schema, exact ESLint, no-unused typecheck, RLS contract 24/24, and NOBYPASSRLS proof 5/5 passed.

## Review

- reviewer: codex-lead · result: self-reviewed; the active workspace exposed no independent codex2 pane.

## Future rule candidate

- Every writer of a versioned aggregate must advance its version, including background and adjacent aggregate-sync paths; authorization and revision/audit side effects belong in the same transaction as the guarded write.

## Links

- canonical: [[file:src/app/api/cases/[id]/route.ts]]
- transition: [[file:src/app/api/cases/[id]/transition/route.ts]]
