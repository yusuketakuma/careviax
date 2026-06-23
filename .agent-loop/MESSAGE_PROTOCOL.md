# AGLOOP v5 — agmsg Message Protocol

**Purpose.** This is the wire format for cross-supervisor coordination in the
CareViaX (PH-OS Pharmacy) agent loop. It defines the exact message envelope,
the legal message types, and the transport. The live agmsg transport identities
are only `claude` and `codex`; role descriptors such as `claude-lead` and
`codex-lead` may still describe the two supervisor lanes in prose. Everything a
subagent produces is summarized by its supervisor before it goes on the wire.

**How it's used in the loop.** Each cycle, a supervisor drains its inbox,
acts (plan / lock / implement / review / verify), and then emits one or more
envelopes to the other supervisor to hand off work, request review, report
status, or signal `DONE`. The envelope is the single source of truth for who
owns a task, who reviews it, what branch it lives on, and which paths are
locked or forbidden — so the two lanes never edit the same files concurrently.

---

## §8.1 — Message Envelope Format

Every message body is a fenced block with these fields, in this order. Fields
are literal `key: value`; list fields use inline `[a, b]` or an empty `[]`.

```
AGLOOP v5
type: <MESSAGE_TYPE>
message_id: <UUID — auto-generated, unique per envelope>
idempotency_key: <stable dedup key, e.g. hash of type+task_id+intent>
task_id: <TASK-id or ->
subtask_id: <SUBTASK-id or ->
feature_id: <F-... | ->
from: <claude | codex>
to: <claude | codex>
origin_agent: <agent/subagent that produced the underlying work>
owner_agent: <claude | codex>
reviewer_agent: <claude | codex>
status: <queued | in_progress | blocked | review | approved | rejected | done>
branch: <git branch the work lives on>
state_version: <int — STATE.md / ledger version this envelope was built against>
timestamp: <ISO8601, e.g. 2026-06-20T09:30:00+09:00>
locked_paths: [<glob>, ...]      # paths the owner is actively editing
forbidden_paths: [<glob>, ...]   # paths the owner must NOT touch
summary: <one line>
details: |
  <multi-line freeform: rationale, evidence, file list, verification output>
```

**Field notes.**

- `message_id`: auto/UUID, first field after `type`; the stable handle a
  duplicate-ACK or reply refers back to.
- `idempotency_key`: stable dedup key (see §8.5); same logical message reuses it.
- `task_id` / `subtask_id` / `feature_id`: stable ids; use `-` when not
  applicable. `feature_id` ties the envelope to a `.agent-loop/FEATURE_QUEUE.md`
  `F-...` entry.
- `from` / `to` are transport addresses and must be the live agmsg identities
  `claude` or `codex` only. Do not send to `claude-lead` or `codex-lead`.
- `origin_agent` ≠ `owner_agent`: `origin_agent` is the agent/subagent that
  produced the underlying work, while `owner_agent` is the live supervisor
  identity accountable for it on the wire.
- `owner_agent` ≠ `reviewer_agent` always (no self-approval; authoring and
  review are separate passes per project policy).
- `state_version`: the STATE.md / ledger version the envelope was built against;
  lets the receiver detect stale envelopes.
- `timestamp`: ISO8601 (JST) emission time.
- `locked_paths`: claimed BEFORE editing; released on `DONE`/`approved`.
- `forbidden_paths`: the counterpart lane's territory, echoed for safety.
- `status` is the envelope's lifecycle state, distinct from `type`.
- `details` is a YAML block scalar (`|`) so multi-line evidence stays intact.

---

## §8.2 — Message Types

