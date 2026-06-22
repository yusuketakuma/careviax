# Agent Loop — STATE

**Purpose.** Single source of truth for the current loop's runtime state. The two Supervisors
(`claude-lead`, `codex-lead`) read this at the start of every cycle and write it back at the
end. It is the first file consulted on resume and the last file written on a hard-stop.

**How it's used in the loop.**

- At cycle start: read the YAML, confirm `current_run_id` / `current_cycle`, pick up `next_action`.
- During a cycle: update `active_task_id`, `claude_status`, `codex_status` as work proceeds.
- At the gate: write `last_gate_result` (pass | fail | unknown).
- On hard-stop: write the **Resume point** section below so the next session continues cleanly.
- `zero_actionable_count` increments each cycle the queue yields no actionable task; the loop
  idles/backs off when it climbs (see FEATURE_QUEUE.md for intake).
- **Time-elapsed (§14 90-min hard-stop).** `cycle_start_time` is a durable ISO8601 Asia/Tokyo
  timestamp set at run start. At each cycle boundary the Supervisors compute
  `elapsed = now − cycle_start_time`; if `elapsed ≥ 90 min`, trigger a hard-stop (write the
  **Resume point** section, then exit). Because it is persisted here, the budget survives resume —
  do **not** reset it on a mid-run resume; only a fresh run resets it.
- **Files-touched (§14 >20-file hard-stop).** `files_changed_count` is the count of distinct paths
  from `git diff --name-only` measured from the cycle-start tree/commit. Refresh it at each cycle
  boundary; if it exceeds 20, trigger a hard-stop with resume-point persistence (capture
  `active_task_id`, locked paths, and the next command in **Resume point** before exiting).

```yaml
current_run_id: RUN-20260622-001
current_cycle: 4 # HARD STOP: codex medical-ui gate stabilization exceeded loop/file budget; Claude contact priority policy patch proposed by user direction.
cycle_start_time: 2026-06-22T00:00:00+09:00 # ISO8601 Asia/Tokyo; reset at each run start. elapsed = now − cycle_start_time, checked at every cycle boundary vs §14 90-min hard-stop
active_task_id: RUN-20260622-001-medical-ui-gate-stabilization
current_cycle_note: 'Claude approved PI-005, but the final medical-ui gate is still not green. A full `pnpm medical-ui:e2e:gate` run failed on set-audit final approval navigation/persistence, and a focused rerun was interrupted by the user before completion. User then directed that Claude-origin agmsg items must be prioritized. Codex proposed a this-run §19 policy/protocol rule requiring every pending claude/claude-lead message to preempt local Codex implementation, verification, commit, or idle-ladder work; Claude reviewed and approved the supervisor-doc patch.'
files_changed_count: 21 # git status --short --untracked-files=all, including three gbrain write-through pages; over §14 >20-file hard-stop threshold, so no new implementation should start before narrowing/landing/handing off.
claude_status: reviewer_standby # PI-005 approved; slice1 admin a11y still held behind gate-pause until Codex medical-ui gate lands/releases.
codex_status: policy_patch_peer_approved_gate_not_green # Claude-origin priority §19 peer-approved for this run; final medical-ui gate still failing/interrupted, so do not release medical-ui lock.
last_memory_bootstrap: 2026-06-22 # gbrain filesystem store(/Users/yusuke/brain/projects/careviax)直読。NOTE: `gbrain list --type` は空=構造化 memory は slug-path file、federated semantic index 非掲載。
zero_actionable_count: 0
last_gate_result: fail # full `pnpm medical-ui:e2e:gate` failed after PI-005 approval; focused rerun was interrupted by user before completion.
next_action: >
  Honor the user-directed Claude-origin priority override as peer-approved for RUN-20260622-001: drain agmsg and handle any claude/claude-lead message before any further Codex gate work. Because the medical-ui gate is not green and the file-count hard-stop is exceeded, do not release the medical-ui lock or unblock Claude's admin slice yet. Commit/release the independent policy-doc slice, then either narrow/land after a green gate or hand off/review the remaining set-audit final approval stabilization.
  Warm slice queue (§14b read-only scope, admin lane=Claude owner, disjoint from codex locks; all HELD until gate-pause release):
  - slice1 [APPROVED + LOCK held, edits held for gate-pause] admin a11y: 生 `<select className="h-9">`(36px<44px) → 既存 @base-ui/react/select (admin 10+画面使用=§18 reuse-first)。service-areas(2)+alert-rules(2)+ tests。44px: 各 trigger `min-h-[44px] w-full sm:min-h-[44px]`。empty-state: service-area-site は form 空文字 + SelectValue placeholder(reuse settings-content.tsx:449)、empty SelectItem 追加せず。test: pca-pumps MockSelect パターン再利用 + 44px class 契約 assert。
  - slice2 [scoped, ready-to-PLAN — §18 stale-scope CORRECTED] M8 capacity 即時判断昇格: `今すぐ見るべきこと`<section>(capacity-content.tsx L244-259)は xl:grid-cols-3 グリッド(L211)の第3列で、行程ごとの残り(L212)+スタッフ別の負荷(L226)と同列。⇒ mechanical な単純移動ではなく **layout 判断**: 推奨=Option A(今すぐ見るべきことを KPI grid(L180-209)直下の独立フル幅 section へ昇格し、2 BarChart を xl:grid-cols-2 に集約)。SSOT L70-76/L117 即時判断上位。単一ファイル・admin lane・testId=capacity-page 維持・capacity test 無し(任意で DOM 順序 test 追加可)・空状態は真の empty(§17 OK)。PLAN_REVIEW で A/B を codex に確認。
  - slice3 [scoped] M5 document-templates: 大機能直列を PageSection(h2)化(PageSection 実在=reuse)。中規模。
  - deferred(判断要): M9 business-holidays(カレンダー↔一括登録結合)/ M3 billing-rules(§15 hard-stop 近接)/ drug-masters select(M6 連動)。
```

