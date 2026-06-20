# METRICS — Per-Run Loop Metrics

**Purpose.** Tracks the health of the careviax (PH-OS Pharmacy) agent loop across six
dimensions — quality, speed, memory, loop engineering, safety, cost (spec §16). Supervisors
update these values per run so trends (regressions, drift, cost creep, process improvement) are
visible over time.

**How it is used in the loop.**

- Each run is initialized from the YAML template below with values null/0.
- As gates run and slices land, the owning lane fills in measured values; supervisors
  reconcile at run close.
- Memory metrics stay scaffolded until gbrain is live (see note) — record what is
  measurable today and leave the rest null rather than fabricating.

- run_id (initial): RUN-20260620-001
- cycle: 0 · status: idle · next_action: bootstrap
- date: 2026-06-20

> STATUS: gbrain connected 2026-06-20 (careviax indexed read-write). The `memory.*`
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
  recurrence_rate: null # share of this run's regressions matching a gbrain FailurePattern from a prior run (incomplete fix); null until gbrain queries populate
  type_error_delta: 0 # change in `pnpm typecheck` error count vs run start (negative = improved)
  lint_error_delta: 0 # change in `pnpm lint` error count vs run start (negative = improved)

speed:
  time_to_green: null # wall-clock from slice start to all cheap gates green
  cycles_to_done: null # loop cycles needed to mark the task done
  review_turnaround: null # time from review request to verdict
  feature_lead_time: null # time from task accepted to merged/done

memory: # STATUS: gbrain connected 2026-06-20 — populate once cycles issue real gbrain queries
  memory_hit_rate: null # share of cycles where a relevant memory/lesson was retrieved
  memory_apply_rate: null # share of retrieved memories actually applied
  stale_memory_rate: null # share of retrieved memories found stale/wrong
  lesson_promotion_rate: null # share of candidate lessons promoted to long-term memory
  lesson_rejection_rate: null # share of candidate lessons rejected

loop_engineering:
  pdca_experiments_started: 0 # bounded process-improvement hypotheses started this run
  pdca_experiments_checked: 0 # experiments with a measured Check result
  method_pattern_memories_written: 0 # useful methods saved as reusable gbrain memories
  anti_pattern_memories_written: 0 # improvable methods saved as FailurePattern/RejectedApproach/ReviewFinding
  review_gate_miss_count: 0 # issues gates missed but peer review caught
  post_approval_rework_count: 0 # changes needed after an APPROVED review/gate
  candidate_lessons_created: 0 # loop-engineering CandidateLessons created this run

safety:
  blocked_dangerous_actions: 0 # count of destructive actions blocked (e.g. by /careful, guards)
  permission_escalation_requests: 0 # count of permission-elevation requests rejected or requiring human approval
  secret_scan_failures: 0 # secret-scan findings (gate not yet wired — see GATE_CONFIG)
  dependency_audit_findings: 0 # findings from `pnpm audit`

cost:
  token_per_cycle: null # tokens consumed per loop cycle
  token_per_accepted_change: null # tokens consumed per accepted change
  subagent_count_per_cycle: null # number of subagents spawned per cycle
```

---

## Policy and emphasis (§18.1)

Supervisors weight **outcome over volume** when reading these metrics:

- **Primary signals**: `cost_per_accepted_change` (cost block's `token_per_accepted_change`)
  and the regression/recurrence pair (`regression_rate`, `recurrence_rate`). A run that
  ships fewer changes but introduces no regressions and re-manifests no prior FailurePattern
  is healthier than a high-volume run that recurs bugs.
- **Secondary signals**: loop volume — `cycles_to_done` and `subagent_count_per_cycle`. Treat
  these as efficiency context, not as targets to maximize. High volume with poor primary
  signals is a regression in loop health, not progress.

---

## Collection and reconciliation (§18.2)

Who populates what, and when:

- **Cadence**: supervisors populate measured values at **cycle close**, reconciling lane
  inputs into a single per-run record (template above initialized null/0 at cycle open).
- **`regression_rate`**: fed from `VERIFY_LOG.md` (gate/e2e regression findings for the run).
- **`accepted_change_rate`**: fed from `REVIEW_LOG.md` (accepted vs proposed changes).
- **`recurrence_rate`**: fed by **codex-lead** post-gate gbrain `FailurePattern` queries —
  matching this run's regressions against prior-run FailurePatterns. Stays null until gbrain
  queries populate (see STATUS note and Memory block).
- **`loop_engineering.*`**: fed at cycle close from REVIEW_LOG / PATCH_INBOX / VERIFY_LOG / gbrain
  writeback. Count only evidence-backed PDCA work; do not count raw brainstorming.

---

## Metric definitions (one line each)

**Quality**

- `accepted_change_rate` — share of proposed changes accepted into the branch.
- `rollback_rate` — share of accepted changes later reverted.
- `regression_rate` — share of changes that introduced a regression caught by gates/e2e.
- `duplicate_removed_count` — count of duplicate code/components removed this run.
- `dead_code_removed_count` — count of dead-code units removed this run.
- `recurrence_rate` — share of this run's regressions matching a gbrain FailurePattern from a prior run (i.e. an incomplete fix re-manifesting the same bug class); null until gbrain queries populate.
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

**Loop Engineering**

- `pdca_experiments_started` — bounded process-improvement hypotheses started this run.
- `pdca_experiments_checked` — PDCA experiments with a measured Check result.
- `method_pattern_memories_written` — useful loop methods saved as reusable gbrain memories.
- `anti_pattern_memories_written` — improvable methods saved as FailurePattern / RejectedApproach / ReviewFinding.
- `review_gate_miss_count` — issues that objective gates missed but peer review caught.
- `post_approval_rework_count` — changes required after a prior APPROVED review/gate.
- `candidate_lessons_created` — loop-engineering CandidateLessons created this run.

**Safety**

- `blocked_dangerous_actions` — count of destructive actions blocked by guards.
- `permission_escalation_requests` — count of permission-elevation requests rejected or requiring human approval.
- `secret_scan_failures` — secret-scan findings (gate not yet wired — see GATE_CONFIG).
- `dependency_audit_findings` — findings from `pnpm audit`.

**Cost**

- `token_per_cycle` — tokens consumed per loop cycle.
- `token_per_accepted_change` — tokens consumed per accepted change.
- `subagent_count_per_cycle` — number of subagents spawned per cycle.