| Type                         | Direction        | Meaning                                                                                                      |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `MEMORY_BOOTSTRAP_REQUEST`   | lead → lead      | Ask counterpart to load/confirm shared memory & ledger state at cycle start (gbrain scaffolding — see note). |
| `MEMORY_BOOTSTRAP_RESULT`    | lead → lead      | Reply with loaded memory digest / "no prior state".                                                          |
| `PLAN_PROPOSE`               | owner → reviewer | Propose a plan/decomposition for a task.                                                                     |
| `PLAN_REVIEW_REQUEST`        | owner → reviewer | Request the reviewer's approval pass on a proposed plan.                                                     |
| `PLAN_REVIEW_RESULT`         | reviewer → owner | Approve / reject / revise the plan with reasons.                                                             |
| `LOCK_REQUEST`               | owner → reviewer | Claim `locked_paths` before editing.                                                                         |
| `LOCK_GRANT`                 | reviewer → owner | Confirm no conflict; lock granted.                                                                           |
| `LOCK_DENY`                  | reviewer → owner | Conflict; lock refused with conflicting paths.                                                               |
| `IMPL_PROGRESS`              | owner → reviewer | Mid-flight status / partial evidence.                                                                        |
| `IMPL_COMPLETE`              | owner → reviewer | Implementation finished, ready for review.                                                                   |
| `CODE_REVIEW_REQUEST`        | owner → reviewer | Ask for the diff review pass.                                                                                |
| `CODE_REVIEW_RESULT`         | reviewer → owner | Pass/fail gate with findings.                                                                                |
| `VERIFY_REQUEST`             | owner → reviewer | Ask reviewer to run verification (typecheck/test/build).                                                     |
| `VERIFY_RESULT`              | reviewer → owner | Verification evidence + verdict.                                                                             |
| `BLOCKED`                    | either           | Work blocked on external dependency (`cc:blocked`).                                                          |
| `UNBLOCK`                    | either           | Dependency resolved; resume.                                                                                 |
| `HANDOFF`                    | lead → lead      | Transfer ownership of a task/subtask to the other lead with ACK, stable idempotency, and explicit locks.     |
| `STATUS_PING`                | either           | Liveness / cycle heartbeat.                                                                                  |
| `DONE`                       | either           | Task complete, verified, locks released.                                                                     |
| `FEATURE_INTAKE`             | either           | New feature request landed; enqueue to `.agent-loop/FEATURE_QUEUE.md`.                                       |
| `OWNER_DECISION_REQUEST`     | lead → lead      | Escalate a decision needing the human owner's call (scope/policy/hard-stop).                                 |
| `OWNER_DECISION_RESULT`      | lead → lead      | Relay the human owner's decision back into the loop.                                                         |
| `LOOP_POLICY_PATCH_PROPOSED` | lead → lead      | Propose an edit to LOOP_POLICY / gate config.                                                                |
| `LOOP_POLICY_PATCH_APPROVED` | lead → lead      | Approve a proposed loop-policy patch.                                                                        |
| `PATCH_REVIEW_REQUEST`       | owner → reviewer | Ask for review of a non-code patch (docs/config/policy diff).                                                |
| `PATCH_REVIEW_RESULT`        | reviewer → owner | Verdict on a reviewed patch.                                                                                 |
| `CHANGES_REQUESTED`          | reviewer → owner | Review pass returns changes the owner must make before re-review.                                            |
| `APPROVED`                   | reviewer → owner | Review pass approved; owner may proceed/land.                                                                |
| `MEMORY_WRITEBACK_PROPOSED`  | either           | Propose a gbrain memory writeback (per `GBRAIN_SCHEMA.md`).                                                  |
| `MEMORY_WRITEBACK_DONE`      | either           | Writeback committed; carries `memory_id` (slug).                                                             |
| `LESSON_PROMOTION_PROPOSED`  | lead → lead      | Propose promoting a CandidateLesson via `PROMOTION_QUEUE.md`.                                                |
| `LESSON_PROMOTION_APPROVED`  | lead → lead      | Approve a lesson promotion (subject to §13 gate + human approval).                                           |
| `STALE_MEMORY_DETECTED`      | either           | Flag a memory contradicted by live repo state; mark as `StaleMemory`.                                        |

> **gbrain note (honesty).** `MEMORY_BOOTSTRAP_REQUEST` / `MEMORY_BOOTSTRAP_RESULT`
> are live as of 2026-06-20. **STATUS: gbrain connected (local postgres; careviax indexed) in this
> session** — see the gstack `setup-gbrain` skill. Until then, bootstrap
> messages carry only locally-derived state (git status, ledger files, prior
> agmsg history) and must not claim long-term memory was consulted.

---

## §8.3 — Worked Example: `PLAN_REVIEW_REQUEST`

`claude` (the Claude supervisor, UI/UX lane) asks `codex` (the Codex supervisor,
backend/review lane) to review a
plan to unify state colors across the prescriptions list.

```
AGLOOP v5
type: PLAN_REVIEW_REQUEST
message_id: 6f2a8c1e-1b44-4d2a-9c3e-7a0f9b2d5e11
idempotency_key: plan-review:TASK-state-color-unification:SUB-prescriptions-list
task_id: TASK-state-color-unification
subtask_id: SUB-prescriptions-list
feature_id: -
from: claude
to: codex
origin_agent: claude
owner_agent: claude
reviewer_agent: codex
status: review
branch: refactor/state-color-unification
state_version: 42
timestamp: 2026-06-20T09:30:00+09:00
locked_paths: [src/components/state/StateBadge.tsx, src/app/(dashboard)/prescriptions/**]
forbidden_paths: [prisma/**, src/server/**, src/lib/db/**]
summary: Replace ad-hoc status colors with the 6-axis StateBadge/StatusDot tokens
details: |
  Plan:
  1. Map every prescriptions-list status string to the canonical 6-axis token
     set (StateBadge is the SSOT; CLAUDE.md's older color rules are NOT used).
  2. Update docs/state-color-migration-map.md ledger rows for each replacement.
  3. No DB/server changes — backend lane paths are listed as forbidden_paths.
  Verification I will run before IMPL_COMPLETE:
    pnpm lint && pnpm typecheck && pnpm test
  Requesting your approval pass on: token mapping correctness + a11y
  (color-not-alone: icon+text retained). Reply PLAN_REVIEW_RESULT.
```

A reply would come back as `type: PLAN_REVIEW_RESULT` with
`status: approved | rejected`, `from: codex`, `to: claude`, and
`details` carrying the findings.

---

## Transport

Messages travel over **agmsg** (cross-vendor CLI messaging over SQLite) on
team `phos`.

