> **【2026-07-04 以降の注意】現行の運用体制は `ops/refactor/STATE.md` が SSOT。**
> 本ディレクトリの古い記述（rev8 / Claude main / Codex-only 等の体制説明）は歴史的記録であり、
> 矛盾時は STATE.md に従う。
> **【2026-07-05 以降の注意】進捗台帳も `ops/refactor/STATE.md` へ集約。**
> `CODEX_GOAL_PROGRESS.md`、`.codex/ralph-state.md`、`ops/refactor/LOG.md`、
> `ops/refactor/BACKLOG.md` は履歴参照専用で、新規進捗追記は禁止。

# Agent Loop — Operator Guide

> Current mode (2026-07-04 JST): **single Codex operation** for **careviax (PH-OS Pharmacy)**.
> `codex` owns planning, implementation, verification, the single ledger, and scoped commits. Do not use agmsg,
> codex2/codex3/codex4, Claude, subagents, or external worker lanes unless the user explicitly re-enables
> that workflow.
> gbrain remains long-term memory subordinate to live repository state.

This directory holds the human/operator entry points and the live operational artifacts for the loop. Start here.

---

## 1. What this loop is

Current active loop:

- **codex** — single active operator. Plans from live repo state, implements the smallest complete slice,
  runs focused validation, updates the single active ledger, and creates scoped commits when a coherent validated slice is ready.
- **gbrain** — long-term memory subordinate. Provides recall (past decisions, prior art) but **never overrides live repo state**. When repo and gbrain disagree, the repo wins; gbrain gets a writeback correction.

Disabled unless the user explicitly re-enables them: agmsg, codex2, codex3, codex4, Claude,
subagents, PATCH_REPORT routing, external maker/checker handoff, and recursive subagent fan-out.
Historical references below explain the previous loop only.

Historical two-supervisor model, retained for context only and not active:

- **claude-lead** (= agmsg identity `claude` on team `phos`) — the **main implementer**. Owns UI/UX and main feature implementation: `src/app/(dashboard)/**`, `src/components/**`. Studies existing code first, implements, runs the objective gate.
- **codex-lead** (= agmsg identity `codex` on team `phos`) — the **independent peer reviewer / strict verifier / limited assisting implementer**. Owns backend/perf/refactor/test-review review passes. Reviews Claude's diffs and returns `APPROVED` or `CHANGES_REQUESTED`. Implements only within an explicitly LOCKed scope.
- **gbrain** — long-term memory subordinate. Provides recall (past decisions, prior art) but **never overrides live repo state**. When repo and gbrain disagree, the repo wins; gbrain gets a writeback correction.

### 1.1 Communication mode

Current communication is direct user ⇄ Codex only. Do not drain or send agmsg messages, do not wait for
PATCH_REPORTs, do not route work to external worker lanes, and do not spawn subagents. If a later instruction
re-enables agmsg, update `ops/refactor/STATE.md` first, then revive the historical protocol intentionally.

Operational compression rules:

- Record compact state only in `ops/refactor/STATE.md` instead of chat-style routing messages.
- Do not append new progress entries to `CODEX_GOAL_PROGRESS.md`, `.codex/ralph-state.md`,
  `ops/refactor/LOG.md`, or `ops/refactor/BACKLOG.md`; they are historical/reference files.
- Keep long Next.js gates serialized. Do not run `pnpm build` concurrently with `pnpm typecheck`
  or `pnpm typecheck:no-unused`; `.next/types` can race.
- Keep validation summaries short: changed paths, delta, validation, risk, and remaining work.

Long gate lease helper:

```bash
.agent-loop/scripts/long-gate-lock.sh acquire codex "pnpm build" 90
.agent-loop/scripts/long-gate-lock.sh status
.agent-loop/scripts/long-gate-lock.sh release codex "PASS pnpm build"
```

