# Agent Loop — Operator Guide

> Two-supervisor, maker/checker development loop for **careviax (PH-OS Pharmacy)**.
> Claude Code is the main implementer; Codex is an independent peer reviewer/auditor over agmsg; gbrain is long-term memory that is always subordinate to the live repository state.

This directory holds the human/operator entry points and the live operational artifacts for the loop. Start here.

---

## 1. What this loop is

A disciplined pair of AI supervisors working the careviax codebase under maker/checker separation:

- **claude-lead** (= agmsg identity `claude` on team `phos`) — the **main implementer**. Owns UI/UX and main feature implementation: `src/app/(dashboard)/**`, `src/components/**`. Studies existing code first, implements, runs the objective gate.
- **codex-lead** (= agmsg identity `codex` on team `phos`) — the **independent peer reviewer / strict verifier / limited assisting implementer**. Owns backend/perf/refactor/test-review review passes. Reviews Claude's diffs and returns `APPROVED` or `CHANGES_REQUESTED`. Implements only within an explicitly LOCKed scope.
- **gbrain** — long-term memory subordinate. Provides recall (past decisions, prior art) but **never overrides live repo state**. When repo and gbrain disagree, the repo wins; gbrain gets a writeback correction.

The two supervisors coordinate exclusively over **agmsg** (cross-vendor CLI messaging over SQLite). Only supervisors speak on agmsg; subagents/workers never write to agmsg directly.

```
send:  ~/.agents/skills/agmsg/scripts/send.sh phos <from> <to> "<msg>"
inbox: ~/.agents/skills/agmsg/scripts/inbox.sh phos <name>
```

---

## 2. File map (`.agent-loop/`)

| File                        | Purpose                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                 | This operator guide — system overview, loops, hard-stops, rollout status.                                                                                                            |
| `STATE.md`                  | Single source of truth for the current run/cycle; resume point on hard-stop.                                                                                                         |
| `FEATURE_QUEUE.md`          | Feature intake queue (task_id, status, owner/reviewer, acceptance criteria).                                                                                                         |
| `LOCKS.md`                  | Edit-conflict ledger mirroring the live agmsg LOCK discipline.                                                                                                                       |
| `LOOP_POLICY.md`            | Per-run policy distilled from gbrain (ApplyNow / Consider / Ignore / BlockedContext).                                                                                                |
| `MEMORY_REVIEW.md`          | Classification of gbrain search results (gbrain connected 2026-06-20).                                                                                                               |
| `PROMOTION_QUEUE.md`        | CandidateLesson → AGENTS.md/CLAUDE.md/Skill promotion candidates (§13 criteria).                                                                                                     |
| `GBRAIN_SCHEMA.md`          | **SSOT for gbrain memory**: 26 memory types, common metadata, slug/type design, graph edges, save timing, redaction, quality score, Claude/Codex split, writeback rule, MVP phasing. |
| `templates/gbrain/`         | Fill-in `gbrain put`-ready page templates for the MVP memory types (loop-run, gate-result, decision, …).                                                                             |
| `MESSAGE_PROTOCOL.md`       | The AGLOOP v5 agmsg envelope + message types + transport (§8).                                                                                                                       |
| `SUBAGENT_JOBS.md`          | Registry of subagent job types (explorer/dup-scanner/verifier/…).                                                                                                                    |
| `REVIEW_LOG.md`             | Append-only peer-review (PLAN/PATCH) results log.                                                                                                                                    |
| `VERIFY_LOG.md`             | Append-only objective-gate results log.                                                                                                                                              |
| `PATCH_INBOX.md`            | Changes-requested items awaiting the owner.                                                                                                                                          |
| `BLOCKED.md`                | Items needing human/external input (auth/billing/security/destructive/prod).                                                                                                         |
| `GATE_CONFIG.md`            | Objective gate definition with real `pnpm` commands + wired/TODO status.                                                                                                             |
| `METRICS.md`                | Per-run quality/speed/memory/safety/cost metrics template.                                                                                                                           |
| `prompts/claude-lead.md`    | Supervisor prompt for the Claude Code main-implementer lane (§9).                                                                                                                    |
| `prompts/codex-lead.md`     | Supervisor prompt for the Codex peer-reviewer lane (§10).                                                                                                                            |
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
> bypass around the maker/checker gate.