**Send:**

```bash
~/.agents/skills/agmsg/scripts/send.sh phos <from> <to> "<body>"
```

**Check inbox:**

```bash
~/.agents/skills/agmsg/scripts/inbox.sh phos <name>
```

**Rules.**

- Only the live transport identities `claude` and `codex` write to agmsg. They
  act as the `claude-lead` and `codex-lead` supervisor roles. Subagents/workers
  **never** post directly; their supervisor summarizes a subagent's result
  into a single envelope (`IMPL_COMPLETE`, `CODE_REVIEW_RESULT`, etc.) before
  it goes on the wire.
- **Claude-origin priority.** On each Codex drain, messages from the live
  `claude` identity / `claude-lead` role are handled before Codex continues
  local implementation, verification, commits, or idle-ladder work. Inbound
  `PLAN_REVIEW_REQUEST`, `PATCH_REVIEW_REQUEST`, `VERIFY_REQUEST`,
  `CHANGES_REQUESTED`, `LOCK_REQUEST`, `HANDOFF`, `PAUSE_REQUEST`, and `URGENT`
  messages require immediate triage/ACK before lower-priority Codex tasks resume.
- **ACK-first review handoff.** For `PLAN_REVIEW_REQUEST`,
  `PATCH_REVIEW_REQUEST`, `VERIFY_REQUEST`, `LOCK_REQUEST`, `HANDOFF`,
  `PAUSE_REQUEST`, `URGENT`, and `CHANGES_REQUESTED`, the receiver sends a short
  ACK/STATUS/grant/deny within one drain before starting sustained review,
  implementation, or gate work. The ACK can say "in review" and is separate from
  the final verdict.
- **Sender-side receipt discipline.** A sender does not assume agmsg delivery was
  acted on until an ACK/STATUS/verdict arrives. Do not stack multiple unacked
  `PATCH_REVIEW_REQUEST`s for the same maker/checker pair; nudge idempotently
  instead. Disjoint maker work may continue only if it does not violate locks or
  WIP limits.
- Drain the inbox before committing; stage only your own lane's files.
- **Supervisor main-loop availability (both leads; LOOP_POLICY §20).** Each Supervisor's main loop
  must stay free to receive and triage the peer's messages. A busy main loop only processes pushed
  agmsg events at a turn boundary, so sustained/blocking work (multi-file edits, builds, test/verify
  runs, long investigations) is delegated to **subagents** (or `run_in_background`), not run inline in
  the main loop. The main loop reserves itself for inbox drain/triage, coordination (LOCK/ACK/review/
  owner decisions), spawning/steering subagents, and committing reviewed work. Subagents still never
  post to agmsg — the Supervisor summarizes their output into one envelope. This applies symmetrically
  to the live `claude` and `codex` sessions and reinforces the Claude-origin priority rule above.
- **Long gate serialization.** `pnpm build` must not run concurrently with
  `pnpm typecheck` or `pnpm typecheck:no-unused`; Next.js `.next/types` generation
  can race. Run those gates serially, preferably outside the main loop.
- `<body>` is the full §8.1 envelope (the fenced `AGLOOP v5 ...` block).

### §8.5 — Idempotency & ACK

- **Dedup.** A receiver tracks seen `idempotency_key`s. A duplicate
  `idempotency_key` is **not reprocessed**: the receiver returns a
  duplicate-ACK referencing the original `message_id` and takes no further
  action. Retries/resends therefore reuse the same `idempotency_key`.
- **ACK-gated blocking types.** `LOCK_REQUEST`, `HANDOFF`, and `CHANGES_REQUESTED`
  require an explicit ACK/grant/deny before the sender proceeds:
  - `LOCK_REQUEST` → wait for `LOCK_GRANT` / `LOCK_DENY` before editing.
  - `HANDOFF` → wait for the receiver's ACK before releasing ownership. A resent
    handoff reuses the same stable `idempotency_key` and must not double-flip ownership.
    The receiver edits only the granted `locked_paths`; load handoff does not widen scope
    or bypass the same objective gate before `PATCH_REVIEW_REQUEST`.
  - `CHANGES_REQUESTED` → the owner must ACK and address the changes before
    re-requesting review.
    Other review-request types are not edit-permission gates, but still require a
    receipt ACK/STATUS per the transport rules above so the sender can avoid blind
    stacking and drain-lag stalls.

### Identity mapping

The live agmsg identities map to the AGLOOP supervisor roles:

| agmsg identity (team `phos`)        | AGLOOP role   | Lane                                                                                    |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `claude` (this Claude Code session) | `claude-lead` | UI/UX + main implementation — `src/app/(dashboard)/**`, `src/components/**`             |
| `codex` (the Codex session)         | `codex-lead`  | backend / perf / refactor / test review — `prisma/**`, `src/server/**`, `src/lib/db/**` |

When sending, use the live identity as `<from>`/`<to>` on the CLI
(`send.sh phos claude codex "..."`) and in the envelope's `from:` / `to:`
fields (`from: claude`, `to: codex`). Keep `claude-lead` / `codex-lead` only as
supervisor-role descriptors in prose or historical ledgers.