## gbrain memory (this run)

<!-- Per GBRAIN_SCHEMA.md §15: after each `gbrain put`, append the memory_id (= slug) here so the
     run's durable writeback is auditable. Format: `- <type>: <slug> (<commit>)`. -->

- ImplementationDecision: projects/careviax/decisions/state-color-token-unification (smoke-seed 2026-06-20)
- FailurePattern: projects/careviax/failures/mutation-returns-raw-row-phi-leak (2026-06-20, slice7 PHI)
- FixPattern: projects/careviax/fix-patterns/mutation-reuse-get-safe-projection (2026-06-20)
- DuplicateMap: projects/careviax/duplicates/pharmacy-cooperation-api-contracts (2026-06-20, slice8)
- ImplementationDecision: projects/careviax/decisions/readapijson-schema-fail-closed (2026-06-20)
- GateResult: projects/careviax/gates/pharmacy-cooperation-hardening-green-20260620 (full suite 8465 passed)
- LoopRun: projects/careviax/loop-runs/2026-06-20/codex-response-schema-hardening (2026-06-20)
- CandidateLesson: projects/careviax/lessons/candidates/api-response-validation-and-consolidation (→ PROMOTION_QUEUE)
- ReviewFinding: projects/careviax/reviews/hardening-slice-precommit-clean-20260620 (Cycle 2; 0-blocker pre-commit review, links FailurePattern/FixPattern/Decision)
- FailurePattern: projects/careviax/failures/false-empty-and-stale-wipe-on-fetch-failure (Cycle 4; F-004 377d9e1e — false-empty + stale-wipe-on-refetch + fix)
- ReviewFinding: projects/careviax/reviews/statistics-hub-registry-contract-coverage-20260620 (F-007; registry self-consistency tests missed approved manifest coverage)
- ReviewFinding: projects/careviax/reviews/statistics-hub-contract-reconciliation-and-permission-gating-20260620 (F-007 rev6; raw recon reconciliation + page/per-surface permission gating)
- ReviewFinding: projects/careviax/reviews/statistics-hub-rev7-contract-permission-api-mismatch-20260620 (F-007 rev7; green gates missed KPI response contract + destination permission mismatches)
- CandidateLesson: projects/careviax/lessons/candidates/api-response-validation-and-consolidation (F-007 2a4780d0 confirmation; times_confirmed=2, promotion_status=candidate)
- FixPattern: projects/careviax/fix-patterns/route-wire-shape-schema-parity-tests (F-007 2a4780d0; align client schema/test mocks to real route wire shape)
- ImplementationDecision: projects/careviax/decisions/2026-06-20/control-plane-mvp-advisory-and-date-partitioned-gbrain (F-008 ebeacee6; advisory Control Plane MVP + dated new-memory slug layout)
- ImplementationDecision: projects/careviax/decisions/2026-06-21/bounded-search-minimal-projections (F-010A 721ce32d; bounded backend search + minimal projections)
- GateResult: projects/careviax/gates/2026-06-21/f-20260620-010-721ce32d (F-010A 721ce32d; focused tests/typecheck/no-unused/eslint/prettier/diff-check/build GREEN)
- PerformanceFinding: projects/careviax/performance-findings/2026-06-21/contact-summary-sequential-bounded-scan (F-010A 721ce32d; avoid redundant per-kind contact scans)
- BlockedContext: projects/careviax/blocked/2026-06-22/set-audit-fixed-fixture-e2e-timeout (RUN-20260622-001 medical-ui hard-stop; focused set-audit e2e repeated timeout)
- FixPattern: projects/careviax/fix-patterns/2026-06-22/set-audit-spa-nav-preserves-workbench-state (RUN-20260622-001 medical-ui gate; test-side blocker resolved)
- GateResult: projects/careviax/gates/2026-06-22/medical-ui-gate-focused-green (RUN-20260622-001 medical-ui gate; focused static/E2E validation green)

