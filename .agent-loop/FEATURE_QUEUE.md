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
  STATUS: gbrain connected 2026-06-20 (local postgres; careviax indexed read-write). Populate
  this with the `gbrain search`/`gbrain query` hits a task actually consulted. `mcp__gbrain__*`
  tools require a Claude Code restart; the `gbrain` CLI works now.

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
  gbrain_memory_used: [] # memory keys/queries consulted (gbrain connected — fill from `gbrain search`/`query` hits)
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

```yaml
- task_id: F-20260620-001
  status: done # commit a1c916ac (codex, AGENTS.md lane); reviewed+verified by claude-lead. Cycle 1.
  owner: claude-lead
  reviewer: codex-lead
  priority: P3
  feature_name: Wire AGENTS.md pointer to the agent-loop operator guide
  background: >
    Spec §4 lists AGENTS.md among the loop's wired docs. The .agent-loop/ scaffold
    (2986725b) added a CLAUDE.md pointer but deferred AGENTS.md because Codex held a
    LOCK on it (committed a2414cdc). This task closes that loose end via cross-lane
    coordination — the first real dogfood cycle of the loop itself.
  user_value: >
    A Codex operator opening AGENTS.md (its primary instructions) is pointed to the
    loop's operator guide, so both supervisors share one entry point.
  acceptance_criteria:
    - AGENTS.md contains a one-line pointer to .agent-loop/README.md.
    - Edit is made/approved in Codex's lane (AGENTS.md = codex-lead), not unilaterally.
    - No behavior/code change; docs only.
  constraints:
    - AGENTS.md is codex-lead's lane — coordinate over agmsg, do not edit unilaterally.
    - Docs only; no auth/billing/security/migration surface.
  verification:
    - pnpm exec prettier --check AGENTS.md
    - git diff --check
  gbrain_memory_used: [] # gbrain not connected; substituted with repo+agmsg history
```
