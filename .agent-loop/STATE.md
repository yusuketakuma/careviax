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
current_cycle: 6 # resident loop: F-002 slice1-4a ALL DONE/committed; codex F-003/F-004 landed + F-006 in review; LOOP_POLICY §20/§21 (subagent-orchestration) peer-approved.
cycle_start_time: 2026-06-22T00:00:00+09:00 # ISO8601 Asia/Tokyo; reset at each run start. elapsed = now − cycle_start_time, checked at every cycle boundary vs §14 90-min hard-stop
active_task_id: - # slice4a landed; next Discover = slice4b/4c (drug-masters #4-#8) + F-20260622-005 (preview-invalidation follow-up). Not started.
current_cycle_note: 'Cycle 6 resident loop. F-20260622-001 admin UI: slice1 e73ff383 (select a11y), slice2 91d47e84 (capacity info-order), slice3 f40a77f5 (document-templates h2/h3) ALL DONE. F-20260622-002 slice4a 780dcff2 DONE: drug-masters formulary selects #1対象拠点/#2コピー元拠点/#3テンプレート → shared Select (44px, label-wrap→aria-labelledby, explicit clear sentinels) + medical-safety stale-preview hardening (drift-proof ref-SSOT apply*-setters, request-context-stamped dry-run guards, target-change + import/auto-refresh preview invalidation cleared-before-await). codex review: 5 plan + 6 patch rounds (concurrency/medical-safety checker split surfaced + closed real stale-async-preview races); implemented via frontend-implementer subagent in worktree, claude-lead verified each diff + gates in main. Parallel codex backend (claude reviewed+approved): F-003 540d503e (presign fail-closed), F-004 d5dc1efa (offline lastError §9 sanitize), F-006 in review (patient-mcs URL-encode). LOOP_POLICY §20 (main loop free / work in subagents) + §21 (max subagent concurrency / main=orchestrator) added + ApplyNow §1-21 grouped index; codex peer-approved. Loop FixPatterns: serial build/no-unused (TS6053); no backticks in agmsg bodies; heredoc-to-file for agmsg envelopes.'
files_changed_count: 0 # all source committed (F-002 slice1-4a by claude: e73ff383/91d47e84/f40a77f5/780dcff2; F-003/F-004 by codex). Dirty = .agent-loop ledgers + .codex/ralph-state + codex F-006 in-flight (patient-mcs, codex lock) + untracked projects/ gbrain pages.
claude_status: idle_orchestrator # F-002 slice1-4a all DONE/committed; all my LOCKs released. Per §20/§21 main loop free for codex; reviewing codex F-006; next Discover = slice4b/4c + F-005.
codex_status: active_backend # landed F-003/F-004; F-006 (patient-mcs URL-encode) in review (claude approved patch, codex landing). Recording slice4a rev6 review ledgers.
last_memory_bootstrap: 2026-06-22 # gbrain filesystem store(/Users/yusuke/brain/projects/careviax)直読。NOTE: `gbrain list --type` は空=構造化 memory は slug-path file、federated semantic index 非掲載。
zero_actionable_count: 0
last_gate_result: pass # slice4a committed 780dcff2 (rev6 approved; vitest 49/49, eslint 0, prettier, typecheck exit0, build exit0, no-unused exit0 serial, diff-check). slice1/2/3 + codex F-003/F-004 also green/landed.
next_action: >
  F-002 slice1-4a all landed (e73ff383 / 91d47e84 / f40a77f5 / 780dcff2). Next per §16 Discover,
  run under §20/§21 (work in subagents, main loop free, fan out disjoint partitions):
  - slice4b: drug-masters filter selects #4 CSV用途 / #5 取込ソース / #6 取込状態 / #7 薬効分類
    (no empty options) → shared Select; same MockSelect/44px pattern. Claude UI lane, single file
    (drug-master-content.tsx) + test — NOTE same file as 4a, so 4b and 4c must be SERIAL (one LOCK
    holder at a time), not concurrent with each other.
  - slice4c: #8 採用後発薬 (adds the missing accessible name) + any remainder.
  - F-20260622-005 (follow-up safety, agreed with codex): broader generation/onError preview
    invalidation + preview-required final apply for copy/template. Codex or Claude lane TBD.
  - mcs-content.tsx direct MCS fetch URL-encode (Claude UI follow-up to codex F-006) if filed.
  Also pending: GateResult/LoopRun gbrain writeback for this run's landed slices (file-plane; DB blocked).
  Deferred (judgment): M9 business-holidays (calendar↔bulk-register) / M3 billing-rules (§15
  billing hard-stop adjacency — human-gate care).
  BlockedContext (BLOCKED.md): gbrain DB/index writeback fails on embedding dim mismatch
  (expected 768, got 1024); file-plane writes succeed, semantic-index put fails → DB recall stays
  stale until human realigns the index. Loop continues on file-plane recall meanwhile.
  Warm slice queue (§14b read-only scope, admin lane=Claude owner, disjoint from codex locks):
  - slice3 [scoped] M5 document-templates: 大機能直列を PageSection(h2)化(PageSection 実在=reuse)。中規模。
  - deferred(判断要): M9 business-holidays(カレンダー↔一括登録結合)/ M3 billing-rules(§15 hard-stop 近接)/ drug-masters select(M6 連動: slice1 で確認した範囲外 native h-9 select 残渣)。
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
- ReviewFinding: projects/careviax/reviews/2026-06-22/ssot-token-fork-caught-in-review (RUN-20260622-001 medical-ui review; claude-lead caught a per-screen READABLE_STATUS_BADGE_CLASSES fork of the State Color SSOT, resolved by promoting into status-tokens.ts not plain-revert; §18/§7 + review-method)
- GateResult: projects/careviax/gates/2026-06-22/medical-ui-gate-prescription-intake-timeout-fail (RUN-20260622-001 medical-ui gate; full gate failed on prescription-intakes 500 / Prisma transaction timeout)
- BlockedContext: projects/careviax/blocked/2026-06-22/prescription-intake-transaction-timeout (RUN-20260622-001 medical-ui gate; owner/lock decision needed before product fix)
- PerformanceFinding: projects/careviax/performance-findings/2026-06-22/prescription-intake-guardrail-before-cycle-create (RUN-20260622-001 read-only root cause; blocked POST creates cycles before guardrail failure)
- ReviewFinding: projects/careviax/reviews/2026-06-22/admin-select-test-contract-payload-and-hit-target (F-20260622-001-slice1; Base UI Select migration tests must assert responsive hit target classes and submitted payload serialization. Written to gbrain file-plane after `gbrain put` failed with embedding dimension mismatch.)
- FixPattern: projects/careviax/fix-patterns/2026-06-22/serial-no-unused-after-next-build (RUN-20260622-001 loop validation; run `typecheck:no-unused` serially after Next.js build to avoid transient `.next/types` TS6053 false negatives.)
- FixPattern: projects/careviax/fix-patterns/2026-06-22/agloop-shell-backticks-strip-tokens (RUN-20260622-001 agmsg transport hygiene; avoid shell backticks in AGLOOP bodies built through shell variables because command substitution can strip tokens.)

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