If `acquire` reports `status=locked`, do not start the gate. In current single-Codex mode, prefer direct
process inspection and wait for the conflicting local gate to finish rather than using agmsg negotiation.

---

## 2. File map (`.agent-loop/`)

| File                        | Purpose                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                 | This operator guide — system overview, loops, hard-stops, rollout status.                                                                                                            |
| `CONTROL_PLANE.md`          | Control Plane MVP SSOT: task/routing/policy/eval/approval/promotion/incident boundaries mapped to this file-plane loop.                                                              |
| `CONTROL_PLANE_CONFIG.yml`  | Machine-readable advisory policy for the Control Plane MVP. Descriptive only until runtime enforcement is implemented.                                                               |
| `STATE.md`                  | Single source of truth for the current run/cycle; resume point on hard-stop.                                                                                                         |
| `FEATURE_QUEUE.md`          | Feature intake queue (task_id, status, owner/reviewer, acceptance criteria).                                                                                                         |
| `LOCKS.md`                  | Historical edit-conflict ledger from the previous agmsg LOCK discipline. Current single-Codex mode uses live `git status` + scoped staging.                                          |
| `LOOP_POLICY.md`            | Per-run policy distilled from gbrain (ApplyNow / Consider / Ignore / BlockedContext).                                                                                                |
| `MEMORY_REVIEW.md`          | Classification of gbrain search results (gbrain connected 2026-06-20).                                                                                                               |
| `PROMOTION_QUEUE.md`        | CandidateLesson → AGENTS.md/CLAUDE.md/Skill promotion candidates (§13 criteria).                                                                                                     |
| `GBRAIN_SCHEMA.md`          | **SSOT for gbrain memory**: 26 memory types, common metadata, slug/type design, graph edges, save timing, redaction, quality score, Claude/Codex split, writeback rule, MVP phasing. |
| `templates/gbrain/`         | Fill-in `gbrain put`-ready page templates for the MVP memory types (loop-run, gate-result, decision, …).                                                                             |
| `MESSAGE_PROTOCOL.md`       | Historical AGLOOP v5 agmsg envelope + message types + transport (§8).                                                                                                                |
| `SUBAGENT_JOBS.md`          | Historical registry of subagent job types (explorer/dup-scanner/verifier/…).                                                                                                         |
| `REVIEW_LOG.md`             | Append-only review results log. In current single-Codex mode, use this only when it adds durable evidence beyond the active ledger.                                                  |
| `VERIFY_LOG.md`             | Append-only objective-gate results log.                                                                                                                                              |
| `PATCH_INBOX.md`            | Changes-requested items awaiting the owner.                                                                                                                                          |
| `BLOCKED.md`                | Items needing human/external input (auth/billing/security/destructive/prod).                                                                                                         |
| `GATE_CONFIG.md`            | Objective gate definition with real `pnpm` commands + wired/TODO status.                                                                                                             |
| `METRICS.md`                | Per-run quality/speed/memory/safety/cost metrics template.                                                                                                                           |
| `prompts/claude-lead.md`    | Historical supervisor prompt for the old Claude Code main-implementer lane (§9).                                                                                                     |
| `prompts/codex-lead.md`     | Historical supervisor prompt for the old Codex peer-reviewer lane (§10).                                                                                                             |
| `prompts/feature-intake.md` | Reusable feature-intake prompt (§11); paste to either side to register + route a feature.                                                                                            |

> All state files are seeded at initial run id `RUN-20260620-001`, cycle 0, idle, `next_action: bootstrap`, and are maintained by the supervisors during the loop.

---

## 3. Quality Loops + Loop-Engineering PDCA

Each cycle, the supervisors consider the product/code quality loops plus a separate
loop-engineering improvement track. Not all run every cycle — the classifier (§7 intake),
LOOP_POLICY, and current user priority decide which are active.

