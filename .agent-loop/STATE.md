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
current_cycle: 4 # Cycle 4 active: F-20260620-007 statistics hub plan/patch review loop with codex checker.
cycle_start_time: 2026-06-20T00:00:00+09:00 # ISO8601 Asia/Tokyo; reset at each run start. elapsed = now − cycle_start_time, checked at every cycle boundary vs §14 90-min hard-stop
active_task_id: F-20260620-007 # 統計 hub — rev7 plan approved; awaiting Claude PATCH_REVIEW_REQUEST.
current_cycle_note: 'Cycle 4 review: F-004 done; §11/§12 policy docs committed; F-007 rev5 patch rejected, rev6 contract rejected, rev7 plan approved with hasPermission correction.'
files_changed_count: 8 # dirty worktree: Claude F-007 source paths + machine .harness-mem; codex ledger commits separated.
claude_status: implementing # F-007 rev7 approved; Claude owns statistics/** + navigation-config.{ts,test.ts}.
codex_status: waiting_for_patch_review # codex reviewer; REVIEW_LOG committed aaf06424, PATCH_INBOX PI-002 open.
last_memory_bootstrap: 2026-06-20 # Cycle 2 real gbrain recall (CLI). Classified in MEMORY_REVIEW.md; §9/§10 → LOOP_POLICY ApplyNow (codex-approved). `mcp__gbrain__*` after restart.
zero_actionable_count: 1 # queue dry after F-003; idle/backoff per FEATURE_QUEUE intake
last_gate_result: pass # F-20260620-004 gates GREEN (vitest 10/10, typecheck/no-unused/eslint/format/build); codex APPROVED rev3 after 3 rounds (caught stale-data-on-refetch regression, 404 false alert+color)
next_action: await Claude PATCH_REVIEW_REQUEST for F-007 rev7. Review contract reconciliation (64 raw recon -> exact 23 navigable manifest incl. /admin/jobs), exact manifest tests, page canViewDashboard gate, per-surface hasPermission filtering, direct fetch allowlist, malformed-2xx/stale-refetch/raw-error/org-hydration tests.
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

## Resume point

<!-- Written only on hard-stop. Capture: active_task_id, the exact step in progress,
     any locked paths to release, and the single next command/action to take.
     Empty at bootstrap. -->

_(empty)_

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.
