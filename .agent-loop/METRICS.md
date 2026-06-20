# METRICS — Per-Run Loop Metrics

**Purpose.** Tracks the health of the careviax (PH-OS Pharmacy) agent loop across four
dimensions — quality, speed, memory, safety, cost (spec §16). Supervisors update these
values per run so trends (regressions, drift, cost creep) are visible over time.

**How it is used in the loop.**

- Each run is initialized from the YAML template below with values null/0.
- As gates run and slices land, the owning lane fills in measured values; supervisors
  reconcile at run close.
- Memory metrics stay scaffolded until gbrain is live (see note) — record what is
  measurable today and leave the rest null rather than fabricating.

- run_id (initial): RUN-20260620-001
- cycle: 0 · status: idle · next_action: bootstrap
- date: 2026-06-20

> STATUS: gbrain MCP not yet connected — see gstack `setup-gbrain` skill. The `memory.*`
> metrics below are Phase-3 scaffolding and stay null until gbrain is wired.

---

## Template (initialize per run; all values null/0)

```yaml
run_id: RUN-20260620-001
cycle: 0
status: idle # idle | running | done | blocked
next_action: bootstrap
date: 2026-06-20

quality:
  accepted_change_rate: null # share of proposed changes accepted into the branch
  rollback_rate: null # share of accepted changes later reverted
  regression_rate: null # share of changes that introduced a regression (caught by gates/e2e)
  duplicate_removed_count: 0 # count of duplicate code/components removed this run
  dead_code_removed_count: 0 # count of dead-code units removed this run
  type_error_delta: 0 # change in `pnpm typecheck` error count vs run start (negative = improved)
  lint_error_delta: 0 # change in `pnpm lint` error count vs run start (negative = improved)

speed:
  time_to_green: null # wall-clock from slice start to all cheap gates green
  cycles_to_done: null # loop cycles needed to mark the task done
  review_turnaround: null # time from review request to verdict
  feature_lead_time: null # time from task accepted to merged/done

memory: # STATUS: gbrain MCP not connected — null until wired
  memory_hit_rate: null # share of cycles where a relevant memory/lesson was retrieved
  memory_apply_rate: null # share of retrieved memories actually applied
  stale_memory_rate: null # share of retrieved memories found stale/wrong
  lesson_promotion_rate: null # share of candidate lessons promoted to long-term memory
  lesson_rejection_rate: null # share of candidate lessons rejected

safety:
  blocked_dangerous_actions: 0 # count of destructive actions blocked (e.g. by /careful, guards)
  secret_scan_failures: 0 # secret-scan findings (gate not yet wired — see GATE_CONFIG)
  dependency_audit_findings: 0 # findings from `pnpm audit`

cost:
  token_per_cycle: null # tokens consumed per loop cycle
  token_per_accepted_change: null # tokens consumed per accepted change
  subagent_count_per_cycle: null # number of subagents spawned per cycle
```

---

## Metric definitions (one line each)

**Quality**

- `accepted_change_rate` — share of proposed changes accepted into the branch.
- `rollback_rate` — share of accepted changes later reverted.
- `regression_rate` — share of changes that introduced a regression caught by gates/e2e.
- `duplicate_removed_count` — count of duplicate code/components removed this run.
- `dead_code_removed_count` — count of dead-code units removed this run.
- `type_error_delta` — change in `pnpm typecheck` error count vs run start (negative = improved).
- `lint_error_delta` — change in `pnpm lint` error count vs run start (negative = improved).

**Speed**

- `time_to_green` — wall-clock from slice start to all cheap gates green.
- `cycles_to_done` — loop cycles needed to mark the task done.
- `review_turnaround` — time from review request to verdict.
- `feature_lead_time` — time from task accepted to merged/done.

**Memory** (null until gbrain MCP is connected)

- `memory_hit_rate` — share of cycles where a relevant memory/lesson was retrieved.
- `memory_apply_rate` — share of retrieved memories actually applied.
- `stale_memory_rate` — share of retrieved memories found stale/wrong.
- `lesson_promotion_rate` — share of candidate lessons promoted to long-term memory.
- `lesson_rejection_rate` — share of candidate lessons rejected.

**Safety**

- `blocked_dangerous_actions` — count of destructive actions blocked by guards.
- `secret_scan_failures` — secret-scan findings (gate not yet wired — see GATE_CONFIG).
- `dependency_audit_findings` — findings from `pnpm audit`.

**Cost**

- `token_per_cycle` — tokens consumed per loop cycle.
- `token_per_accepted_change` — tokens consumed per accepted change.
- `subagent_count_per_cycle` — number of subagents spawned per cycle.