> **Primary loops vs meta-phases.** Q1–Q4 (Refactor / Stability / Product-adjacent / UI-UX) are the
> **four primary discovery/implement loops** — what the SPEC means by "the four loops". Q5
> Verification and Q6 Memory Writeback are **always-present meta-phases, not peers of Q1–Q4**: Q5
> (Verification) gates any/all of the primary loops, and Q6 (Memory Writeback) runs post-verify.
> Loop-Engineering PDCA is a **parallel process-improvement track**, not product work and not a
> bypass around validation, human approval, or hard-stop gates.

| ID     | Loop             | Focus                                                                                                                                                                                                                                   | Primary owner                             |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Q1** | Refactor         | Remove duplication, simplify, raise cohesion; no behavior change.                                                                                                                                                                       | codex.                                    |
| **Q2** | Stability        | Error handling, async-safety, RLS/tenant-isolation correctness, offline (Dexie) integrity, regressions.                                                                                                                                 | codex.                                    |
| **Q3** | Product-adjacent | Small UX-complete gaps: empty states, permission-insufficient states, error surfaces, edge data.                                                                                                                                        | codex.                                    |
| **Q4** | UI/UX            | Conformance to `docs/ui-ux-design-guidelines.md` (state colors, hierarchy, density, a11y/WCAG AA).                                                                                                                                      | codex.                                    |
| **Q5** | Verification     | Objective gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; targeted `pnpm test:e2e` / `pnpm test:e2e:audit`.                                                                                                             | codex.                                    |
| **Q6** | Memory Writeback | Persist verified decisions/learnings; correct stale gbrain entries against live repo. **STATUS: gbrain connected (2026-06-20)** — careviax indexed (read-write); writeback can target gbrain (CLI now; `mcp__gbrain__*` after restart). | both.                                     |
| **LE** | Loop Engineering | Improve the loop itself: extract useful methods and anti-patterns from past implementations/reviews, store them in gbrain, analyze recurrence/efficiency, and run bounded PDCA experiments in parallel with coding.                     | both; codex leads analysis/check metrics. |

### 3.1 Loop behavior per cycle

Each **primary loop (Q1–Q4)** runs the same three-step shape per cycle:

1. **Candidate-discovery** — scan the active scope for actionable candidates (duplication, stability gaps, UX-complete gaps, UI/UX conformance drift) within the loop's focus.
2. **Implement IF actionable** — if a candidate is actionable **and** its scope is contained (within hard-stop limits, §6), implement it in-lane.
3. **ELSE record "0 found"** — if nothing is actionable or scope is not contained, write `0 found` to `STATE.md` (`zero_actionable_count`) and **move to the next loop**.

No primary loop forces a large refactor: when the contained-scope candidate set is empty, the loop records zero and yields rather than expanding scope. Q5 (Verification) and Q6 (Memory Writeback) wrap the cycle as meta-phases (§3).

### 3.2 Parallel Loop-Engineering PDCA

The loop must improve its own engineering method while product coding continues. This is a
separate PDCA track, not a reason to delay an active user-priority implementation or review.

- **Plan** — at cycle close or idle time, choose one narrow process question from evidence: review
  blind spots, recurring `CHANGES_REQUESTED`, validation misses, lock/commit friction, duplicate
  implementation recurrence, or stale-memory drift.
- **Do** — record the method or anti-method in gbrain using the existing memory types: useful
  methods become `ImplementationDecision`, `FixPattern`, or `CandidateLesson`; methods to improve
  become `FailurePattern`, `RejectedApproach`, or `ReviewFinding`. Link them to the relevant
  `LoopRun` / `GateResult`.
- **Check** — compare against `METRICS.md`: review turnaround, recurrence, stale-memory rate,
  candidate lesson conversion, gate misses caught by review, and rework after approval.
- **Act** — if the method proves useful across independent cycles, propose a `PROMOTION_QUEUE.md`
  entry or a `LOOP_POLICY.md` patch. Never auto-promote; require normal human approval where needed.

