---
type: ImplementationDecision
title: Serialize medication profile synchronization per organization and patient
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/server/services/prescription-intake-service.ts'
  - 'file:src/server/services/prescription-intake-service.test.ts'
  - 'file:src/app/api/prescription-intakes/route.test.ts'
  - 'commit:30fcf954eebcfeff863303020250611650f055da'
  - >-
    test:pnpm exec vitest run src/lib/db/advisory-lock.test.ts
    src/server/services/prescription-intake-service.test.ts
    src/app/api/prescription-intakes/route.test.ts
  - 'test:pnpm exec vitest run'
  - 'test:pnpm build'
task_id: MEDPROFILE-SYNC-RACE-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/decisions/2026-07-13/serialize-medication-profile-sync
confidence: high
created_at: '2026-07-13T10:33:30.000Z'
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 30fcf954eebcfeff863303020250611650f055da
commit_before: f5c71f85c2073d640543ae8b0861b0f3e7ceb016
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/server/services/prescription-intake-service.ts
    - src/server/services/prescription-intake-service.test.ts
    - src/app/api/prescription-intakes/route.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
    - PostgreSQL
  directories:
    - src/server/services
    - src/app/api/prescription-intakes
ingested_via: put_page
ingested_at: '2026-07-13T10:34:59.372Z'
source_kind: put_page
tags:
  - accepted
  - advisory-lock
  - concurrency
  - medical-safety
  - medication-profile
  - prisma
  - transaction
---

# Serialize medication profile synchronization per organization and patient

## Problem

- Post-intake medication profile synchronization read current rows and then created, refreshed, or discontinued rows through separate global Prisma statements.
- Two concurrent intakes for the same patient could observe the same stale snapshot and create duplicate current rows for one drug identity, affecting downstream medication safety consumers.

## Decision

- Resolve global DrugMaster prescription-code references before entering the patient-critical section.
- Run the complete MedicationProfile read-modify-write sequence in one `withOrgContext` transaction.
- Acquire the existing transaction-scoped advisory lock in namespace `medication_profile_sync`, keyed by organization and patient, before reading current profiles.
- Keep explicit organization and patient filters as defense in depth even inside the RLS-scoped transaction.

## Alternatives rejected

- A partial unique index and upsert were not introduced because that requires the human-gated migration and representative DB review lane; the transaction lock closes the proven race without schema change.
- Locking only the create statement was rejected because refresh and discontinue decisions must use the same serialized snapshot.
- Resolving global DrugMaster codes while holding the patient lock was rejected because those reads do not participate in the profile invariant and would lengthen lock hold time.

## Verification

- Focused Vitest passed: 3 files, 121 tests.
- The concurrency regression launches two same-patient hooks and proves one current profile, created counts `[0, 1]`, and no global MedicationProfile delegate use.
- Shared full Vitest passed: 1549 files passed, 3 skipped; 16078 tests passed, 13 skipped.
- Typecheck, no-unused, scoped ESLint and Prettier, DB query-shape and raw-read organization guards, and the 311-page production build passed.

## Review

- Medical and privacy review approved the final change with no blocking finding.
- The review separated different-payload freshness policy, failure recovery, other writers, and historical duplicate repair into follow-up work.

## Future rule candidate

- Any read-modify-write invariant without a database uniqueness constraint must serialize the complete read and all dependent writes in one organization-scoped transaction.

## Follow-up

- Decide the clinical freshness policy for different-payload concurrent intakes before adding version or event-time precedence.
- Add PHI-safe failure metrics and reconciliation, align all MedicationProfile writers on the invariant, and inventory historical duplicates before any production mutation.

## Links

- related: [[projects/careviax/rejected/2026-07-13/collapse-drugmaster-code-lookups-into-multicolumn-or]]
- canonical: [[file:src/server/services/prescription-intake-service.ts]]