| ID     | Loop             | Focus                                                                                                                                                                                                                                   | Primary owner                                     |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Q1** | Refactor         | Remove duplication, simplify, raise cohesion; no behavior change.                                                                                                                                                                       | claude-lead implements, codex-lead scans for dup. |
| **Q2** | Stability        | Error handling, async-safety, RLS/tenant-isolation correctness, offline (Dexie) integrity, regressions.                                                                                                                                 | codex-lead audits, claude-lead fixes.             |
| **Q3** | Product-adjacent | Small UX-complete gaps: empty states, permission-insufficient states, error surfaces, edge data.                                                                                                                                        | claude-lead.                                      |
| **Q4** | UI/UX            | Conformance to `docs/ui-ux-design-guidelines.md` (state colors, hierarchy, density, a11y/WCAG AA).                                                                                                                                      | claude-lead.                                      |
| **Q5** | Verification     | Objective gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; targeted `pnpm test:e2e` / `pnpm test:e2e:audit`.                                                                                                             | codex-lead verifies, claude-lead supplies.        |
| **Q6** | Memory Writeback | Persist verified decisions/learnings; correct stale gbrain entries against live repo. **STATUS: gbrain connected (2026-06-20)** — careviax indexed (read-write); writeback can target gbrain (CLI now; `mcp__gbrain__*` after restart). | both.                                             |
| **LE** | Loop Engineering | Improve the loop itself: extract useful methods and anti-patterns from past implementations/reviews, store them in gbrain, analyze recurrence/efficiency, and run bounded PDCA experiments in parallel with coding.                     | both; codex leads analysis/check metrics.         |

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
  entry or a `LOOP_POLICY.md` patch. Never auto-promote; require the normal peer/human gate.

Guardrails: no raw conversation, full command output, PHI, secrets, `.env` values, or unverified
speculation enters gbrain. LE work still drains agmsg, respects LOCKs, stages explicit paths, and
uses maker/checker separation.

---

## 4. Feature intake flow (§7)

```
register → gbrain search (prior art) → classify → LOOP_POLICY patch
        → peer approval → Claude implements → Codex reviews → gates → writeback
```

1. **Register** the feature into `FEATURE_QUEUE.md`.
2. **gbrain search** for prior art / past decisions — `gbrain search "<terms>"` / `gbrain query "<question>"` over the indexed careviax + brain sources (record the hits in `gbrain_memory_used`). Recall stays subordinate to live repo state.
3. **Classify**: which of Q1–Q6 apply, scope, risk, affected paths.
4. **LOOP_POLICY patch**: claude-lead proposes a policy delta; codex-lead must approve over agmsg before implementation.
5. **Claude implements** in its lane after LOCKing paths.
6. **Codex reviews** → `CHANGES_REQUESTED` (loop back) or `APPROVED`.
7. **Gates** (Q5) must be green.
8. **Writeback** (Q6) the outcome.

Use `prompts/feature-intake.md` verbatim to drive this.

---

## 5. Maker / checker separation (§2.3)

- The implementer (maker) and the reviewer (checker) are **different identities in different lanes**. claude-lead never self-approves; codex-lead's `APPROVED` is required before a change is considered done.
- **Lane discipline**: LOCK a path via agmsg before editing it; **drain your inbox before committing**; stage only your own files.
- Codex may implement, but **only inside an explicitly LOCKed scope** recorded in `LOCKS.md`. Outside that scope it reviews, it does not write.
- The objective gate (Q5) is the tie-breaker: opinions yield to green/red gate evidence.

### 5.1 Workload-balancing handoff

When one Supervisor is saturated and the other has spare capacity, the current owner may hand off
a task or narrow subtask to the available Supervisor. This is an exception to the default lane
split, not a bypass of the loop:

- Send an AGLOOP `HANDOFF` or owner-decision envelope and wait for ACK before work starts.
- Reuse the same stable `idempotency_key` on retries so ownership is not flipped twice.
- Update `owner_agent` / `reviewer_agent`; the original owner becomes reviewer when appropriate.
- Declare `locked_paths` / `forbidden_paths`; the receiver edits only the granted paths.
- Run the same objective gate before `PATCH_REVIEW_REQUEST`; hard-stop surfaces stay human-gated.

### 5.2 Idle-capacity work

When no review, plan, VERIFY, LOCK, or user-priority task is actionable, the loop should still
improve the repo deliberately. Idle work is allowed only when it is small, owned, and reviewable.

Good idle work:

- Code refactoring that is behavior-preserving, narrow, and backed by focused tests or type checks.
- Duplicate implementation detection, dead-code discovery, and old-path cleanup proposals.
- Test strengthening for known weak edges: fail-closed reads, false-empty states, stale data,
  tenant/org scoping, async races, and regression fixtures.
