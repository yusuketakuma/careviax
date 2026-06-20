# BLOCKED.md — Items Awaiting Human / External Input

**Purpose.** Append-only register of work that the autonomous loop is NOT permitted to
complete on its own and which requires a human decision or an external dependency before
it can move. Keeping these out of `PATCH_INBOX.md` prevents the loop from spinning on
things it can never self-resolve.

**Hard rule (per §15 — always lands here, no exceptions).** Any task touching:

- **auth** (Cognito / NextAuth / session / MFA),
- **billing / payments**,
- **security** (RLS policy changes, secrets, encryption keys, token signing),
- **destructive migration** (drop/alter column, data backfill that loses information),
- **prod deploy** (Amplify deploy / release to production),

is cross-referenced here and CANNOT be auto-landed by a Supervisor. It waits for explicit
human approval / external credentials regardless of how green the gates are.

**How it is used in the loop.**

- When a task hits one of the categories above, or stalls on something the loop cannot
  produce (external creds, a vendor decision), a Supervisor appends a row with
  `status: blocked` semantics here and stops working that task.
- The loop continues on other unblocked tasks; it re-checks `unblock_condition` each cycle.
- When the `unblock_condition` is satisfied (human says go, creds arrive), the row is
  annotated and the task re-enters the normal flow (REVIEW → VERIFY).
- Mirrors the project blocked-marker convention: external-dependency blocks are tracked
  here; monitoring/WIP counting stays separate (cc:WIP), per project memory.

**Run context.** Initial run id: `RUN-20260620-001`. Cycle 0, idle, next_action: bootstrap.

**Rules.**

- Append-only. Resolve by annotating `unblock_condition` (e.g. `RESOLVED 2026-06-21: …`),
  not by deleting the row.
- `needs` ∈ {`human_approval`, `external_creds`, `destructive_migration`, `prod_deploy`}.
- `since` is ISO-8601 local (Asia/Tokyo) when it became blocked.
- `unblock_condition` — the concrete, checkable event that lets it move.

## Schema

| task_id | reason | needs | since | unblock_condition |
| ------- | ------ | ----- | ----- | ----------------- |

## Blocked

| task_id | reason | needs | since | unblock_condition |
| ------- | ------ | ----- | ----- | ----------------- |
|         |        |       |       |                   |

<!-- APPEND NEW ROWS BELOW. auth/billing/payments/security/destructive-migration/prod-deploy ALWAYS land here (§15). -->
