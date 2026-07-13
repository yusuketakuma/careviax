---
type: ImplementationDecision
title: Use Japan business-date keys for daily @db.Date boundaries
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/server/jobs/daily/visits.ts'
  - 'file:src/server/jobs/daily/visit-support.ts'
  - 'file:src/server/jobs/daily/preparation.ts'
  - 'file:src/server/jobs/daily/pca-pumps.ts'
  - 'file:src/server/jobs/daily/compliance-expiry.ts'
  - 'file:src/server/jobs/daily/emergency.ts'
  - 'file:src/server/jobs/daily.test.ts'
  - 'commit:62bcc3819'
  - 'test:TZ=UTC pnpm exec vitest run src/server/jobs/daily.test.ts'
  - >-
    test:TZ=America/Los_Angeles pnpm exec vitest run
    src/server/jobs/daily.test.ts
task_id: DAILY-JOBS-LOCALDATEKEY-JST-002
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/decisions/2026-07-13/use-japan-business-dates-in-daily-jobs
confidence: high
created_at: '2026-07-13T11:25:00.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-13T11:25:00.000Z'
captured_at: '2026-07-13T11:25:26.672Z'
owner_agent: codex-lead
captured_via: capture-cli
commit_after: 62bcc3819
commit_before: 11ef2f40f
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/server/jobs/daily/visits.ts
    - src/server/jobs/daily/visit-support.ts
    - src/server/jobs/daily/preparation.ts
    - src/server/jobs/daily/pca-pumps.ts
    - src/server/jobs/daily/compliance-expiry.ts
    - src/server/jobs/daily/emergency.ts
    - src/server/jobs/daily.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
    - PostgreSQL
  directories:
    - src/server/jobs/daily
ingested_via: put_page
ingested_at: '2026-07-13T11:25:31.369Z'
source_kind: put_page
tags:
  - accepted
  - codex
  - correctness
  - date-boundary
  - jobs
  - prisma
  - timezone
---

# Use Japan business-date keys for daily @db.Date boundaries

## Problem

- summary: Daily jobs derived business-day sentinels and labels from the process timezone, shifting visit demand and other date-only workflows when the runtime was west of Japan.
- evidence: `localDateKey()` and `formatDateKey()` remained in six daily job modules after the shared start-of-day helper had been fixed.

## Decision

- adopted: Derive the current date-only sentinel and business-date labels with `japanDateKey()`, compute visit demand planning start once, and pass the same key to the deadline policy.
- reason: PostgreSQL `@db.Date` values use UTC-midnight sentinels for Japan calendar dates, while operational labels for DateTime inputs also need an explicit Asia/Tokyo projection. One business-date primitive handles both without relying on container timezone.

## Alternatives rejected

- Set the process TZ to Asia/Tokyo - hides the caller bug and leaves behavior deployment-dependent.
- Use UTC formatting for all inputs - correct for canonical date sentinels but wrong for arbitrary DateTime values near the Japan day boundary.
- Change the two explicitly runtime-local visit-support SLA timestamps - those are documented legacy DateTime semantics and outside this date-only fix.

## Migration

- from: runtime-local current-day keys and labels in daily jobs.
- to: explicit Japan business-date keys for visit demand, visit support, initial assessment, PCA, public subsidy/compliance, and emergency coverage.

## Verification

- `TZ=UTC pnpm exec vitest run src/server/jobs/daily.test.ts` -> 47 tests passed.
- `TZ=America/Los_Angeles pnpm exec vitest run src/server/jobs/daily.test.ts` -> 47 tests passed.
- Western-runtime cases explicitly cover PCA, public subsidy, emergency coverage, facility batching, initial assessment, and visit demand.
- Scoped ESLint, Prettier, Plans check, and diff check passed; no `localDateKey(` or `formatDateKey(` remains under the daily implementation directory.

## Review

- reviewer: codex-lead - result: approved after schema and date-only versus DateTime boundary review.

## Future rule candidate

- Japan operational calendar decisions and `@db.Date` boundaries must use `japanDateKey`; process-local date APIs are reserved only for explicitly documented local DateTime behavior.

## Links

- canonical: [[file:src/lib/utils/date-boundary.ts]]