- gbrain internal cleanup: dedupe memories, classify ApplyNow/Consider/Ignore, flag stale memory,
  add reusable ReviewFinding/RejectedApproach/GateResult records, and link related memories.
- Validation and ledger hygiene: rerun targeted gates, update run ledgers with evidence, and commit
  coherent already-reviewed owned slices with explicit path staging.

Guardrails:

- Drain agmsg before choosing idle work, before editing, and before committing.
- Prefer read-only reconnaissance first; create/claim a task and LOCK exact paths before any edit.
- Keep maker/checker separation. The idle worker does not self-approve.
- Do not start broad rewrites, speculative new features, cross-lane edits, or hard-stop surfaces
  (auth, billing/payments, security policy, destructive migration, production deploy).
- Do not write raw logs, conversation, secrets, tokens, `.env` values, or PHI into gbrain or loop
  docs.

---

## 6. Hard-stop rules (§14)

Stop the loop and write a **resume point** (current state, what's done, what's pending, next action) when **any** of these is hit:

- **Max 4 cycles** reached on a single objective.
- **90 minutes** elapsed on a single objective.
- **More than 20 files** would be touched.
- **The same gate fails 3 times** in a row.
- The work reaches **auth / billing / payments / security / destructive (irreversible) migration / production deploy** — stop, write the resume point, and request human approval. Do not proceed autonomously.
- **Memory/policy conflict unresolved** — when the two supervisors cannot agree on a LOOP_POLICY delta, or a gbrain `MemoryConflict` cannot be peer-resolved (recall contradicts live repo with no agreed resolution), stop, write the resume point, and escalate to a human.

A resume point is a short block the next session (or human) can pick up from without re-deriving context.

---

## 7. Security prohibitions (§15)

- **Never** commit secrets, credentials, tokens, connection strings, or `.env` values. PH-OS handles 要配慮個人情報 (medical PHI) — treat all patient data as confidential.
- **Never** weaken or bypass **PostgreSQL RLS / tenant isolation** (`SET LOCAL app.current_org_id`) or the org-wide access model.
- **Never** disable, skip, or weaken a failing test/gate to make it pass.
- **Never** log PHI or write it into RUNLOG / agmsg / memory.
- **Never** perform a destructive migration or production deploy inside the loop (see §14 hard-stop).
- Security-relevant changes require an explicit checker pass and human approval.

> Verification tooling status: `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:e2e:audit` are **live and wired**. Secret scanning, dependency audit (likely `pnpm audit`), and SAST are **recommended, not yet configured — TODO**.

---

## 8. Phased rollout (§17)

| Phase | Description                                              | Status                                                                                                                                                                  |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Scaffold `.agent-loop/` docs + supervisor prompts        | **Complete** (this directory).                                                                                                                                          |
| 2     | agmsg coordination live (claude/codex on team `phos`)    | **Live.**                                                                                                                                                               |
| 3     | gbrain long-term memory connected (recall + writeback)   | **Connected (2026-06-20).** Local postgres; careviax imported (131 pages / 1408 chunks), repo policy read-write. `mcp__gbrain__*` tools load on next Claude Code start. |
| 4     | Full automated intake → review → gate cycle hardening    | Pending.                                                                                                                                                                |
| 5     | Memory-driven continuous loop (gbrain-informed planning) | Pending.                                                                                                                                                                |

**CURRENT STATUS:** Phase 1 scaffold complete; Phase 2 agmsg live (claude/codex on team phos); Phase 3 gbrain connected (local postgres, careviax imported — **keyword AND semantic search both work now; embeddings generated via local `ollama:mxbai-embed-large` (1024d, no external egress) as of 2026-06-20, default source embed 100% — `BLOCKED.md` gbrain-embeddings is RESOLVED**; restart Claude Code for `mcp__gbrain__*` tools); Phase 4–5 pending. See CLAUDE.md `## GBrain Configuration`.

---

## 9. Quick start for an operator

**Canonical startup procedure → `STARTUP_RUNBOOK.md`** (Claude Code-originated, Codex joins via agmsg as
auditor/assistant; team `phos` / agents `claude`+`codex`; the exact paste-ready prompts for both sessions).

1. Confirm agmsg reachable: `~/.agents/skills/agmsg/scripts/inbox.sh phos claude`.
2. Follow `STARTUP_RUNBOOK.md` §1–§3: start Claude (`/agmsg` → `/effort ultracode` → loop prompt), then Codex (`$agmsg` → `/goal`).
3. To add work, paste the feature-intake block (`STARTUP_RUNBOOK.md` §5 or `prompts/feature-intake.md`).
4. Watch for hard-stops (§6) and the resume point if the loop pauses.
