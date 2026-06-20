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

| File                        | Purpose                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `README.md`                 | This operator guide — system overview, loops, hard-stops, rollout status.                 |
| `STATE.md`                  | Single source of truth for the current run/cycle; resume point on hard-stop.              |
| `FEATURE_QUEUE.md`          | Feature intake queue (task_id, status, owner/reviewer, acceptance criteria).              |
| `LOCKS.md`                  | Edit-conflict ledger mirroring the live agmsg LOCK discipline.                            |
| `LOOP_POLICY.md`            | Per-run policy distilled from gbrain (ApplyNow / Consider / Ignore / BlockedContext).     |
| `MEMORY_REVIEW.md`          | Classification of gbrain search results (pending gbrain connection).                      |
| `PROMOTION_QUEUE.md`        | CandidateLesson → AGENTS.md/CLAUDE.md/Skill promotion candidates (§13 criteria).          |
| `MESSAGE_PROTOCOL.md`       | The AGLOOP v5 agmsg envelope + message types + transport (§8).                            |
| `SUBAGENT_JOBS.md`          | Registry of subagent job types (explorer/dup-scanner/verifier/…).                         |
| `REVIEW_LOG.md`             | Append-only peer-review (PLAN/PATCH) results log.                                         |
| `VERIFY_LOG.md`             | Append-only objective-gate results log.                                                   |
| `PATCH_INBOX.md`            | Changes-requested items awaiting the owner.                                               |
| `BLOCKED.md`                | Items needing human/external input (auth/billing/security/destructive/prod).              |
| `GATE_CONFIG.md`            | Objective gate definition with real `pnpm` commands + wired/TODO status.                  |
| `METRICS.md`                | Per-run quality/speed/memory/safety/cost metrics template.                                |
| `prompts/claude-lead.md`    | Supervisor prompt for the Claude Code main-implementer lane (§9).                         |
| `prompts/codex-lead.md`     | Supervisor prompt for the Codex peer-reviewer lane (§10).                                 |
| `prompts/feature-intake.md` | Reusable feature-intake prompt (§11); paste to either side to register + route a feature. |

> All state files are seeded at initial run id `RUN-20260620-001`, cycle 0, idle, `next_action: bootstrap`, and are maintained by the supervisors during the loop.

---

## 3. The six quality loops (Q1–Q6, §6)

Each cycle, the supervisors consider these loops. Not all run every cycle — the classifier (§7 intake) and LOOP_POLICY decide which are active.

| ID     | Loop             | Focus                                                                                                                                                                                     | Primary owner                                     |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Q1** | Refactor         | Remove duplication, simplify, raise cohesion; no behavior change.                                                                                                                         | claude-lead implements, codex-lead scans for dup. |
| **Q2** | Stability        | Error handling, async-safety, RLS/tenant-isolation correctness, offline (Dexie) integrity, regressions.                                                                                   | codex-lead audits, claude-lead fixes.             |
| **Q3** | Product-adjacent | Small UX-complete gaps: empty states, permission-insufficient states, error surfaces, edge data.                                                                                          | claude-lead.                                      |
| **Q4** | UI/UX            | Conformance to `docs/ui-ux-design-guidelines.md` (state colors, hierarchy, density, a11y/WCAG AA).                                                                                        | claude-lead.                                      |
| **Q5** | Verification     | Objective gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; targeted `pnpm test:e2e` / `pnpm test:e2e:audit`.                                                               | codex-lead verifies, claude-lead supplies.        |
| **Q6** | Memory Writeback | Persist verified decisions/learnings; correct stale gbrain entries against live repo. **STATUS: gbrain MCP not yet connected** — writeback is staged locally until `setup-gbrain` is run. | both.                                             |

---

## 4. Feature intake flow (§7)

```
register → gbrain search (prior art) → classify → LOOP_POLICY patch
        → peer approval → Claude implements → Codex reviews → gates → writeback
```

1. **Register** the feature into `FEATURE_QUEUE.md`.
2. **gbrain search** for prior art / past decisions (currently a no-op stub — gbrain not connected; record "no recall available").
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

---

## 6. Hard-stop rules (§14)

Stop the loop and write a **resume point** (current state, what's done, what's pending, next action) when **any** of these is hit:

- **Max 4 cycles** reached on a single objective.
- **90 minutes** elapsed on a single objective.
- **More than 20 files** would be touched.
- **The same gate fails 3 times** in a row.
- The work reaches **auth / billing / payments / security / destructive (irreversible) migration / production deploy** — stop, write the resume point, and request human approval. Do not proceed autonomously.

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

| Phase | Description                                              | Status                                                                                                         |
| ----- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1     | Scaffold `.agent-loop/` docs + supervisor prompts        | **Complete** (this directory).                                                                                 |
| 2     | agmsg coordination live (claude/codex on team `phos`)    | **Live.**                                                                                                      |
| 3     | gbrain long-term memory connected (recall + writeback)   | **NOT yet connected** — run the `setup-gbrain` (gstack) skill. All Q6/gbrain steps are scaffolding until then. |
| 4     | Full automated intake → review → gate cycle hardening    | Pending.                                                                                                       |
| 5     | Memory-driven continuous loop (gbrain-informed planning) | Pending.                                                                                                       |

**CURRENT STATUS:** Phase 1 scaffold complete; Phase 2 agmsg already live (claude/codex on team phos); Phase 3 gbrain NOT yet connected (run gstack setup-gbrain); Phase 4–5 pending.

---

## 9. Quick start for an operator

1. Confirm agmsg reachable: `~/.agents/skills/agmsg/scripts/inbox.sh phos claude`.
2. Open `prompts/claude-lead.md` in the Claude Code session and `prompts/codex-lead.md` in the Codex session.
3. To add work, paste `prompts/feature-intake.md` with the feature description.
4. Watch for hard-stops (§6) and the resume point if the loop pauses.
