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
task_id: <TASK-id or ->
subtask_id: <SUBTASK-id or ->
from: <claude-lead | codex-lead>
to: <claude-lead | codex-lead>
owner: <who is accountable for the work>
reviewer: <who performs the approval pass>
status: <queued | in_progress | blocked | review | approved | rejected | done>
branch: <git branch the work lives on>
locked_paths: [<glob>, ...]      # paths the owner is actively editing
forbidden_paths: [<glob>, ...]   # paths the owner must NOT touch
summary: <one line>
details: |
  <multi-line freeform: rationale, evidence, file list, verification output>
```

**Field notes.**

- `task_id` / `subtask_id`: stable ids; use `-` when not applicable.
- `owner` ≠ `reviewer` always (no self-approval; authoring and review are
  separate passes per project policy).
- `locked_paths`: claimed BEFORE editing; released on `DONE`/`approved`.
- `forbidden_paths`: the counterpart lane's territory, echoed for safety.
- `status` is the envelope's lifecycle state, distinct from `type`.
- `details` is a YAML block scalar (`|`) so multi-line evidence stays intact.

---

## §8.2 — Message Types

| Type                       | Direction        | Meaning                                                                                                      |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `MEMORY_BOOTSTRAP_REQUEST` | lead → lead      | Ask counterpart to load/confirm shared memory & ledger state at cycle start (gbrain scaffolding — see note). |
| `MEMORY_BOOTSTRAP_RESULT`  | lead → lead      | Reply with loaded memory digest / "no prior state".                                                          |
| `PLAN_PROPOSE`             | owner → reviewer | Propose a plan/decomposition for a task.                                                                     |
| `PLAN_REVIEW_REQUEST`      | owner → reviewer | Request the reviewer's approval pass on a proposed plan.                                                     |
| `PLAN_REVIEW_RESULT`       | reviewer → owner | Approve / reject / revise the plan with reasons.                                                             |
| `LOCK_REQUEST`             | owner → reviewer | Claim `locked_paths` before editing.                                                                         |
| `LOCK_GRANT`               | reviewer → owner | Confirm no conflict; lock granted.                                                                           |
| `LOCK_DENY`                | reviewer → owner | Conflict; lock refused with conflicting paths.                                                               |
| `IMPL_PROGRESS`            | owner → reviewer | Mid-flight status / partial evidence.                                                                        |
| `IMPL_COMPLETE`            | owner → reviewer | Implementation finished, ready for review.                                                                   |
| `CODE_REVIEW_REQUEST`      | owner → reviewer | Ask for the diff review pass.                                                                                |
| `CODE_REVIEW_RESULT`       | reviewer → owner | Pass/fail gate with findings.                                                                                |
| `VERIFY_REQUEST`           | owner → reviewer | Ask reviewer to run verification (typecheck/test/build).                                                     |
| `VERIFY_RESULT`            | reviewer → owner | Verification evidence + verdict.                                                                             |
| `BLOCKED`                  | either           | Work blocked on external dependency (`cc:blocked`).                                                          |
| `UNBLOCK`                  | either           | Dependency resolved; resume.                                                                                 |
| `HANDOFF`                  | lead → lead      | Transfer ownership of a task/lane to the other lead.                                                         |
| `STATUS_PING`              | either           | Liveness / cycle heartbeat.                                                                                  |
| `DONE`                     | either           | Task complete, verified, locks released.                                                                     |

> **gbrain note (honesty).** `MEMORY_BOOTSTRAP_REQUEST` / `MEMORY_BOOTSTRAP_RESULT`
> are Phase-3 scaffolding. **STATUS: gbrain MCP is not yet connected in this
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
task_id: TASK-state-color-unification
subtask_id: SUB-prescriptions-list
from: claude-lead
to: codex-lead
owner: claude-lead
reviewer: codex-lead
status: review
branch: refactor/state-color-unification
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

### Identity mapping

The live agmsg identities map to the AGLOOP supervisor roles:

| agmsg identity (team `phos`)        | AGLOOP role   | Lane                                                                                    |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `claude` (this Claude Code session) | `claude-lead` | UI/UX + main implementation — `src/app/(dashboard)/**`, `src/components/**`             |
| `codex` (the Codex session)         | `codex-lead`  | backend / perf / refactor / test review — `prisma/**`, `src/server/**`, `src/lib/db/**` |

When sending, use the live identity as `<from>`/`<to>` on the CLI
(`send.sh phos claude codex "..."`) and the AGLOOP role inside the envelope's
`from:` / `to:` fields (`from: claude-lead`).
