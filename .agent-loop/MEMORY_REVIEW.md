# MEMORY_REVIEW.md

**Purpose.** Working classification of gbrain search results for the current cycle. Each cycle a
Supervisor queries gbrain for memories relevant to the planned work, then sorts the hits into the
four buckets below. The result feeds `LOOP_POLICY.md` (ApplyNow/Consider) and
`PROMOTION_QUEUE.md` (durable lessons). The bucket criteria are defined in
`GBRAIN_SCHEMA.md` §14 (gbrain → LOOP_POLICY mapping); the memory types being classified are §4.

**How it is used in the loop.**

- Filled **per cycle**, after the gbrain search step, before planning.
- `ApplyNow` rows are copied into the run's effective policy.
- `Consider` rows are surfaced to the planning step as optional inputs.
- `Ignore` rows are recorded so the same memory is not re-evaluated next cycle.
- `BlockedContext` rows capture memories whose application is gated by an external dependency.
- Anything in `ApplyNow`/`Consider` that proves out across runs becomes a `PROMOTION_QUEUE.md`
  candidate.

- **Run:** RUN-20260620-001
- **Cycle:** 2 (Memory Bootstrap — first real `gbrain` recall; classified for LOOP_POLICY §9/§10)
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

| memory_id                                                           | type                   | confidence / evidence | → LOOP_POLICY |
| ------------------------------------------------------------------- | ---------------------- | --------------------- | ------------- |
| `projects/careviax/failures/mutation-returns-raw-row-phi-leak`      | FailurePattern         | high / peer_reviewed  | ApplyNow §9   |
| `projects/careviax/fix-patterns/mutation-reuse-get-safe-projection` | FixPattern             | peer_reviewed         | ApplyNow §9   |
| `projects/careviax/decisions/readapijson-schema-fail-closed`        | ImplementationDecision | peer_reviewed         | ApplyNow §10  |

- **§9 PHI redaction symmetry on mutations** — FailurePattern + its FixPattern: a GET that redacts
  via `toSafe*()` and a POST/mutation that returns the raw Prisma row leaks PHI (`reason`,
  `proposed_value`, name/address). Rule: mutations reuse the GET safe-projection; assert the
  response **body** in a test. Strengthens LOOP_POLICY §8 (Compliance by Design).
- **§10 Fail-closed client API reads** — ImplementationDecision: `readApiJson(res, { schema })`
  fail-closes malformed 2xx; `fallbackMessage` stays a static literal (no PHI in error text).

## Consider

_Memories relevant but situational; weighed against this run's objective during planning._

| memory_id                                                         | type         | note                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects/careviax/duplicates/pharmacy-cooperation-api-contracts` | DuplicateMap | consolidate a response schema to shared `src/lib/.../api-contracts.ts` only at **3+** converging screens; keep local below threshold (LOOP_POLICY ## Consider). |

## Ignore

_Memories retrieved but out of scope / superseded; recorded so they are not re-evaluated._

- `projects/careviax/decisions/state-color-token-unification` (ImplementationDecision) — already
  encoded in LOOP_POLICY ApplyNow §7 (State Color tokens SSOT); do not re-litigate.
- `projects/careviax/gates/pharmacy-cooperation-hardening-green-20260620` (GateResult) and
  `projects/careviax/loop-runs/2026-06-20/codex-response-schema-hardening` (LoopRun) — evidence /
  run records, not policy inputs.
- `projects/careviax/lessons/candidates/api-response-validation-and-consolidation`
  (CandidateLesson, `times_confirmed=1`) — **NOT promoted this cycle.** Bundles §9/§10 + the 3+
  consolidation heuristic but promotion to a permanent rule needs 2+ independent runs + §13 gate +
  explicit human approval (PROMOTION_QUEUE.md). Stays a candidate; the underlying high-confidence
  FailurePattern/FixPattern/Decision are applied directly via §9/§10 instead.

## BlockedContext

_Memories whose application is gated by an external dependency; reference the blocker._

- **Security gates (secret scan / dependency audit / SAST)** — recommended, not yet wired; cannot
  be enforced as ApplyNow until configured (LOOP_POLICY ## BlockedContext, `cc:blocked`).
- _gbrain-embeddings_ — **RESOLVED 2026-06-20** (local `ollama:mxbai-embed-large`, 1024d, no
  external egress); semantic `gbrain query`/`search` available. No longer blocking.
