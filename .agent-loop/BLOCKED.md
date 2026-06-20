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

| task_id           | reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | needs                           | since      | unblock_condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gbrain-embeddings | careviax imported (keyword-searchable) but NO semantic embeddings exist anywhere in the brain (natural-language `gbrain query` returns empty on every source). Enabling semantic recall is blocked on TWO independent constraints: (1) **Agent egress hard-block** — Claude Code's classifier hard-blocks the agent from sending private repo docs to an external embedding API (Voyage/OpenAI); in-chat user approval cannot clear it. (2) **Schema dimension lock** — the Postgres brain schema is fixed to `text-embedding-3-large` (OpenAI, 3072d); `gbrain config set embedding_model` is a no-op, switching to Voyage (1024d) needs the `docs/embedding-migrations.md` schema migration first. | human_approval + external_creds | 2026-06-20 | User-driven only: the USER runs `gbrain embed` themselves (their action, not the agent) with a key matching the schema — either (a) an OpenAI key (3072d, schema-compatible), or (b) migrate the schema to Voyage 1024d then embed with the Voyage key. **RESOLVED 2026-06-20**: USER switched the embedding provider to a **local Ollama model** (`ollama:mxbai-embed-large`, 1024d, `http://localhost:11434`). Both constraints cleared — (1) egress: a local model sends nothing to OpenAI/Voyage, no data leaves the Mac; (2) dimension: the brain schema is now 1024d and the default source (which holds careviax docs) reports **embed coverage 100%**. `gbrain query`/`search` verified returning cosine-scored results. No further user action required. |

<!-- APPEND NEW ROWS BELOW. auth/billing/payments/security/destructive-migration/prod-deploy ALWAYS land here (§15). -->
