# Agent Loop — STATE

**Purpose.** Single source of truth for the current loop's runtime state. The two Supervisors
(`claude-lead`, `codex-lead`) read this at the start of every cycle and write it back at the
end. It is the first file consulted on resume and the last file written on a hard-stop.

**How it's used in the loop.**

- At cycle start: read the YAML, confirm `current_run_id` / `current_cycle`, pick up `next_action`.
- During a cycle: update `active_task_id`, `claude_status`, `codex_status` as work proceeds.
- At the gate: write `last_gate_result` (pass | fail | unknown).
- On hard-stop: write the **Resume point** section below so the next session continues cleanly.
- `zero_actionable_count` increments each cycle the queue yields no actionable task; the loop
  idles/backs off when it climbs (see FEATURE_QUEUE.md for intake).
- **Time-elapsed (§14 90-min hard-stop).** `cycle_start_time` is a durable ISO8601 Asia/Tokyo
  timestamp set at run start. At each cycle boundary the Supervisors compute
  `elapsed = now − cycle_start_time`; if `elapsed ≥ 90 min`, trigger a hard-stop (write the
  **Resume point** section, then exit). Because it is persisted here, the budget survives resume —
  do **not** reset it on a mid-run resume; only a fresh run resets it.
- **Files-touched (§14 >20-file hard-stop).** `files_changed_count` is the count of distinct paths
  from `git diff --name-only` measured from the cycle-start tree/commit. Refresh it at each cycle
  boundary; if it exceeds 20, trigger a hard-stop with resume-point persistence (capture
  `active_task_id`, locked paths, and the next command in **Resume point** before exiting).

```yaml
current_run_id: RUN-20260620-001
current_cycle: 4 # Cycle 4: F-20260620-008 Control Plane MVP completed; F-20260620-009 global-search plan review active.
cycle_start_time: 2026-06-20T00:00:00+09:00 # ISO8601 Asia/Tokyo; reset at each run start. elapsed = now − cycle_start_time, checked at every cycle boundary vs §14 90-min hard-stop
active_task_id: F-20260620-009 # Claude-owned global search command-palette plan is in review; F-008 docs/config slice is approved and ready to commit/release.
current_cycle_note: 'Cycle 4: F-008 Control Plane MVP docs/config patch passed prettier/diff/YAML checks and claude CODE_REVIEW_RESULT=approved. Codex returned CHANGES_REQUESTED on F-009 rev1 for shortcut ownership, API wire-shape, permission no-fetch, and combobox/a11y contract gaps.'
files_changed_count: 18 # F-008 .agent-loop docs/config/template paths only; under §14 >20-file hard-stop. machine .harness-mem excluded.
claude_status: planning # Claude is revising F-009 global search after codex CHANGES_REQUESTED.
codex_status: committing # Codex is committing approved F-008 .agent-loop docs/config slice, then releases locks.
last_memory_bootstrap: 2026-06-20 # Cycle 2 real gbrain recall (CLI). Classified in MEMORY_REVIEW.md; §9/§10 → LOOP_POLICY ApplyNow (codex-approved). `mcp__gbrain__*` after restart.
zero_actionable_count: 1 # queue dry after F-003; idle/backoff per FEATURE_QUEUE intake
last_gate_result: pass # F-008 prettier/diff/YAML checks GREEN and claude CODE_REVIEW_RESULT=approved; F-009 rev1 PLAN_REVIEW_RESULT=changes_requested.
next_action: commit F-008 .agent-loop docs/config slice with explicit path staging, release F-008 locks, then wait for F-009 rev2 PLAN_REVIEW_REQUEST.
```

## gbrain memory (this run)

<!-- Per GBRAIN_SCHEMA.md §15: after each `gbrain put`, append the memory_id (= slug) here so the
     run's durable writeback is auditable. Format: `- <type>: <slug> (<commit>)`. -->

- ImplementationDecision: projects/careviax/decisions/state-color-token-unification (smoke-seed 2026-06-20)
- FailurePattern: projects/careviax/failures/mutation-returns-raw-row-phi-leak (2026-06-20, slice7 PHI)
- FixPattern: projects/careviax/fix-patterns/mutation-reuse-get-safe-projection (2026-06-20)
- DuplicateMap: projects/careviax/duplicates/pharmacy-cooperation-api-contracts (2026-06-20, slice8)
- ImplementationDecision: projects/careviax/decisions/readapijson-schema-fail-closed (2026-06-20)
- GateResult: projects/careviax/gates/pharmacy-cooperation-hardening-green-20260620 (full suite 8465 passed)
- LoopRun: projects/careviax/loop-runs/2026-06-20/codex-response-schema-hardening (2026-06-20)
- CandidateLesson: projects/careviax/lessons/candidates/api-response-validation-and-consolidation (→ PROMOTION_QUEUE)
- ReviewFinding: projects/careviax/reviews/hardening-slice-precommit-clean-20260620 (Cycle 2; 0-blocker pre-commit review, links FailurePattern/FixPattern/Decision)
- FailurePattern: projects/careviax/failures/false-empty-and-stale-wipe-on-fetch-failure (Cycle 4; F-004 377d9e1e — false-empty + stale-wipe-on-refetch + fix)
- ReviewFinding: projects/careviax/reviews/statistics-hub-registry-contract-coverage-20260620 (F-007; registry self-consistency tests missed approved manifest coverage)
- ReviewFinding: projects/careviax/reviews/statistics-hub-contract-reconciliation-and-permission-gating-20260620 (F-007 rev6; raw recon reconciliation + page/per-surface permission gating)
- ReviewFinding: projects/careviax/reviews/statistics-hub-rev7-contract-permission-api-mismatch-20260620 (F-007 rev7; green gates missed KPI response contract + destination permission mismatches)
- CandidateLesson: projects/careviax/lessons/candidates/api-response-validation-and-consolidation (F-007 2a4780d0 confirmation; times_confirmed=2, promotion_status=candidate)
- FixPattern: projects/careviax/fix-patterns/route-wire-shape-schema-parity-tests (F-007 2a4780d0; align client schema/test mocks to real route wire shape)

## Resume point

<!-- Written only on hard-stop. Capture: active_task_id, the exact step in progress,
     any locked paths to release, and the single next command/action to take.
     Empty at bootstrap. -->

_(empty)_

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.