Guardrails: no raw conversation, full command output, PHI, secrets, `.env` values, or unverified
speculation enters gbrain. LE work still inspects the dirty tree, stages explicit paths, and respects
hard-stop gates.

---

## 4. Feature intake flow (§7)

```
register → gbrain search (prior art) → classify → implement → gates → writeback
```

1. **Register** the feature into `FEATURE_QUEUE.md`.
2. **gbrain search** for prior art / past decisions — `gbrain search "<terms>"` / `gbrain query "<question>"` over the indexed careviax + brain sources (record the hits in `gbrain_memory_used`). Recall stays subordinate to live repo state.
3. **Classify**: which of Q1–Q6 apply, scope, risk, affected paths.
4. **LOOP_POLICY patch** only when policy changes are needed; otherwise continue with the task.
5. **Codex implements** a bounded slice after checking live diffs.
6. **Gates** (Q5) must be green for the affected surface.
7. **Writeback** (Q6) the outcome when it creates reusable knowledge.

Use `prompts/feature-intake.md` verbatim to drive this.

---

## 5. Single-agent review discipline (§2.3)

- Current operation has no separate maker/checker identity. Codex must compensate with small scoped slices,
  explicit validation, and honest `ops/refactor/STATE.md` updates.
- Before editing, inspect `git status --short --untracked-files=all` and affected diffs. Preserve unrelated
  user/peer changes.
- Before committing, stage only explicit owned files. Never use `git add -A`.
- The objective gate (Q5) is the tie-breaker: assumptions yield to green/red gate evidence.

### 5.1 Workload-balancing handoff

Disabled in current single-Codex mode. Do not hand off to agmsg peers, codex2/codex3/codex4, Claude,
or recursive subagent chains unless the user explicitly re-enables that workflow.

### 5.2 Idle-capacity work

This idle-capacity contract applies to current single Codex operation. A local hold, review wait,
land wait, or narrow blocker is not a reason to stop searching for useful work.

When no review, plan, VERIFY, or user-priority task is actionable, the loop should still
improve the repo deliberately. Idle work is allowed only when it is small, owned, and reviewable.

Good idle work:

- Code refactoring that is behavior-preserving, narrow, and backed by focused tests or type checks.
- Duplicate implementation detection, dead-code discovery, and old-path cleanup proposals.
- Test strengthening for known weak edges: fail-closed reads, false-empty states, stale data,
  tenant/org scoping, async races, and regression fixtures.
- gbrain internal cleanup: dedupe memories, classify ApplyNow/Consider/Ignore, flag stale memory,
  add reusable ReviewFinding/RejectedApproach/GateResult records, and link related memories.
- Validation and ledger hygiene: rerun targeted gates, update `ops/refactor/STATE.md` with evidence, and commit
  coherent already-reviewed owned slices with explicit path staging.

Guardrails:

- Inspect the dirty tree before choosing idle work, before editing, and before committing.
- Prefer read-only reconnaissance first; keep any edit narrowly scoped.
- Do not treat unvalidated work as approved.
- Do not start broad rewrites, speculative new features, cross-lane edits, or hard-stop surfaces
  (auth, billing/payments, security policy, destructive migration, production deploy).
- Do not write raw logs, conversation, secrets, tokens, `.env` values, or PHI into gbrain or loop
  docs.

Idle auto-discovery contract:

1. At every cycle boundary, handle user-priority work, hard stops, and existing dirty work first.
2. If nothing is actionable, do not wait passively. Build an idle candidate list from the live
   `FEATURE_QUEUE.md`, `STATE.md`, dirty worktree, gbrain recall, and recent
   gate/review evidence.
3. Rank candidates by risk-adjusted value: preserve dirty work first, then read-only prep for the
   next queued task, targeted test/validation hygiene, gbrain/loop cleanup,
   and coherent commits of already-reviewed owned slices.
4. Execute the first candidate that is bounded, non-conflicting, and reviewable. Before any write,
   confirm no dirty-work conflict and stay inside the declared paths.
