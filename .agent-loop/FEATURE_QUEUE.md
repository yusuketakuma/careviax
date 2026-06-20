# Agent Loop — FEATURE QUEUE

**Purpose.** Intake and lifecycle ledger for feature work flowing through the loop. Every unit
of work is a task with a stable `task_id` and a status that advances through the pipeline.

**How it's used in the loop.**

- New work is appended to `## Queue` as a YAML task block using the schema below.
- The Supervisors select the highest-priority `queued` task each cycle and advance its `status`:
  `queued → planning → reviewing → implementing → verifying → done` (or `blocked`).
- `owner` / `reviewer` map to the lanes: Claude = UI/UX + main implementation
  (`src/app/(dashboard)/**`, `src/components/**`); Codex = backend/perf/refactor/test review.
- A task only moves to `done` after its `verification[]` commands pass (real commands:
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:e2e:audit`).
- `gbrain_memory_used[]` records memory keys/notes consulted.
  STATUS: gbrain MCP not yet connected — see gstack `setup-gbrain` skill. Phase-3 scaffolding;
  leave entries as `[]` until gbrain is live.

## Task schema

```yaml
- task_id: F-YYYYMMDD-NNN # stable id, e.g. F-20260620-001
  status: queued # queued | planning | reviewing | implementing | verifying | done | blocked
  owner: claude-lead # claude-lead (UI lane) | codex-lead (backend lane)
  reviewer: codex-lead # the opposite lane reviews
  priority: P2 # P0 (now) | P1 | P2 | P3
  feature_name: ''
  background: '' # why this exists; link to docs/spec section if any
  user_value: '' # who benefits and how
  acceptance_criteria: # observable, checkable outcomes
    - ''
  constraints: # compliance / design / lane constraints
    - ''
  verification: # exact commands that must pass before done
    - pnpm lint
    - pnpm typecheck
  gbrain_memory_used: [] # memory keys consulted (gbrain not yet connected)
```

## Queue

<!-- No real features yet. Copy the commented template below for each new task.
     Keep highest priority at the top. -->

<!--
- task_id: F-20260620-001
  status: queued
  owner: claude-lead
  reviewer: codex-lead
  priority: P2
  feature_name: ""
  background: ""
  user_value: ""
  acceptance_criteria:
    - ""
  constraints:
    - ""
  verification:
    - pnpm lint
    - pnpm typecheck
  gbrain_memory_used: []
-->

_(queue empty)_