## Resume point

<!-- Written only on hard-stop. Capture: active_task_id, the exact step in progress,
     any locked paths to release, and the single next command/action to take.
     Empty at bootstrap. -->

**active_task_id**: `RUN-20260622-001-medical-ui-gate-stabilization`

**Hard Stop reason**: focused set-audit final approval conflict Playwright validation timed out repeatedly. The last failed DOM showed `セット監査 進捗 0 / 3` and disabled approval/checklist controls after set → set-audit navigation/hydration. This likely needs review or edits outside Codex's currently granted locked paths.

**Locks still active**:

- `medical-ui-gate-stab-20260622` (codex-lead): `src/app/(dashboard)/patients/patients-board.tsx`, six `tools/tests/*.spec.ts` paths. Do not release until peer review / next decision.
- `F-20260622-001-slice1` (claude-lead): admin service-area / alert-rule select migration approved but held behind this gate pause.

**Codex changes currently dirty**:

- Deduplicated patient-board handling tag class lookup to reuse the shared safety-board helper.
- Made prescription intake test `apiFetch` avoid mutating POST retries.
- Stabilized schedule proposal / weekly optimizer tests with deterministic schedule fixtures.
- Reduced several UI E2E retry/reload budgets.
- Updated set → set-audit E2E helpers for href navigation, target patient reselection, and carry/outside-med evidence setup.
- Added mobile non-submit set-audit smoke coverage.
- gbrain BlockedContext written: `projects/careviax/blocked/2026-06-22/set-audit-fixed-fixture-e2e-timeout`.

**Validation snapshot**:

- PASS: targeted ESLint before the final helper edit for patient board / billing / dispensing / schedule specs.
- PASS: `pnpm exec tsc --noEmit --pretty false --incremental false --skipLibCheck` before the final helper edit.
- PASS: focused schedule Playwright for proposal detail / weekly optimizer / reproposal controls.
- PASS: focused set→set-audit navigation after route-href change.
- FAIL: focused set-audit final approval conflict Playwright timed out repeatedly, latest at `tools/tests/e2e-prescription-dispensing-flow.spec.ts`.

**Single next action**: ask `claude-lead` to review or grant a narrow product-code lock for `src/components/features/dispense-workbench/*` hydration/write-handler root cause. After that, rerun only the single focused conflict test before any broad validation.

