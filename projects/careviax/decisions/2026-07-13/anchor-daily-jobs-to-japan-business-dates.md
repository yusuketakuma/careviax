---
type: ImplementationDecision
title: Anchor daily-job calendar windows to Japan business dates
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/server/jobs/daily-helpers.ts'
  - 'file:src/server/jobs/daily-prescription-original-retention.ts'
  - 'file:src/server/jobs/daily/visits.ts'
  - 'file:src/server/jobs/daily/conferences.ts'
  - 'commit:d8fdb8b9c'
  - 'commit:c56d86781'
  - >-
    test:TZ=UTC pnpm exec vitest run src/server/jobs/daily-helpers.test.ts
    src/server/jobs/daily/conferences.test.ts src/server/jobs/daily.test.ts
task_id: DAILY-JOBS-STARTOFDAY-JST-001
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: >-
  projects/careviax/decisions/2026-07-13/anchor-daily-jobs-to-japan-business-dates
confidence: high
created_at: '2026-07-13T11:07:49.000Z'
created_by: codex-lead
dedupe_key: 00f2e98bef828927d6331137dd66cc1d3630825bdecb046ccc69b96b1e48365f
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-13T11:07:49.000Z'
captured_at: '2026-07-13T11:09:15.074Z'
owner_agent: codex-lead
captured_via: capture-cli
commit_after: c56d86781
commit_before: 38ed665ea
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/server/jobs/daily-helpers.ts
    - src/server/jobs/daily-prescription-original-retention.ts
    - src/server/jobs/daily/visits.ts
    - src/server/jobs/daily/conferences.ts
    - src/server/jobs/daily/visit-support.ts
  tech_stack:
    - TypeScript
    - Prisma
    - Vitest
  directories:
    - src/server/jobs
    - src/lib/utils
ingested_via: put_page
ingested_at: '2026-07-13T11:09:22.988Z'
source_kind: put_page
tags:
  - accepted
  - codex
  - dates
  - jobs
  - jst
  - retention
  - timezone
---

# Anchor daily-job calendar windows to Japan business dates

## Problem

- The shared daily-job `startOfDay` used the runtime timezone, so a UTC production process could use the previous Japan business date near JST midnight.
- Retention queries and fax-age thresholds compared DateTime fields against runtime-local boundaries.
- Conference and retention output formatted UTC date sentinels with runtime-local getters, which could display the previous date in a western process timezone.

## Decision

- Represent a Japan business date as a UTC-midnight date sentinel derived from `japanDateKey`.
- Perform calendar day and year arithmetic with UTC fields, including leap-day clamping.
- Convert DateTime query bounds to real Japan day instants before Prisma comparisons.
- Format date sentinels with UTC fields, and preserve the two explicitly runtime-local visit-support SLA paths behind a separately named helper.

## Alternatives rejected

- Keeping `date-fns` runtime-local day/year arithmetic was rejected because it preserves container timezone coupling.
- Reusing the Japan date sentinel directly as a DateTime query instant was rejected because it leaves a nine-hour edge error.
- Changing the intentionally local visit-support SLA contract was rejected as an unrelated behavior change.

## Migration

- from: runtime-local midnight and local-field sentinel formatting
- to: Japan date sentinel arithmetic, Japan day-instant DB bounds, and UTC sentinel formatting

## Verification

- UTC focused daily suites: 3 files / 59 tests passed.
- America/Los_Angeles conference/helper suites and focused retention tests passed.
- Full Vitest, typecheck, no-unused, lint, format, and Next build passed for the base implementation; the formatter follow-up passed focused UTC and western-timezone regression tests.

## Review

- Codex2 cross-review found the remaining sentinel formatting drift; codex1 fixed it and added the western-timezone regression before ledger closeout.

## Future rule candidate

- Keep date-only sentinels, DateTime query instants, and intentionally runtime-local SLA timestamps as explicitly named domains.

## Links

- canonical: [[file:src/server/jobs/daily-helpers.ts]]
