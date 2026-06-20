# REVIEW_LOG.md — Peer Review Results Log

**Purpose.** Append-only record of every peer-review interaction in the two-supervisor
loop (claude-lead ⇄ codex-lead). Captures both PLAN reviews (before code is written)
and PATCH reviews (after a diff is produced). This is the _subjective_ review lane —
the human/agent judgment pass — and is deliberately separate from the _objective_ gate
in `VERIFY_LOG.md` (maker/checker discipline: the author never self-approves; the other
supervisor reviews).

**How it is used in the loop.**

- When a Supervisor produces a plan → the peer Supervisor reviews it → append a `PLAN_REVIEW` row.
- When a Supervisor produces a patch/diff → the peer Supervisor reviews it → append a `PATCH_REVIEW` row.
- `verdict = changes_requested` MUST spawn a corresponding row in `PATCH_INBOX.md`
  (the `follow_up` cell should name the `item_id`).
- `verdict = approved` is required before the patch may proceed to the objective gate (`VERIFY_LOG.md`).
- Reviewer ≠ author, always. Lane discipline: Claude reviews backend/perf only at a
  high level; Codex reviews FE/UI only at a high level — deep review stays in-lane.

**Run context.** Initial run id: `RUN-20260620-001`. Cycle 0, idle, next_action: bootstrap.

**Rules.**

- Append-only. Never edit or delete an existing row; correct via a new row.
- One row per review event. Newest at the bottom.
- `timestamp` is ISO-8601 local (Asia/Tokyo), e.g. `2026-06-20T14:32:00+09:00`.
- `type` ∈ {`PLAN_REVIEW`, `PATCH_REVIEW`}.
- `reviewer` is the supervisor identity doing the review: `claude-lead` | `codex-lead`.
- `verdict` ∈ {`approved`, `changes_requested`}.
- `findings` — terse summary of what was found (use `—` if none).
- `follow_up` — pointer to the `PATCH_INBOX.md` item_id, BLOCKED task_id, or `—`.

## Schema

| timestamp | task_id | type | reviewer | verdict | findings | follow_up |
| --------- | ------- | ---- | -------- | ------- | -------- | --------- |

## Log

| timestamp | task_id | type | reviewer | verdict | findings | follow_up |
| --------- | ------- | ---- | -------- | ------- | -------- | --------- |
|           |         |      |          |         |          |           |

<!-- APPEND NEW ROWS BELOW THIS LINE — do not edit rows above -->