**Current update 2026-06-22T12:52:14+09:00 (codex-lead)**: final medical-ui gate remains blocked. Controlled `pnpm medical-ui:e2e:gate` passed preflight/DB checks, then failed in `tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts` expecting 400 but receiving 500 for the blocked-injection `/api/prescription-intakes` POST. Next dev log root cause: Prisma interactive transaction expired at `workflowException.findFirst` after 5s in `src/server/services/prescription-intake-service.ts`. Minimal authenticated direct fetch to the same blocked payload returned the expected 400 with `blocked_lines`, but took 33.7s. A single Playwright grep attempt became orphan/SIGTERM and is not pass evidence. Codex sent AGLOOP v5 `VERIFY_BLOCKED` `codex-20260622T125214-jst-medical-ui-gate-blocked` requesting Claude owner/lock decision; current Codex lock forbids `src/server/**` and `src/app/api/**`, so no product-code fix should start until ACK/decision.

**Current update 2026-06-22T12:59:51+09:00 (codex-lead)**: Claude ACKed with `OWNER_DECISION_RESULT`: Codex owns backend perf/stability, but only read-only root-cause is allowed now; implementation is held by §14 >20-file hard-stop and possible migration human-gate. Read-only findings: `WorkflowException` lacks a composite `(org_id, cycle_id, exception_type, status)` index, but current e2e DB has only 95 rows and the exact `findFirst` equivalent is a 0.086ms seq scan, so the immediate gate failure is not proven to be an index-only problem. More important: the `case_id/patient_id` path creates a new `MedicationCycle` before structuring/outpatient-injection guardrails. The e2e DB now has 185 cycles for the target case and 93 target cycles without any `PrescriptionIntake`, matching repeated blocked POST side effects. Fix classification: code-level first, migration optional/future. Recommended code fix is to make invalid prescription guardrails fail fast before creating a new cycle / before the 5s interactive transaction does avoidable writes, while preserving the 400 + `blocked_lines` contract. Do not implement until human/Claude decision.

**Current update 2026-06-23 (claude-lead)**: User-directed LOOP_POLICY **§23 role-agnostic load balancing** added + codex peer-approved (commits 5a562d20 + 9d724ebb). Either Supervisor may MAKER or CHECKER any task; §1 owner-lanes → soft capability default; only invariant = maker ≠ checker (cross-check). Two axes: (1) busy→light handoff at next task boundary; (2) light side self-generates + takes maker work (no pure-reviewer steady state). Diagnosis of the imbalance: the F-013..F-034 entity-href sweep was all backend → old hard lanes pinned codex as 22-consecutive maker, claude pure-checker. **First §23 cycle demonstrated**: F-20260623-035 (today-preparation visit_mode_href → shared buildVisitRecordHref) implemented by **claude as MAKER**, audited by **codex as CHECKER** (reviewer-audit APPROVED), committed 635bc532 (claude). entity-href sweep state: 6 shared guarded helpers (buildPatientHref / buildPartnerVisitRecordHref / buildReportHref / buildVisitHref+buildVisitRecordHref / buildPrescriptionHref); /patients /partner-visit-records /reports /visits /prescriptions /visit-schedules namespaces hardened (F-013..F-035). Going forward: lighter side takes next maker per §23; both run whole-codebase gstack-first Discover (§22b/§23 Axis 2).

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.
