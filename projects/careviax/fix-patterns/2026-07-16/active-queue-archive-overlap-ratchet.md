---
type: FixPattern
title: Ratchet active plan queues against completed archive IDs
memory_id: projects/careviax/fix-patterns/2026-07-16/active-queue-archive-overlap-ratchet
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
superseded_by: null
evidence_level: gate_verified
validity_scope:
  repo: careviax
  files:
    - Plans.md
    - docs/plans-archive.md
    - tools/scripts/check-plans-active-board.mjs
ingested_via: put_page
ingested_at: '2026-07-16T03:23:58.874Z'
source_kind: put_page
tags:
  - active-queue
  - archive
  - codex1
  - plans
  - ratchet
  - verification
---

# Ratchet active plan queues against completed archive IDs

## Recipe

1. Extract exact task IDs from active implementation tables and checked entries in the completed plan archive.
2. Fail the active-board gate when the sets overlap, even if the active row still says Not started or Partial.
3. Reconcile STATE DONE commit evidence, move completed IDs into the archive, remove active rows, and synchronize the declared count.

## Required checks

- `pnpm exec vitest run tools/scripts/check-plans-active-board.test.ts --reporter=dot`
- `pnpm plans:active:check`
- exact active count and archive overlap 0
- scoped ESLint, `git diff --check`, and `pnpm typecheck`

## Anti-patterns

- Trusting the active status label when current DONE commit evidence exists.
- Deleting a stale row without archiving the completion evidence.
- Checking only the declared count, which can remain internally consistent while completed work is still queued.

## Links

- canonical: [[file:tools/scripts/check-plans-active-board.mjs]]
- evidence: [[file:docs/plans-archive.md]]
