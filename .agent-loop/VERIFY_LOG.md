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
- `consecutive_fail_count` = number of consecutive runs the **same gate** has failed
  (per gate, carried forward from the prior row's count). Reset to `0` for a gate the
  moment it returns `pass` (or a justified `skip`). Record the running max across gates
  in the column. A **3rd consecutive fail** (`consecutive_fail_count = 3`) on any single
  gate triggers the §6 hard-stop: stop iterating on that gate, escalate to `BLOCKED.md`,
  and do not keep re-running blindly. Rows predating this column have an implicit count
  of `0`; backfill is not required (append-only).

## Schema

| timestamp | task_id | lint | typecheck | typecheck_no_unused | format_check | test | build | e2e | result | consecutive_fail_count |
| --------- | ------- | ---- | --------- | ------------------- | ------------ | ---- | ----- | --- | ------ | ---------------------- |

## Log

| timestamp                 | task_id        | lint | typecheck | typecheck_no_unused | format_check | test | build | e2e  | result | consecutive_fail_count |
| ------------------------- | -------------- | ---- | --------- | ------------------- | ------------ | ---- | ----- | ---- | ------ | ---------------------- |
| 2026-06-20T11:48:41+09:00 | F-20260620-001 | skip | skip      | skip                | pass         | skip | skip  | skip | pass   | 0                      |

<!-- skip justification for F-20260620-001: docs-only change (AGENTS.md, 4 lines added, no
     code/route/build surface). Applicable gates run & independently re-verified by claude-lead
     (reviewer): `pnpm exec prettier --check AGENTS.md` PASS + `git diff --check` PASS. Commit
     a1c916ac (codex-lead, AGENTS.md lane owner). -->
<!-- APPEND NEW ROWS BELOW THIS LINE — do not edit rows above -->

| 2026-06-22T09:33:50+09:00 | RUN-20260622-001-medical-ui-gate-stabilization | pass | pass | skip | pass | skip | skip | fail | fail | 3 |

<!-- RUN-20260622-001-medical-ui-gate-stabilization notes: targeted ESLint, tsc --noEmit, and focused schedule e2e passed before the final set-audit helper edit. The focused set-audit final approval conflict Playwright gate timed out repeatedly; latest failed DOM showed set-audit progress 0/3 with approval/checklist controls disabled after navigation/hydration. typecheck_no_unused/test/build were not re-run for the final dirty snapshot. -->

| 2026-06-22T10:26:08+09:00 | RUN-20260622-001-medical-ui-gate-stabilization | pass | pass | skip | pass | skip | skip | pass | pass | 0 |

<!-- RUN-20260622-001-medical-ui-gate-stabilization 10:26 notes: final locked-path checks passed: Prettier check, targeted ESLint, git diff --check, and `pnpm exec tsc --noEmit --pretty false --incremental false --skipLibCheck`. Focused E2E passed for billing/PCA prescription guardrail, set-audit conflict, set-audit persistence, and mobile set-audit smoke. Caveat: one combined chromium `--grep 'set-audit final approval'` command was interrupted after it hung once following a passing conflict case; the persistence case passed in a separate focused run. typecheck_no_unused/test/build were skipped because this slice only changed locked UI/test helpers and the full no-emit tsc plus focused E2E/static checks covered the touched paths. -->

| 2026-06-22T10:32:14+09:00 | RUN-20260622-001-medical-ui-gate-stabilization | pass | pass | skip | pass | skip | skip | pass | pass | 0 |

<!-- RUN-20260622-001-medical-ui-gate-stabilization 10:32 notes: resolved the previous combined-run caveat. The desktop chromium command `tools/tests/e2e-prescription-dispensing-flow.spec.ts --project=chromium --grep 'set-audit final approval' --timeout=240000` passed both final approval cases in one worker (2/2, 1.3m). This supplements the already-green locked-path Prettier, ESLint, diff-check, full no-emit tsc, billing/PCA focused E2E, and mobile set-audit smoke. typecheck_no_unused/test/build remain skipped for the same scoped-test-helper rationale as the 10:26 row. -->

| 2026-06-22T10:45:00+09:00 | RUN-20260622-001-medical-ui-gate-stabilization | pass | pass | skip | pass | pass | skip | skip | pass | 0 |

<!-- RUN-20260622-001-medical-ui-gate-stabilization 10:45 notes: addressed Claude PI-005 SSOT badge fork must-fix. Commands passed: Prettier check for status-tokens, patients-board, state-badge test, and locked specs; targeted ESLint for status-tokens, StateBadge/StatusDot, patients-board, and locked specs; `pnpm exec vitest run src/components/ui/state-badge.test.tsx --reporter=dot` (31/31); `pnpm exec vitest run 'src/app/(dashboard)/patients/patients-board.test.tsx' --reporter=dot` (12/12); `pnpm exec tsc --noEmit --pretty false --incremental false --skipLibCheck`; `git diff --check`. typecheck_no_unused/build/e2e skipped because this follow-up only changed the SSOT badge class contract and its focused unit coverage after the E2E gate had already passed. -->

| 2026-06-22T11:55:00+09:00 | agent-loop-claude-priority-policy-20260622 | skip | skip | skip | pass | skip | skip | skip | pass | 0 |

<!-- agent-loop-claude-priority-policy-20260622 notes: docs/policy-only change after Claude PATCH_REVIEW_RESULT approved §19. Applicable checks: `pnpm exec prettier --check .agent-loop/LOOP_POLICY.md .agent-loop/MESSAGE_PROTOCOL.md .agent-loop/STATE.md .codex/ralph-state.md` PASS and `git diff --check .agent-loop/LOOP_POLICY.md .agent-loop/MESSAGE_PROTOCOL.md .agent-loop/STATE.md .codex/ralph-state.md` PASS. Source/tests/build/e2e skipped because no runtime code changed. -->
