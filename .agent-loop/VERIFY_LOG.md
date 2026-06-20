# VERIFY_LOG.md — Objective Gate Results Log

**Purpose.** Append-only record of the _objective_ maker/checker gate. After a patch is
peer-approved in `REVIEW_LOG.md`, the checker Supervisor runs the verification commands
and records the raw pass/fail of each gate here. This is machine-checkable truth — no
judgment, just command exit status — and is the counterpart to the subjective review lane.

**How it is used in the loop.**

- The author (maker) never records their own gate as the final word; the peer Supervisor
  (checker) runs the gate and appends the row. Evidence over assumption.
- A patch may only land when `result = pass` AND a prior `approved` exists in `REVIEW_LOG.md`.
- Any failing gate → open a `PATCH_INBOX.md` item (changes_requested) and keep iterating;
  do not land on red.
- `e2e` and `build` are heavy; run them when the change touches routing, build config,
  PWA/service worker, or user-facing flows. Mark `skip` (with reason in commit/PR) when
  legitimately not applicable — `skip` is allowed but must be justified, and a row with
  any `fail` is never `result=pass`.

**Verification commands (these exist in `package.json` — use exactly).**
| column | command |
| ------ | ------- |
| `lint` | `pnpm lint` |
| `typecheck` | `pnpm typecheck` (next typegen + tsc + tsc -p tsconfig.sw.json) |
| `typecheck_no_unused` | `pnpm typecheck:no-unused` |
| `format_check` | `pnpm format:check` |
| `test` | `pnpm test` (Vitest) |
| `build` | `pnpm build` |
| `e2e` | `pnpm test:e2e` (or `pnpm test:e2e:audit` for audit-focused) |

**Not yet wired (recommended, not yet configured — TODO):** secret scan, dependency
audit (candidate: `pnpm audit`), SAST. When these land, add columns; until then do NOT
fake a pass — leave them out of the row.

**Run context.** Initial run id: `RUN-20260620-001`. Cycle 0, idle, next_action: bootstrap.

**Rules.**

- Append-only. Newest row at the bottom. Never edit a prior row.
- `timestamp` is ISO-8601 local (Asia/Tokyo).
- Each gate cell ∈ {`pass`, `fail`, `skip`} (`skip` requires a justification in the PR/commit).
- `result` = `pass` only if every non-skipped gate is `pass`; otherwise `fail`.

## Schema

| timestamp | task_id | lint | typecheck | typecheck_no_unused | format_check | test | build | e2e | result |
| --------- | ------- | ---- | --------- | ------------------- | ------------ | ---- | ----- | --- | ------ |

## Log

| timestamp                 | task_id        | lint | typecheck | typecheck_no_unused | format_check | test | build | e2e  | result |
| ------------------------- | -------------- | ---- | --------- | ------------------- | ------------ | ---- | ----- | ---- | ------ |
| 2026-06-20T11:48:41+09:00 | F-20260620-001 | skip | skip      | skip                | pass         | skip | skip  | skip | pass   |

<!-- skip justification for F-20260620-001: docs-only change (AGENTS.md, 4 lines added, no
     code/route/build surface). Applicable gates run & independently re-verified by claude-lead
     (reviewer): `pnpm exec prettier --check AGENTS.md` PASS + `git diff --check` PASS. Commit
     a1c916ac (codex-lead, AGENTS.md lane owner). -->
<!-- APPEND NEW ROWS BELOW THIS LINE — do not edit rows above -->
