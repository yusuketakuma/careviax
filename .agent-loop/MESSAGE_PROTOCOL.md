# AGLOOP v5 — agmsg Message Protocol

**Purpose.** This is the wire format for cross-supervisor coordination in the
CareViaX (PH-OS Pharmacy) agent loop. It defines the exact message envelope,
the legal message types, and the transport. Only the two supervisors —
`claude-lead` and `codex-lead` — exchange these messages. Everything a
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
from: <claude-lead | codex-lead>
to: <claude-lead | codex-lead>
origin_agent: <agent/subagent that produced the underlying work>
owner: <who is accountable for the work>
reviewer: <who performs the approval pass>
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
- `origin_agent` ≠ `owner`: `origin_agent` is the agent/subagent that produced
  the underlying work, while `owner` is the supervisor accountable for it on the
  wire. In the gbrain schema, `owner` maps to `owner_agent` and `reviewer` maps
  to `reviewer_agent`.
- `owner` ≠ `reviewer` always (no self-approval; authoring and review are
  separate passes per project policy).
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
| `HANDOFF`                    | lead → lead      | Transfer ownership of a task/lane to the other lead.                                                         |
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

`claude-lead` (UI/UX lane) asks `codex-lead` (backend/review lane) to review a
plan to unify state colors across the prescriptions list.

```
AGLOOP v5
type: PLAN_REVIEW_REQUEST
message_id: 6f2a8c1e-1b44-4d2a-9c3e-7a0f9b2d5e11
idempotency_key: plan-review:TASK-state-color-unification:SUB-prescriptions-list
task_id: TASK-state-color-unification
subtask_id: SUB-prescriptions-list
feature_id: -
from: claude-lead
to: codex-lead
origin_agent: claude-lead
owner: claude-lead
reviewer: codex-lead
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
`status: approved | rejected`, `from: codex-lead`, `to: claude-lead`, and
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

- Only `claude-lead` and `codex-lead` write to agmsg. Subagents/workers
  **never** post directly; their supervisor summarizes a subagent's result
  into a single envelope (`IMPL_COMPLETE`, `CODE_REVIEW_RESULT`, etc.) before
  it goes on the wire.
- Drain the inbox before committing; stage only your own lane's files.
- `<body>` is the full §8.1 envelope (the fenced `AGLOOP v5 ...` block).

### §8.5 — Idempotency & ACK

- **Dedup.** A receiver tracks seen `idempotency_key`s. A duplicate
  `idempotency_key` is **not reprocessed**: the receiver returns a
  duplicate-ACK referencing the original `message_id` and takes no further
  action. Retries/resends therefore reuse the same `idempotency_key`.
- **ACK-gated types.** `LOCK_REQUEST`, `HANDOFF`, and `CHANGES_REQUESTED`
  require an explicit ACK/grant/deny before the sender proceeds:
  - `LOCK_REQUEST` → wait for `LOCK_GRANT` / `LOCK_DENY` before editing.
  - `HANDOFF` → wait for the receiver's ACK before releasing ownership.
  - `CHANGES_REQUESTED` → the owner must ACK and address the changes before
    re-requesting review.
    All other types are fire-and-forward (no blocking ACK required).

### Identity mapping

The live agmsg identities map to the AGLOOP supervisor roles:

| agmsg identity (team `phos`)        | AGLOOP role   | Lane                                                                                    |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `claude` (this Claude Code session) | `claude-lead` | UI/UX + main implementation — `src/app/(dashboard)/**`, `src/components/**`             |
| `codex` (the Codex session)         | `codex-lead`  | backend / perf / refactor / test review — `prisma/**`, `src/server/**`, `src/lib/db/**` |

When sending, use the live identity as `<from>`/`<to>` on the CLI
(`send.sh phos claude codex "..."`) and the AGLOOP role inside the envelope's
`from:` / `to:` fields (`from: claude-lead`).
