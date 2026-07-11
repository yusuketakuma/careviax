---
type: ReviewFinding
title: Report recovery retry needs a synchronous same-key guard
branch: main
source:
  - 'file:src/app/(dashboard)/reports/[id]/page.tsx'
  - 'file:src/app/(dashboard)/reports/[id]/page.test.tsx'
  - 'commit:ab18b3d34'
  - 'test:pnpm-vitest-report-page'
created: '2026-07-11T06:06:07.000Z'
task_id: CODEX-DIRTY-20260711
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/reviews/2026-07-11/report-retry-same-key-concurrency
confidence: high
created_at: '2026-07-11T06:06:07.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-11T06:06:07.000Z'
owner_agent: codex-lead
commit_after: ab18b3d34
commit_before: 1a8a986f522a
superseded_by: null
evidence_level: tested
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - 'src/app/(dashboard)/reports/[id]/page.tsx'
    - 'src/app/(dashboard)/reports/[id]/page.test.tsx'
  tech_stack:
    - React
    - TanStack Query
    - TypeScript
  directories:
    - src/app/(dashboard)/reports
    - src/components/ui
ingested_via: put_page
ingested_at: '2026-07-11T06:12:30.722Z'
source_kind: put_page
tags:
  - codex
  - concurrency
  - fixed
  - idempotency
  - phi
  - recovery
  - report
---

# Report recovery retry needs a synchronous same-key guard

finding_type: ui_regression
severity: medium · status: fixed

## Finding

- summary: A failure-recovery retry could invoke more than one reconciliation request before the first same-key request settled.
- details: UI disabled state alone was insufficient for an immediately repeated event; reconciliation needed a synchronous local guard.

## Evidence

- `src/app/(dashboard)/reports/[id]/page.tsx`
- `src/app/(dashboard)/reports/[id]/page.test.tsx`

## Recommended action

- Guard an active reconciliation synchronously, disable retry while it is active, and preserve the same idempotency key for the retry path.

## Resolution

- action_taken: added a ref-backed in-flight guard, disabled affordance, and double-activation regression test.
- fixed_in_commit: ab18b3d34

## Lesson candidate

- When a recovery action reuses an idempotency key, pair visible disabled state with a synchronous guard so rapid events cannot create parallel reconciliation attempts.

## Links

- targets: [[file:src/app/(dashboard)/reports/[id]/page.tsx]]
- from_run: [[projects/careviax/loop-runs/2026-07-11/codex-dirty-20260711]]
