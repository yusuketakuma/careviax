# PATCH_INBOX.md — Incoming Changes-Requested Queue

**Purpose.** Append-only queue of `changes_requested` items raised during peer review
(`REVIEW_LOG.md`) or objective gating (`VERIFY_LOG.md`) that are now awaiting the _owner_
(the maker who authored the patch). Every requested change has a single owner and an
explicit resolution — nothing falls on the floor.

**How it is used in the loop.**

- A `changes_requested` verdict in `REVIEW_LOG.md`, or any `fail` gate in `VERIFY_LOG.md`,
  creates exactly one row here with `status = open`.
- The owner addresses it in their own lane (Claude = UI/UX + main impl under
  `src/app/(dashboard)/**`, `src/components/**`; Codex = backend/perf/refactor/test).
  LOCK the path via agmsg before editing; drain inbox before commit; stage only own files.
- When fixed, the owner sets `status = addressed` and writes a one-line `resolution`
  (commit sha / what changed). The reviewer then re-reviews → new `REVIEW_LOG.md` row.
- `status = wontfix` requires a `resolution` justifying it; if it is policy-blocked
  (auth/billing/payments/security/destructive migration/prod deploy) it ALSO goes to
  `BLOCKED.md`, not silently dropped here.
- Only Supervisors write here. Subagents/workers never touch agmsg or these logs directly.

**Run context.** Initial run id: `RUN-20260620-001`. Cycle 0, idle, next_action: bootstrap.

**Rules.**

- Append-only for new items; `status`/`resolution` of an existing row may be updated in place
  (it is a live queue), but `item_id`, `task_id`, `from`, `requested_changes` are immutable.
- `item_id` format: `PI-<NNN>` (zero-padded, monotonic), e.g. `PI-001`.
- `from` is the reviewer who raised it: `claude-lead` | `codex-lead`.
- `status` ∈ {`open`, `addressed`, `wontfix`}.

## Schema

| item_id | task_id | from | requested_changes | status | resolution |
| ------- | ------- | ---- | ----------------- | ------ | ---------- |

## Queue

| item_id | task_id                    | from       | requested_changes                                                                                                                                                                                                    | status   | resolution                                                                                                                                                                           |
| ------- | -------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PI-001  | scaffold-review (2986725b) | codex-lead | GATE_CONFIG.md classifies full `pnpm test` (~8k Vitest) as cheap/every-slice; would stall the loop or be ignored. Make unit-test gate = targeted Vitest every slice, full `pnpm test` before done/merge or periodic. | resolved | c8580b23 split GATE_CONFIG into "unit test (targeted)" cheap/every-slice + "unit test (full)" heavy/before-done; policy §2.4 updated. codex-lead APPROVED 2026-06-20T11:53:52+09:00. |

<!-- APPEND NEW ITEMS BELOW. item_id is monotonic (PI-001, PI-002, ...). -->
