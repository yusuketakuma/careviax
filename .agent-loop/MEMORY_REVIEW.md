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
- **Cycle:** 0 (idle, next_action: bootstrap)
- **Date:** 2026-06-20

> **STATUS: gbrain MCP not yet connected** — no search results to classify this cycle. Sections
> are intentionally empty scaffolding. Once the `setup-gbrain` skill is run and gbrain search
> returns hits, populate each section from the query results. Do not back-fill with guessed
> memories.

---

## ApplyNow

_Memories that map directly to a non-negotiable rule for this run; copy into LOOP_POLICY ApplyNow._

_(empty — gbrain not connected)_

## Consider

_Memories relevant but situational; weighed against this run's objective during planning._

_(empty — gbrain not connected)_

## Ignore

_Memories retrieved but out of scope / superseded; recorded so they are not re-evaluated._

_(empty — gbrain not connected)_

## BlockedContext

_Memories whose application is gated by an external dependency; reference the blocker._

_(empty — gbrain not connected; the gbrain connection itself is the active blocker — see
LOOP_POLICY.md ## BlockedContext, `cc:blocked`)_