5. If no candidate is safe to edit, still produce useful output: a read-only recon note,
   stale-state finding, conflict matrix, focused validation result, candidate scoring note, or explicit blocked context.
   `zero_actionable_count` should increase only after this exploration is recorded.
6. Yield immediately when a higher-priority inbound message arrives, then resume selection after
   that message is handled.

---

## 6. Hard-stop rules (§14)

Stop the loop and write a **resume point** (current state, what's done, what's pending, next action) when **any** of these is hit:

- **Max 4 cycles** reached on a single objective.
- **90 minutes** elapsed on a single objective.
- **More than 20 files** would be touched.
- **The same gate fails 3 times** in a row.
- The work reaches **auth / billing / payments / security / destructive (irreversible) migration / production deploy** — stop, write the resume point, and request human approval. Do not proceed autonomously.
- **Memory/policy conflict unresolved** — when a gbrain `MemoryConflict` contradicts live repo and cannot be resolved from evidence, stop, write the resume point, and escalate to a human.

A resume point is a short block the next session (or human) can pick up from without re-deriving context.

---

## 7. Security prohibitions (§15)

- **Never** commit secrets, credentials, tokens, connection strings, or `.env` values. PH-OS handles 要配慮個人情報 (medical PHI) — treat all patient data as confidential.
- **Never** weaken or bypass **PostgreSQL RLS / tenant isolation** (`SET LOCAL app.current_org_id`) or the org-wide access model.
- **Never** disable, skip, or weaken a failing test/gate to make it pass.
- **Never** log PHI or write it into RUNLOG / memory.
- **Never** perform a destructive migration or production deploy inside the loop (see §14 hard-stop).
- Security-relevant changes require an explicit checker pass and human approval.

> Verification tooling status: `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:e2e:audit` are **live and wired**. Secret scanning, dependency audit (likely `pnpm audit`), and SAST are **recommended, not yet configured — TODO**.

---

## 8. Phased rollout (§17)

| Phase | Description                                              | Status                                                                                                                                                                  |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Scaffold `.agent-loop/` docs + supervisor prompts        | **Complete** (this directory).                                                                                                                                          |
| 2     | agmsg coordination live (claude/codex on team `phos`)    | **Disabled by 2026-07-04 user instruction. Current mode is single Codex operation.**                                                                                    |
| 3     | gbrain long-term memory connected (recall + writeback)   | **Connected (2026-06-20).** Local postgres; careviax imported (131 pages / 1408 chunks), repo policy read-write. `mcp__gbrain__*` tools load on next Claude Code start. |
| 4     | Full automated intake → review → gate cycle hardening    | **In progress.** F-008 adds the docs/config Control Plane MVP; runtime enforcement remains deferred.                                                                    |
| 5     | Memory-driven continuous loop (gbrain-informed planning) | Pending.                                                                                                                                                                |

**CURRENT STATUS:** Phase 1 scaffold complete; Phase 2 agmsg coordination is disabled by the 2026-07-04 user instruction; Phase 3 gbrain connected (local postgres, careviax imported — **keyword AND semantic search both work now; embeddings generated via local `ollama:mxbai-embed-large` (1024d, no external egress) as of 2026-06-20, default source embed 100% — `BLOCKED.md` gbrain-embeddings is RESOLVED**); Phase 4 Control Plane MVP docs/config is in progress; Phase 5 pending.

---

## 9. Quick start for an operator

Current single-Codex startup:

1. Read `ops/refactor/STATE.md` as the single active state/progress ledger. Use older ledgers only for historical lookup when necessary.
2. Run `git status --short --untracked-files=all` and inspect any relevant dirty diffs before editing.
3. Select the highest-value bounded slice from `Plans.md` and historical references, implement it, run focused validation, update `ops/refactor/STATE.md`, and commit explicit owned paths when the slice is coherent.
4. Watch for hard-stops (§6) and the resume point if the loop pauses.
