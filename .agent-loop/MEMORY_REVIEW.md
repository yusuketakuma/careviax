# MEMORY_REVIEW.md

**Purpose.** Working classification of gbrain search results for the current cycle. Each cycle a
Supervisor queries gbrain for memories relevant to the planned work, then sorts the hits into the
four buckets below. The result feeds `LOOP_POLICY.md` (ApplyNow/Consider) and
`PROMOTION_QUEUE.md` (durable lessons).

**How it is used in the loop.**

- Filled **per cycle**, after the gbrain search step, before planning.
- `ApplyNow` rows are copied into the run's effective policy.
- `Consider` rows are surfaced to the planning step as optional inputs.
- `Ignore` rows are recorded so the same memory is not re-evaluated next cycle.
- `BlockedContext` rows capture memories whose application is gated by an external dependency.
- Anything in `ApplyNow`/`Consider` that proves out across runs becomes a `PROMOTION_QUEUE.md`
  candidate.

- **Run:** RUN-20260620-001
- **Cycle:** 1 (active_task: F-20260620-001 — wire AGENTS.md pointer)
- **Date:** 2026-06-20

> **STATUS: gbrain connected 2026-06-20** (after this cycle ran). At the time of Cycle 1 the
> bootstrap had no recall and was substituted with live repo + agmsg history (AGENTS.md is
> codex-lead's lane, committed a2414cdc; the AGENTS.md LOCK contention was resolved by yielding
> to Codex; cross-lane LOCK/approve discipline was the operative prior knowledge). From the next
> cycle, Memory Bootstrap should issue a real `gbrain search`/`gbrain query` (careviax indexed
> read-write) — still subordinate to live repo state per LOOP_POLICY.

---

## ApplyNow

_Memories that map directly to a non-negotiable rule for this run; copy into LOOP_POLICY ApplyNow._

_(empty — no cycle has run a real gbrain query yet)_

## Consider

_Memories relevant but situational; weighed against this run's objective during planning._

_(empty — no cycle has run a real gbrain query yet)_

## Ignore

_Memories retrieved but out of scope / superseded; recorded so they are not re-evaluated._

_(empty — no cycle has run a real gbrain query yet)_

## BlockedContext

_Memories whose application is gated by an external dependency; reference the blocker._

_(empty — gbrain now connected; populate from real queries next cycle — see
LOOP_POLICY.md ## BlockedContext, `cc:blocked`)_