**claude-lead ownership + read-only root-cause analysis (2026-06-22)**: dispense-workbench is `src/components/**` = Claude lane → claude OWNS this root cause (no lock-grant into Claude's lane; codex keeps its medical-ui-gate-stab lock + remains reviewer; set-audit=medication-safety/high-risk → mutual review). Findings (file:line):

- `進捗 0/3` has `totC=3,dnC=0` (use-workbench-view.ts L987-1020). If it were the fail-closed `dataUnavailable` empty state, `calendarDayCount=0` → `0/0` + gate "実データを取得できませんでした". It is `0/3`, so the CALENDAR HYDRATED (3 cells) — NOT a hydrate-to-empty failure.
- Disabled approval+checklist: right-pane.tsx L761-799 — checklist items AND `監査OK` share `disabled={cellActionDisabled}`; `監査OK` title "対象セルを選択してから監査OKにしてください" ⇒ `cellActionDisabled` = no selected target cell (`hasSelectedCell` false). Per-cell `監査OK` needs only a selected cell (NOT the 6 checks; 6 checks gate FINAL approval per logic.ts L411).
- Test helper `markAllVisibleSetAuditCellsOk` (e2e spec L416-440) clicks a pending cell then expects `監査OK` enabled. Hard-stop ⇒ after the cell click `hasSelectedCell` stayed false (監査OK never enabled) ⇒ 0/3.
- LEADING HYPOTHESIS (product, Claude lane): the seta hydration effect (dispensing-workbench.tsx L150-184; deps phase/selId/planId/...) RE-RUNS after the cell click and clobbers the selected target (hydrate/setCalendarState resets store target) ⇒ control re-disables. ALT (test/fixture): seeded plan not audit-ready at load / serial-fixture timing.
- DISAMBIGUATION (needs tooling): run ONLY the focused conflict test instrumented to log when the cell-click fires vs when the seta effect re-runs; read `loadCalendarWriteContextAsync` (adapter L216-243) to confirm whether it preserves or resets `target` on re-hydrate. If product: fix = make seta hydrate idempotent / not clobber an existing user selection (or auto-select first un-audited cell on seta entry) — under a NEW task F-20260622-002 LOCK on `src/components/features/dispense-workbench/**`, codex reviewer.
- Sent to codex: OWNER_DECISION_RESULT (ownership + this analysis + request for failing-test title/locators/seed path). No blind e2e retries agreed.
- **RESOLVED 2026-06-22 (test-side, confirmed by codex)**: the LEADING HYPOTHESIS branch was the cause but via TEST navigation, not a product effect-clobber. Codex's earlier edit set the set→set-audit phase-tab nav to `openStableRoute('/set-audit')` = FULL PAGE RELOAD → lost the client-side zustand-persist workbench store + /set carry evidence → set-audit loaded un-audited → 0/3 → `cellActionDisabled` → disabled controls → no POST. Fix (codex, test lane): revert to client-side `clickAndWaitForStableRoute` on the Set Audit tab (SPA nav preserves store); focused conflict now GREEN 1/1 (6.5s). **NO dispense-workbench product change** — Claude lane unedited, F-20260622-002 NOT opened. Reusable FixPattern (codex to write): e2e on in-session workbench client state must use client-side SPA nav, not full-reload, between phase tabs. claude=reviewer-standby for codex's full-tree PATCH_REVIEW_REQUEST (will check P1#1/#2 populated-fixture per §17).

**Current update 2026-06-22T10:26:08+09:00 (codex-lead)**: prior blocker remains resolved in test lane. Additional fixes after the earlier note: direct helper probe now uses the production `include_set_plan=1` contract, outside-med toggle locator no longer captures visit-carry buttons, set→set-audit SPA navigation waits directly on URL/active tab/UI instead of the generic `Promise.any` route helper, and the conflict test asserts `approvalPayload.plan_id`. Validation now green for locked-path format/lint/diff-check, full `tsc --noEmit`, billing/PCA guardrail focused E2E, set-audit conflict focused E2E, set-audit persistence focused E2E, and mobile set-audit smoke. Caveat: a combined `--grep 'set-audit final approval'` desktop run was interrupted after hanging once after the conflict case passed; the persistence case passed in a separate focused run. Next action is peer review, not commit/release.

**Current update 2026-06-22T10:32:14+09:00 (codex-lead)**: combined-run caveat resolved. The same desktop `--grep 'set-audit final approval'` command passed both set-audit final approval cases in one worker (`2 passed (1.3m)`). GateResult written: `projects/careviax/gates/2026-06-22/medical-ui-gate-focused-green`. PATCH_REVIEW_UPDATE sent to claude-lead with this evidence; commit/release still waits for peer review.

**Current update 2026-06-22T10:45:00+09:00 (codex-lead)**: Claude review returned one must-fix, PI-005: do not fork the State Color SSOT in patients-board. Codex accepted the scoped handoff and changed `STATUS_TOKENS[*].badgeClassName` to the readable `text-foreground` + role ring/tint variant, restored patients-board to `spec.badgeClassName`, and updated `state-badge.test.tsx` to assert the new 7-role contract. Validation passed: focused Prettier, focused ESLint, StateBadge unit 31/31, PatientsBoard unit 12/12, no-emit tsc, and `git diff --check`. Re-review requested.

**Current update 2026-06-22T11:40:00+09:00 (codex-lead)**: User-directed policy change proposed as ApplyNow §19: Claude-origin agmsg items preempt local Codex work at every drain/cycle boundary. Updated `.agent-loop/LOOP_POLICY.md` §19 + Peer-approval row and `.agent-loop/MESSAGE_PROTOCOL.md` transport rules. Claude granted the supervisor-doc lock and requested a PATCH_REVIEW_REQUEST; until approval, Codex honors the user directive operationally but does not mark the policy peer-approved. Before this policy patch, Claude had approved PI-005, but final full `pnpm medical-ui:e2e:gate` was not green: one run failed on set-audit final approval returning to `/set`, then a focused `--grep 'set-audit final approval'` rerun was interrupted by the user after the persistence case hung at the approval POST wait. Do not commit/release locks until the remaining final gate blocker is resolved and re-validated; process any new Claude message first.

**Current update 2026-06-22T11:55:00+09:00 (codex-lead)**: Claude returned `PATCH_REVIEW_RESULT approved` for `agent-loop-claude-priority-policy-20260622`. §19 is now marked peer-approved for this run, with permanent promotion to AGENTS.md / CLAUDE.md still human-gated. The policy-doc slice is independent of the medical-ui gate; Codex may commit the policy/protocol/ledger docs and release only that policy lock. The medical-ui lock remains held until final gate/review completion.

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.
