# Agent Loop — STATE

**Purpose.** Single source of truth for the current loop's runtime state. The two Supervisors
(`claude-lead`, `codex-lead`) read this at the start of every cycle and write it back at the
end. It is the first file consulted on resume and the last file written on a hard-stop.

## Current Codex Resume Note - 2026-07-02 12:06 JST

- Active mode for this slice: Codex-only execution with Codex subagent
  contract/test review (`api_contract_reviewer`, `test_architect`) plus real
  validation. Preserve unrelated dirty files; do not push/deploy/migrate or
  destructively mutate data.
- Latest completed slice:
  `RR-FE-20260702-F03-schedule-drawer-error-envelope`.
- Files changed:
  - `src/app/(dashboard)/schedules/schedule-create-edit-drawer.tsx`
  - `src/app/(dashboard)/schedules/schedule-create-edit-drawer.test.ts`
  - progress-ledger working-tree updates in `ops/refactor/*`,
    `CODEX_GOAL_PROGRESS.md`, `.codex/ralph-state.md`, and this file
- Fixed:
  - The schedule create/edit drawer now reads failed
    `PUT /api/visit-schedule-proposals` standard `message` first, then legacy
    `error`, then a generic fallback.
  - Non-string or missing envelope fields fail closed to the generic save error,
    and response `details` are not displayed in the toast.
- Validation:
  - Drawer focused suite passed `1` file / `17` tests.
  - Drawer + visit-schedule-proposals route bundle passed `2` files / `106`
    tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - `pnpm format:check` failed on unrelated untracked
    `ops/refactor/ultracode-crossreview-codex-workflow.mjs`; scoped Prettier for
    the changed drawer files passed.
- Remaining:
  - Broad repo-wide objective remains open; no DB/API/auth/RLS/migration,
    external-send, billing, push/deploy, dependency, or destructive-operation
    behavior was changed.
  - Browser/E2E smoke was skipped because this is a toast/error-envelope fix
    covered by component DOM assertions, route contract tests, and full build.
- Next action:
  - After this validated slice is committed, continue the next highest-value
    ULTRACODE/refactor finding with fresh file inspection and focused tests.

## Current Codex Resume Note - 2026-07-02 11:52 JST

- Active mode for this slice: Codex-only execution with Codex subagent planning
  and review (`code_mapper`, `implementation_planner`, `frontend_reviewer`,
  `medical_safety_reviewer`, `test_architect`) plus real validation. Preserve
  unrelated dirty files; do not push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-FE-20260702-F14-F27-cockpit-rail-false-safe`.
- Files changed:
  - `src/app/(dashboard)/handoff/handoff-workspace.tsx`
  - `src/app/(dashboard)/handoff/handoff-workspace.test.tsx`
  - `src/app/(dashboard)/schedules/schedule-team-board.tsx`
  - `src/app/(dashboard)/schedules/schedule-team-board.test.tsx`
  - progress-ledger working-tree updates in `ops/refactor/*`,
    `CODEX_GOAL_PROGRESS.md`, `.codex/ralph-state.md`, and this file
- Fixed:
  - Handoff cockpit loading/error states now render skeleton or retryable
    `ErrorState` instead of the healthy right-rail no-blockers copy.
  - Schedule cockpit loading/error states now render explicit degraded-risk UI
    in the Gantt risk area and the right rail instead of silently hiding
    narcotic audit risk, blocked reasons, or clerical follow-up indicators.
  - Cockpit error paths no longer use stale query data for rail/risk rendering,
    and retry actions call `cockpitQuery.refetch()`.
- Validation:
  - Focused handoff/schedule component suites passed `2` files / `48` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
  - Codex frontend and medical-safety reviewers found no actionable issues; a
    low loading-branch test gap from `test_architect` was addressed.
- Remaining:
  - Broad repo-wide objective remains open; no DB/API/auth/RLS/migration,
    external-send, billing, push/deploy, dependency, or destructive-operation
    behavior was changed.
  - Browser/E2E smoke was skipped because this slice is covered by component DOM
    regressions plus a full production build and does not change navigation or
    route contracts.
- Next action:
  - After this validated slice is committed, continue the next highest-value
    ULTRACODE/refactor finding with fresh file inspection and focused tests.

## Current Codex Resume Note - 2026-07-02 11:29 JST

- Active mode for this slice: Codex-only execution with Codex subagent review
  (`code_mapper`, `implementation_planner`, `frontend_reviewer`,
  `medical_safety_reviewer`) and real validation. Preserve unrelated dirty
  files; do not push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-FE-20260702-C-drug-master-formulary-error-states` plus clipboard
  fail-closed hardening in the same drug-master surface.
- Files changed:
  - `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx`
  - `src/app/(dashboard)/admin/drug-masters/drug-master-content.test.tsx`
  - `.agent-loop/LOCKS.md`
  - progress-ledger working-tree updates in `ops/refactor/*`,
    `CODEX_GOAL_PROGRESS.md`, and `.codex/ralph-state.md`
- Fixed:
  - Drug-master formulary subquery failures now render retryable `ErrorState`
    branches and `取得失敗` labels instead of false zero/empty states.
  - Review completion is disabled when the review-due query is failing, even if
    React Query still exposes stale row data.
  - Drug detail stock-config fetch failure no longer falls through to
    `未登録`, `採用品に登録`, or `変更申請` actions.
  - CSV preview candidate YJ-code clipboard copy now reports success only after
    `navigator.clipboard.writeText` resolves and uses fixed non-raw error text
    on unavailable/rejected clipboard access.
- Validation:
  - Focused reviewed regressions passed `1` file / `10` selected tests.
  - Full drug-master content component suite passed `1` file / `77` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `pnpm build` passed.
- Remaining:
  - Broad repo-wide objective remains open; no DB/API/auth/RLS/migration,
    external-send, billing, push/deploy, or destructive-operation behavior was
    changed.
  - Browser/E2E smoke was skipped because this slice is covered by component DOM
    regressions plus a full production build and does not change navigation or
    route contracts.
- Next action:
  - After this validated slice is committed, continue the next highest-value
    ULTRACODE/refactor finding with fresh file inspection and focused tests.

## Current Codex Resume Note - 2026-07-02 07:33 JST

- Active mode for this slice: Claude judgment / Codex execution via agmsg.
  Codex may also autonomously find and implement verified candidates when the
  prioritized queue is not blocked. Preserve unrelated dirty files; do not
  push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-FE-20260702-B-safety-banner-silent-loss`.
- Files changed:
  - `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.tsx`
  - `src/app/(dashboard)/patients/[id]/safety-check/safety-check-content.test.tsx`
  - `.agent-loop/LOCKS.md`
  - progress-ledger working-tree updates in `ops/refactor/*`,
    `CODEX_GOAL_PROGRESS.md`, and `.codex/ralph-state.md`
- Fixed:
  - Patient safety-check pinned banner no longer disappears silently when
    patient summary fetch fails.
  - The pinned region renders inline `ErrorState` with retry while leaving the
    main safety workflow visible when medication issues load successfully.
- Validation:
  - Red focused regression failed before the fix because patient safety error
    text was absent.
  - Focused patient summary failure test passed.
  - Full safety-check content test file passed `1` file / `17` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - Claude checker independently reviewed the diff, ran the full safety-check
    content test file, and returned `APPROVED`.
- Remaining:
  - Broad repo-wide objective remains open.
  - Claude noted loading-state banner absence as pre-existing and non-blocking.
- Next action:
  - Start `RR-FE-20260702-C-drug-master-formulary-error-states`, then continue
    queued high-priority frontend false-empty fixes and Codex autonomous
    candidate discovery.

## Current Codex Resume Note - 2026-07-02 07:21 JST

- Active mode for this slice: Claude judgment / Codex execution via agmsg.
  Codex may also autonomously find and implement verified candidates when the
  prioritized queue is not blocked. Preserve unrelated dirty files; do not
  push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-FE-20260702-A-allergy-false-negative`.
- Files changed:
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.test.tsx`
  - `.agent-loop/LOCKS.md`
  - `ops/refactor/BUG_FINDINGS.md`
  - `ops/refactor/INCONSISTENCY_FINDINGS.md`
  - `ops/refactor/REFACTOR_LOG.md`
  - `ops/refactor/VERIFICATION.md`
  - `ops/refactor/STATE.md`
  - `CODEX_GOAL_PROGRESS.md`
  - `.codex/ralph-state.md`
  - `.agent-loop/STATE.md`
- Fixed:
  - Patient medications allergy section no longer collapses patient summary
    allergy fetch failure into `登録なし`.
  - When `allergyInfo` is absent and `patientSummaryQuery.isError` is true, the
    allergy section renders inline `ErrorState` with retry.
  - Fetched allergy success rendering remains unchanged.
- Validation:
  - Red focused regression failed before the fix because allergy error text was
    absent.
  - Focused patient summary failure/success tests passed.
  - Full medications content test file passed `1` file / `23` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`, and
    `pnpm build` passed.
  - Claude checker independently reviewed the diff, ran the full medications
    content test file, and returned `APPROVED`.
- Remaining:
  - Broad repo-wide objective remains open.
  - Non-blocking residual recorded in `ops/refactor/INCONSISTENCY_FINDINGS.md`:
    future explicit `allergyInfo: null` callers need a contract decision.
- Next action:
  - Start `RR-FE-20260702-B-safety-banner-silent-loss`, then continue the
    queued high-priority frontend false-empty fixes and Codex autonomous
    candidate discovery.

## Current Codex Resume Note - 2026-07-02 05:05 JST

- Active mode for this slice: Codex-only backend/service bug-fix loop. Preserve
  unrelated dirty files; do not push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-BUG-20260702-0505-shared-import-safe-error-log`.
- Files changed:
  - `src/server/services/drug-master-import/shared.ts`
  - `src/server/services/drug-master-import/shared.test.ts`
  - `ops/refactor/STATE.md`
  - `ops/refactor/BUG_FINDINGS.md`
  - `ops/refactor/REFACTOR_LOG.md`
  - `ops/refactor/VERIFICATION.md`
  - `REFACTOR_REPORT.md`
  - `REFACTOR_EXECUTION_PLAN.md`
  - `CODEX_GOAL_PROGRESS.md`
  - `.codex/ralph-state.md`
  - `.agent-loop/STATE.md`
- Fixed:
  - `withImportLog()` no longer persists raw caught importer exception messages
    in `drugMasterImportLog.error_log` for shared MHLW/PMDA/HOT/manual
    drug-master imports. It persists fixed
    `医薬品マスタ取込に失敗しました`.
  - If recording the failed import log itself fails, the service emits safe
    structured warning metadata and still rethrows the original importer error.
- Validation:
  - Red focused regression failed before the fix because persisted `error_log`
    contained secret-like / PHI-like importer failure text.
  - Focused shared/logger tests passed `2` files / `33` tests.
  - Shared/MHLW/PMDA/HOT/manual service plus logger tests passed `6` files /
    `83` tests.
  - Import log/status and MHLW/PMDA/HOT/manual route tests passed `7` files /
    `94` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.
  - gbrain FailurePattern write/readback passed:
    `projects/careviax/failures/2026-07-02/shared-import-log-raw-error-log`.
- Remaining:
  - Broad repo-wide objective remains open.
  - Browser smoke was skipped because this service diagnostics fix changes no
    DOM layout, navigation, route contract shape, or workflow shape.
- Next action:
  - Continue bug-hunt / duplicate-helper / query inefficiency inventory with
    focused evidence before editing. Keep DB schema, auth/RLS semantics,
    external sends, migrations, and destructive operations proposal-only unless
    explicitly approved.

## Current Codex Resume Note - 2026-07-02 04:50 JST

- Active mode for this slice: Codex-only backend/service bug-fix loop. Preserve
  unrelated dirty files; do not push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-BUG-20260702-0448-ssk-import-safe-error-log`.
- Files changed:
  - `src/server/services/drug-master-import/ssk.ts`
  - `src/server/services/drug-master-import/ssk.test.ts`
  - `ops/refactor/STATE.md`
  - `ops/refactor/BUG_FINDINGS.md`
  - `ops/refactor/REFACTOR_LOG.md`
  - `ops/refactor/VERIFICATION.md`
  - `REFACTOR_REPORT.md`
  - `REFACTOR_EXECUTION_PLAN.md`
  - `CODEX_GOAL_PROGRESS.md`
  - `.codex/ralph-state.md`
  - `.agent-loop/STATE.md`
- Fixed:
  - `importSskDrugMaster()` no longer persists raw caught import/upsert
    exception messages in `drugMasterImportLog.error_log`. It persists fixed
    `SSK取込に失敗しました` while preserving running log creation, failed status
    update, original exception rethrow, route behavior, and job wrapper
    behavior.
- Validation:
  - Red focused regression failed before the fix because persisted `error_log`
    contained secret-like / PHI-like SSK import failure text.
  - Focused safe-log regression passed.
  - Full SSK import test file passed `1` file / `9` tests.
  - SSK import route plus drug-master job tests passed `2` files / `12` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, `git diff --check`, and `pnpm build` passed.
  - gbrain FailurePattern write/readback passed:
    `projects/careviax/failures/2026-07-02/ssk-import-raw-error-log`.
- Remaining:
  - Broad repo-wide objective remains open.
  - Browser smoke was skipped because this service diagnostics fix changes no
    DOM layout, navigation, route contract shape, or workflow shape.
- Next action:
  - Continue bug-hunt / duplicate-helper / query inefficiency inventory with
    focused evidence before editing. Keep DB schema, auth/RLS semantics,
    external sends, migrations, and destructive operations proposal-only unless
    explicitly approved.
  - Candidate note: broader `drug-master-import/shared.ts` diagnostics remain a
    possible follow-up, but `shared.ts/.test.ts` already have existing dirty
    work and must be inspected before any claim.

## Current Codex Resume Note - 2026-07-02 04:36 JST

- Active mode for this slice: Codex-only backend/service bug-fix loop. Preserve
  unrelated dirty files; do not push/deploy/migrate/destructively mutate data.
- Latest completed slice:
  `RR-BUG-20260702-0436-file-storage-safe-cleanup-errors`.
- Files changed:
  - `src/server/services/file-storage.ts`
  - `src/server/services/file-storage.test.ts`
  - `ops/refactor/STATE.md`
  - `ops/refactor/BUG_FINDINGS.md`
  - `ops/refactor/REFACTOR_LOG.md`
  - `ops/refactor/VERIFICATION.md`
  - `REFACTOR_REPORT.md`
  - `REFACTOR_EXECUTION_PLAN.md`
  - `CODEX_GOAL_PROGRESS.md`
  - `.codex/ralph-state.md`
  - `.agent-loop/STATE.md`
- Fixed:
  - `cleanupExpiredGeneratedFiles().errors[]` no longer returns raw caught
    deletion exception messages. It returns fixed
    `保持期限切れファイルの削除に失敗しました` entries while preserving failure
    counts, processed/scanned counts, cleanup pagination, deletion attempts, and
    the existing safe partial-failure warning.
- Validation:
  - Red focused regression failed before the fix because returned cleanup
    `errors[]` contained secret-like / PHI-like deletion failure text.
  - Focused safe-cleanup regression passed.
  - Full file-storage test file passed `1` file / `72` tests.
  - File-storage plus related PDF bulk-export service/route tests passed `3`
    files / `101` tests.
  - Scoped ESLint, Prettier, and diff-check passed.
  - `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
    `pnpm format:check`, and `git diff --check` passed.
  - gbrain FailurePattern write/readback passed:
    `projects/careviax/failures/2026-07-02/file-storage-raw-cleanup-errors`.
- Remaining:
  - Broad repo-wide objective remains open.
  - Browser smoke was skipped because this service diagnostics fix changes no
    DOM layout, navigation, route contract shape, or workflow shape.
  - `pnpm build` was not rerun for this narrow backend-service slice; latest
    full build evidence remains the preceding visit-planner slice.
- Next action:
  - Continue bug-hunt / duplicate-helper / query inefficiency inventory with
    focused evidence before editing. Keep DB schema, auth/RLS semantics,
    external sends, migrations, and destructive operations proposal-only unless
    explicitly approved.

## Current runtime override - 2026-06-28 JST (rev9: FE/BE split + mutual review restored)

The user re-scoped the cooperation model (2026-06-28). **rev9 supersedes rev8's
disjoint-screen / no-review parallel mode.** New active model — confirmed
bilaterally with Codex over agmsg (both lanes independently proposed the
identical split):

- **Claude = frontend implementation lead.** Owns `src/app/(dashboard)/**` pages
  (UI) + `src/components/**`. Studies existing code, delegates implementation to
  FE subagents (`frontend-implementer` / `general-purpose`), runs the objective
  gate on owned files.
- **Codex = backend implementation lead.** Owns API route handlers, services,
  Prisma/data-access, perf, RLS/tenant-isolation, validation.
- **Mutual review RESTORED (maker/checker).** After implementation the maker
  sends `PATCH_REVIEW_REQUEST` and the **opposite** lane reviews and returns
  `APPROVED` / `CHANGES_REQUESTED` **before ship**. No self-approval.
- **Both main agents stay open on agmsg as dispatchers.** Mains drain inbox,
  ACK/LOCK/route reviews, steer subagents, commit. Implementation runs in
  subagents; mains do not do the bulk editing themselves.
- **Edit discipline.** LOCK exact paths via agmsg before editing; commit only
  own files; drain inbox before commit. DB schema/migrations remain off-limits
  without human approval (BLOCKED.md hard-stops).
- **Sustained loop.** Claude self-drives FE discovery → implement → peer-review
  → verify, pulling from FEATURE_QUEUE.md and autonomous recon when the queue is
  dry. Consult the peer (agmsg) when procedure is unclear. Do NOT use OMC
  `/ultragoal` (known to deadlock — see auto-memory); the `.agent-loop/` loop
  convention IS the sustained-loop mechanism.

**Active goal (user /goal 2026-06-26).** Refine the UI/UX of _all_ pages to a
world-top-level ("10M-download") bar using a 足し算と引き算 (add/subtract)
design philosophy; iterate with screenshots until judged sufficient; no
compromise. Constraints: **no DB changes** (schema/data/migrations off-limits);
backend API/service code _may_ be fixed so a screen renders correctly; if any
existing feature is removed, report what + why at the end; layout may be
rearranged where operation is hard from the user's perspective. Begin with the
highest-frequency user screens first. Research + SSOT refresh first (done), then
screenshot → improve → re-screenshot loops.

**Screen partition (agreed, no review).** Codex lane: dashboard, my-day,
visits/**, schedules/**, prescriptions/**, dispense, set, set-audit, tasks,
workflow, handoff, qr-scan, notifications, search, select-mode, select-site,
offline-sync, conferences, communications/** + shared `src/components/ui/**` +
`src/components/layout/**`. Claude lane: patients/**, reports/**, billing/**,
admin/**, statistics, audit, clerk-support, external, referrals, views +
page-local components + each screen's backend (no DB). SSOT
`docs/ui-ux-design-guidelines.md` owned by Claude.

**Progress (both lanes).**

- Codex: research/SSOT seed `e0f6bd1e`/`5f116094`; dashboard `beb82a27`;
  app-header `0bceeeff`; my-day `163cd7fd`; visits `648fce78`; tasks in flight.
- Claude: parallel mechanism + screen partition restored (rev8 `018f6244`,
  auto-restore driver killed); medical UI/UX SSOT refresh `9e1cdfbd` (research
  integrated). Patient-detail slices: C1 tabular-nums `02b46cb1`; C2
  not-color-alone risk-tile icon `fc094dea` (both prettier OK, vitest 47/47).
- Claude (2026-06-27 session, all own-files-only, all gates green): care-team
  Patient一本化 P4 登録UI `cd347f66`; `/reports/[id]` P0 患者識別 PatientHeader
  バンド + content warnings 上部要約 `dda3422f`; `/patients` board P1 重大安全
  タグ(allergy/narcotic)を +N に畳まない `selectVisibleSafetyTags` `07c13773`;
  `/patients/[id]/safety-check` P1 患者識別 + アレルギー/ハイリスク sticky 再掲
  `e50a38d3`. PatientHeader を report/safety-check で再利用し at-a-glance 識別を
  全画面で統一。follow-up: reports 画面の allergy/high-risk は安全データソース
  未配線(header-summary は safety 非含有)。

Next action: Claude continues the patients lane (deeper at-a-glance refinement
needs the audit screenshot webServer up), then patients list → reports → admin.
Codex continues its lane (visit-schedule-proposals no-store WIP は本セッション
開始以来 working tree に未コミットのまま — 要 status 確認 / stall 疑い)。

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
- FailurePattern: projects/careviax/failures/2026-07-02/visit-schedule-planner-raw-evaluation-diagnostics (RR-BUG-20260702-0429; visit proposal evaluation_error diagnostics now use fixed detail instead of raw upstream exception text)
- FailurePattern: projects/careviax/failures/2026-07-02/offline-sync-raw-diagnostics (RR-BUG-20260702-0417; offline sync unexpected queue failures now persist/log fixed safe diagnostics instead of raw exception text)
- FailurePattern: projects/careviax/failures/2026-07-02/realtime-shared-stream-raw-listener-diagnostics (RR-BUG-20260702-0405; shared realtime stream listener failures now log fixed safe diagnostics instead of raw event/status listener exception text)
- FailurePattern: projects/careviax/failures/2026-07-02/cloudwatch-metrics-raw-failure-log (RR-BUG-20260702-0356; CloudWatch metrics helper now logs a fixed safe metric emission failure diagnostic instead of raw provider/runtime text)
- FailurePattern: projects/careviax/failures/2026-07-02/job-runner-raw-failure-diagnostics (RR-BUG-20260702-0345; job runner retry/final failure rows, admin notifications, and cleanup diagnostics now use fixed safe messages instead of raw caught failure text)
- FailurePattern: projects/careviax/failures/2026-07-02/outbound-webhook-raw-delivery-result (2026-07-02; outbound webhook delivery results returned raw registered URL query secrets and raw dispatch exception text before fixed-message/redacted-result hardening.)
- FailurePattern: projects/careviax/failures/2026-07-01/redis-realtime-unsubscribe-resubscribe-race (RR-BUG-20260701-2349; Redis pubsub unsubscribe/resubscribe race + failed subscribe state rollback)
- FailurePattern: projects/careviax/failures/2026-07-02/background-job-empty-catch-observability-gap (RR-BUG-20260702-0000; background job empty catch replaced with safe logger warning)
- FailurePattern: projects/careviax/failures/2026-07-02/notification-realtime-broadcast-empty-catch (RR-BUG-20260702-0015; realtime notification empty catch replaced with safe logger warning)
- FailurePattern: projects/careviax/failures/2026-07-02/voice-memo-manual-transcript-false-save (RR-BUG-20260702-0031; boolean false local-save result now warns instead of looking successful)
- FailurePattern: projects/careviax/failures/2026-07-02/presence-realtime-broadcast-empty-catch (RR-BUG-20260702-0049; presence realtime empty catch replaced with safe logger warning)
- FailurePattern: projects/careviax/failures/2026-07-02/external-access-rollback-empty-catch (RR-BUG-20260702-0104; external-access rollback revocation failure after fallback audit failure now emits a safe logger warning)
- FailurePattern: projects/careviax/failures/2026-07-02/patient-mcs-failure-state-empty-catch (RR-BUG-20260702-0123; patient MCS failed-state persistence failure now emits a safe warning and identity conflict errors persist fixed PHI-minimized text)
- FailurePattern: projects/careviax/failures/2026-07-02/visit-schedule-proposal-pharmacist-enrichment-empty-catch (RR-BUG-20260702-0138; optional visit proposal pharmacist enrichment failure now emits a safe warning while preserving the null-enrichment fallback)
- FailurePattern: projects/careviax/failures/2026-07-02/presence-heartbeat-client-silent-failure (RR-BUG-20260702-0155; best-effort client presence heartbeat delivery failures now emit a throttled safe warning)
- FailurePattern: projects/careviax/failures/2026-07-02/room-token-client-transient-silent-failure (RR-BUG-20260702-0210; collaboration room-token transient failures now emit throttled safe warnings while preserving retry/access-denied classification)
- FailurePattern: projects/careviax/failures/2026-07-02/phos-fee-rules-rollback-silent-failure (RR-BUG-20260702-0226; PH-OS fee-rules Aurora rollback failures now emit a structured warning while preserving original query error propagation)
- FailurePattern: projects/careviax/failures/2026-07-02/drug-master-import-stream-cancel-silent-failure (RR-BUG-20260702-0237; external drug-master import response-stream cancel failures now emit a safe warning while preserving the original read/byte-limit error)
- FailurePattern: projects/careviax/failures/2026-07-02/backup-monitor-rds-import-false-green (RR-BUG-20260702-0250; configured RDS backup monitor SDK import failures now return error/overall error instead of skipped/overall ok with a fixed safe message)
- FailurePattern: projects/careviax/failures/2026-07-02/health-backup-monitor-raw-error-response (RR-BUG-20260702-0300; /api/health backup monitor catch now returns a fixed safe message instead of raw exception text)
- FailurePattern: projects/careviax/failures/2026-07-02/backup-monitor-aws-check-raw-error-message (RR-BUG-20260702-0310; backup monitor AWS check errors now return/log fixed safe messages instead of raw provider exception text)
- FailurePattern: projects/careviax/failures/2026-07-02/health-check-db-s3-raw-error-message (RR-BUG-20260702-0318; generic DB/S3 health-check failures now return fixed safe messages instead of raw database/AWS exception text)
- FixPattern: projects/careviax/fix-patterns/2026-06-22/agloop-shell-backticks-strip-tokens (RUN-20260622-001 agmsg transport hygiene; avoid shell backticks in AGLOOP bodies built through shell variables because command substitution can strip tokens.)
- FixPattern: projects/careviax/fix-patterns/2026-06-23/href-helper-convergence-test-teeth (F-040〜F-048 claude-maker; raw entity href→共有ヘルパ収束の test teeth=actual-backed spy+sentinel return-value委譲+per-callsite mock.calls厳密+hostile encode+dot-segment fail-fast。API URLはencodeURIComponent('.')no-op正規化をlocal helperで遮断。)
- CandidateLesson: projects/careviax/lessons/role-agnostic-load-balancing (LOOP_POLICY §23; maker/checkロール非依存・相互チェックのみ不変・2軸負荷均等化。codex=supervisor pattern採用でドレインラグ低減。href収束で gap 22:11→22:14。)

## §24 COMPONENT_VERTICAL_SLICE + dual-maker (2026-06-23, user-directed)

手法を機能縦スライス(FE component + API route + server + lib + test)＋dual-maker並列＋コンポーネント全般リファクタへ再設計。LOOP_POLICY §24 として codify(a071cf4b, peer-approved/human-gate pending)。横断 near-dup batch(旧 F-052/F-053)は廃止。

landed (本ラウンド):

- FOUNDATION-A F-060 `98b7b3cc`: src/lib/http/path-segment.ts(encodePathSegment, exact dot fail-closed) + src/lib/api/org-headers.ts(buildOrgHeaders/buildOrgJsonHeaders, case-insensitive collision fail-closed)。
- codex F-061 Patient Labs `7ee44b18` (縦スライス: labs-card + labs API tests + 44px Select a11y)。
- claude F-062 Patient Visit Records `6aad8ed8` (visits-panel + helper + print page; href/URL/header収束 + 44px; BE verify-only)。
- codex F-063 Management Plan `e95e53f4` (panel URL hardening; print page は F-064 へ tracked defer)。
- §24 codify F-065 `a071cf4b`。
- claude F-066 Patient Readiness card `3e12c4c7` (readiness fetch encode + buildOrgHeaders; action_href server-generated as-is)。
- claude F-068 Patient Timeline `f979c976` (timeline fetch encode + buildOrgHeaders; raw id in queryKey)。
- codex F-064 Management Plan print page `94b6220f` (+ralph-state `4fa65c7b`; cross-patient plan-mix privacy guard `careCase.patient.id===patientId`)。
- claude F-070 Patient Communications panel `cf276e04` (contacts+communications GET encode/buildOrgHeaders; emergency-draft static POST→buildOrgJsonHeaders)。
- claude F-071 Patient Conditions card `ff7b8572` (conditions PUT encode + buildOrgJsonHeaders; body verbatim)。
- codex F-069 Conference Notes content `2ded20c5` (+ralph `729af303`; buildConferenceNoteApiPath + buildProposalHref URLSearchParams + buildReportHref)。
- claude F-073 Patient Insurance card `165eb121` (GET/create/update/delete; MULTI-SEGMENT encode patientId+insuranceId on nested CRUD)。
- codex F-072 Care Report detail page `10dd6ac2` (+ralph `c88585ed`; buildCareReportApiPath + idempotency-key-preserving buildOrgJsonHeaders; print/share via encodePathSegment fallback — buildReportHref is single-arg, no suffix)。
  in-flight (dual-maker parallel): claude F-075 patient-master-card (4 callsites: facilityId+patient.id encode + static facilities header), codex F-074 care-report-print-page。
  key design facts surfaced this round:
- F-072 step-5 CHECKER CATCH: `buildReportHref(reportId)` is single-arg → `/reports/${encodeURIComponent(id)}`; cannot take a `/print|/share` suffix. Use `/reports/${encodePathSegment(id)}/print|share` for sub-routes; buildReportHref only for the plain detail link.
- header-helper teeth: two valid styles — (a) import real helper + assert `init.headers).toEqual(buildOrgHeaders(org))` [F-070/F-073], (b) vi.mock the helper + assert `toHaveBeenCalledWith(org[,extra])` [codex F-072]; (b) proves adoption more definitively (raw inline object wouldn't trip the spy) since for no-extra-header GETs (a) can't distinguish raw vs helper.
- multi-segment slices encode EVERY dynamic segment (patientId AND insuranceId / facilityId); dot guard tests cover each segment independently.
- feature_id collisions happen under parallel dual-maker (F-061, F-074); FE side renames (→F-062, →F-075) per precedent.
  recon(read-only)済: id補間 77ファイル/~78箇所、BE route 359本は normalizeRequiredRouteParam 正規化済(verify主体)、boilerplate(x-org-id 317/queryKey 484/onError 187)。component slice 候補マップ有。
  残り patient panel 候補: patient-care-team-panel, patient-contacts-panel, patient-packaging-card(GET+mut), visit-constraints-card(GET+mut), card-workspace(大)。

gbrain writeback(本セッション): FixPattern href-helper-convergence-test-teeth, CandidateLesson role-agnostic-load-balancing(上記)。**TODO 次サイクル**: FixPattern vertical-slice-encode-header-teeth + buildReportHref-single-arg-pitfall + LoopRun(dual-maker F-066〜092 大量 landed)を gbrain へ書く。

### dual-maker 大量ラウンド (2026-06-23, F-066〜F-092) — F-060 primitive 全面採用

claude landed: F-066 readiness `3e12c4c7` / F-068 timeline `f979c976` / F-070 communications `cf276e04` / F-071 conditions `ff7b8572` / F-073 insurance(multi-seg) `165eb121` / F-075 master-card(4 callsite) `fe5724ab` / F-077 care-team `7426943d` / F-078 packaging `c122983a` / F-080 contacts `ffe1a68e`。
codex landed: F-064 mgmt-print `94b6220f` / F-069 conference-notes `2ded20c5` / F-072 care-report-detail `10dd6ac2` / F-074 care-report-print `9b733abd` / F-076 interprofessional-share `0f27d6e8` / F-079 visit-constraints `e129749a` / F-086 print-hub `4d0341b5` / F-087 prescription-detail `d7f40b17` / F-088 prescription-inline `33112a3f` / F-090 patient-documents-panel `51ae7eda` / F-091 facility-multi-visit-href `a032d9fb`。
**card-workspace 6分割 COMPLETE** (claude, 4559行): F-081 documents `583b8390` / F-082 overview+home-ops `9c82aac8` / F-083 billing-profile+mcs `8da2d9b5` / F-084 prescription-intakes+billing-collection(Idempotency-Key保持) `ae05bb78` / F-085 upload-helper(presign/complete/download, 外部S3 PUT不可侵) `67a14228` / F-089 static collections `0a847522`。生 x-org-id リテラル残存ゼロ。/api/tasks foundation POST は意図的に不変(x-org-id無し→追加はsemantics変更)。
**LOOP-OPS docs** (codex maker / claude checker, human承認済): AGENTS.md/CLAUDE.md/MESSAGE_PROTOCOL.md/LOOP_POLICY.md に §25(ACK-first handoff + sender-side WIP + serial long gates + 2-live-agents) を codify `ce885448`。
当ラウンドの新知見: (1) billing collection の Idempotency-Key は buildOrgJsonHeaders(org,{extra}) で保持必須(codex HIGH catch)。(2) helper採用の test 証明は sentinel/identity または mock+spy toHaveBeenCalledWith が必要(toEqual は同形literalと区別不能)。(3) PUT/POST body は exact-equality + 動的 timestamp は ISO-shape、path id は body 非混入を断定。(4) mixed input contract(string vs object mutationFn)は contract別 probe で locate。(5) 巨大ファイルは sub-slice 逐次分割(1 lock/1 patch/1 commit, lock解放間隔)で review 可能性維持。(6) build と typecheck:no-unused は直列(.next/types race、§25)。

**gbrain writeback 完了 (2026-06-23 ラウンドクローズ、user-directed)** — semantic検索可・typed link済:

- FixPattern: projects/careviax/fix-patterns/2026-06-23/api-url-header-convergence-test-teeth (url/header収束スライスの test teeth bar 全条件)
- FixPattern: projects/careviax/fix-patterns/2026-06-23/nav-helper-suffix-arity-pitfall (buildReportHref単一引数 vs buildPatientHref suffix)
- ImplementationDecision: projects/careviax/decisions/2026-06-23/org-json-headers-idempotency-extra (Idempotency-Key保持)
- LoopRun: projects/careviax/loop-runs/2026-06-23/dual-maker-url-header-convergence (claude15+codex11+LOOP-OPS、防いだ欠陥、§25 process lessons)
  ラウンド status: CLOSED。残: codex F-092 collaboration-content commit(承認済、自動受領)。次ラウンド候補(未着手): 他領域の生 /api 補間・href、admin系、settings系。

### ROUND-ORG-HEADERS (2026-06-23 継続) — area-batch + COMPONENT_VERTICAL_SLICE dual-maker

手法: user-directed「残りをまとめて1スライス化」→ 領域別バッチ(複数ファイル/slice)でターン圧縮。maker≠checker、build serialization(BUILDING/DONE_BUILDING announce)。
landed:

- codex F-100 billing-check `7e9ca149` (静的GET header-only; hard-stop-care=純粋header swap、意味変化なし; claude独立検証20テスト)。
- codex F-102 schedule-day 5純ヘルパー `ce9e8195` (facility-batch/visit-day静的 + proposal-action/reschedule/preparation動的; raw-input単一エンコード; claude独立検証189テスト)。
- claude F-101 cases-tab + 完全MCSスライス `f9650946` (cases-tab 4callsite[pharmacists GET/cases POST静的, transition/save動的caseId] + mcs-content 3 mutation + lib/patient-mcs/query overview GET; 全て encodePathSegment(raw)、raw id は queryKey/body/getPatientCareQueryKeys invalidation 維持; 6ファイル/465+80; build exit0/99テスト)。
  in-flight: codex F-103 communications/requests-content (resolve-followup動的POST + list静的GET; claude承認+lock grant済、codex実装中)。
  key 知見(本ラウンド):
- raw-input単一エンコード契約(codex catch×2): `encodePathSegment(rawId)` のみ。既に `encodeURIComponent(patientId)` で派生した alias を再ラップ禁止(二重エンコード→%25、no-%25 teeth違反)。mcs-content の `patientPathId=encodeURIComponent(...)` は `=encodePathSegment(patientId)` へ置換。
- lib helper consumer も同スライスに含める(codex HIGH): mcs-content は lib/patient-mcs/query の overview GET を import → 3 mutation だけ変換すると dot 挙動不整合(mutation fail-closed / GET dot許容)。
- fire-and-forget onClick の dot-guard test: cases-tab save/transition は useMutation 不使用の plain onClick → RangeError が unhandled rejection 化。process-level で Vitest の unhandledRejection listener を一時detach して捕捉、fail-before-fetch を断定(captureUnhandledRejections helper)。hook-backed(useQuery/useMutation captured fn)なら直接 await でよい。
- checker split(codex): reviewer-strict(source/security) + test-auditor(teeth網羅) の2軸。test-auditor が exact body 欠落・component-level dot-guard 欠落を P2/P3 で指摘。

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

**Current update 2026-06-24 (claude-lead, resumed after /clear)**: Drained a 38-msg codex backlog (2026-06-23 13:44–15:10); live queue reconciled from codex's latest STATUS_PING/REQUEST_DELEGATE.

- **F-20260623-105 (Claude maker)** medications + prescription-history org-header/path-segment convergence: maker work COMPLETE with ALL codex prepatch findings folded in — HIGH org-scoped all 4 medication queryKeys + invalidations (`['medication-*', orgId, patientId]`, orgId-first to match the prescription-history sibling); MEDIUM exact add-medication body (`toEqual` full 6-field domain body + `buildOrgJsonHeaders` calledWith); LOW exact queryKey shapes (`toEqual([key,'org_1',HOSTILE])` + summary key); invalidation-key coverage (harness now exposes the invalidateQueries spy + onSuccess; add-medication and issue-status onSuccess assert org-scoped invalidation). Gates GREEN: prettier/eslint/diff-check, vitest 25/25, tsc exit 0, no-unused exit 0. Scope boundary held: did NOT widen into `safety-check-content.tsx` (codex-acknowledged follow-up; its still-org-agnostic key no longer prefix-matches the now-org-scoped key — practically negligible, separate routes never co-mounted). PATCH_REVIEW_REQUEST sent → **codex CODE_REVIEW_RESULT = APPROVED (no findings; independent gate run vitest 38 / eslint / prettier / diff-check / typecheck:no-unused all PASS). COMMITTED 588e8af3 (4 locked files only, +554/-42; STATE.md + projects/ kept out). Claude RELEASED the F-105 lock; DONE sent.** Follow-up filed mentally: org-scope `safety-check-content.tsx` medication-issues key/invalidation to match the new shape (fresh 2026-06-24 task).
- DECLINED codex's HANDOFF (drove F-105 myself post-context-swap).
- **F-106 / F-107 / F-108 (Codex maker)**: header-only org-header convergence for OperationalPolicyContent / Admin AnalyticsContent / DashboardCockpit. Plans reviewed (static URLs, no encodePathSegment, queryKeys already org-scoped, forbidden_paths disjoint from F-105 and each other) → **PLAN APPROVED + LOCK_GRANT sent for all three**. Codex unblocked (was idle).
- **F-104 generate-from-visit**: ACK codex CORRECTION — id collision (F-104 already = report-delivery-dashboard d96658f4); plan SUPERSEDED; codex to refile under a fresh 2026-06-24 id.

**Single next action**: org-header sweep DONE — F-105 588e8af3 (claude), F-106 76b916bd / F-107 3bcd563c / F-108 36349e01 (codex, all claude-APPROVED). codex ledger 1d9fadd6.

**Active program — patient-timeline "全て修正して" (user directive 2026-06-24)** + safety-check follow-up:

- **F-20260624-001** (safety-check convergence, claude maker): rev1 codex CHANGES_REQUESTED (2 findings: WorkflowBackLink raw `/patients/${patientId}` → buildPatientHref; consultation mutation must precompute/validate encodePathSegment(selectedIssue.id) BEFORE interventions POST so dot-id fails closed before side effect). Subagent `sc-rev2` implementing rev2 → then re-send PATCH_REVIEW_REQUEST.
- **F-20260624-002** (timeline BACKEND hardening, **codex maker / claude checker**): ALL tl-backend findings — H1 firstVisitDocuments unbounded findMany+missing composite idx, H2 AuditLog OR-7 unindexed scan, M1 RLS 2nd-layer inactive on read path (route uses raw prisma, no withOrgContext), M2 Promise.all all-or-nothing, M3 JST day-label server-TZ bug, M4 concurrency=4, L1 serial name resolve, L2 sort tiebreak. **GATED: index migration = changes_database_schema human-gate (local verify only, no prod); M1 RLS = security-care; H3 cursor pagination + adapter registry split to F-20260624-003.** codex ACKed → recon→PLAN_REVIEW_REQUEST first; claude reviews plan before LOCK.
- **F-20260624-004** (timeline FE, **claude maker / codex checker**): B1a category colors (`patient-activity-timeline.tsx:80-114` ad-hoc sky/emerald/violet/amber/slate) → `--chart-1..5` series tokens (guidelines L180: series≠state); B1b event status badges → StateBadge/STATUS_TOKENS (L170); B2 completeness banner (recent-N digest, not full history — clinical-safety). LOCK_REQUEST+plan sent → awaiting grant; implement via FE subagent.
- Investigation: tl-backend report received (deep, corrected my "no unbounded query"/"fully parallel" claims — concurrency=4, firstVisitDocuments unbounded, RLS-inactive, TZ bug). tl-recon/product/design reports not yet delivered via channel (re-pinged).

Progress (2026-06-24 cont.):

- **F-20260624-002** (backend): plan rev1 → claude CHANGES_REQUESTED (PLAN-M1-TX-TIMEOUT: single withOrgContext wrap = the 2026-06-22 5s interactive-tx timeout class, defeats M2/M4; PLAN-H2-EVENT-LOSS: patient_id predicate drops legacy audit rows). codex rev2 resolved both (M1 → NOT wrapped in F-002, RLS-on-read split to **F-20260624-005** which must prove timeout-safety; H2 → index-only, no patient_id predicate, write-site recon confirmed optional/unset). **claude APPROVED rev2 + LOCK_GRANT** → codex IMPLEMENTING. Migration additive/local-verify-only, prod HUMAN-GATED.
- **F-20260624-001 rev2** (safety-check): codex CHANGES_REQUESTED 2 findings FIXED (WorkflowBackLink→buildPatientHref; consultation precomputes encodePathSegment BEFORE interventions POST = fail-closed). Gates green (vitest 14/14, tsc 0, nu 0). PATCH_REVIEW_REQUEST rev2 sent → awaiting codex CODE_REVIEW_RESULT.
- **F-20260624-004** (FE timeline): B1a category colors → --chart-1..5 series tokens (guidelines L180); B1b status left as neutral Badge (not bespoke, no over-engineer); B2 completeness banner ("直近のみ・全履歴ではない", clinical safety). Gates green (vitest 9/9, tsc 0, nu 0). PATCH_REVIEW_REQUEST sent → awaiting codex CODE_REVIEW_RESULT.
- Deferred: F-20260624-003 (cursor pagination + adapter registry), F-20260624-005 (RLS-on-read enforcement, timeout-safe).
- Investigation agents tl-recon/product/design never delivered reports via channel (only tl-backend did); design/product/system angles covered by claude's own reads.

**LANDED (org-header sweep + timeline "全て修正して" fix-set)**: F-105 588e8af3 / F-106 76b916bd / F-107 3bcd563c / F-108 36349e01 / F-20260624-001 safety-check **87400f54** / F-20260624-004 FE timeline **244e8843** / F-20260624-002 backend hardening **a0dfa217** (codex, claude-APPROVED high-risk: event-loss guard, JST, settled fail-soft, additive index migration LOCAL-verified/prod-gated). All maker/checker'd.

**LANE REVERSAL (user directive 2026-06-24, ultracode ON)**: remaining timeline follow-ups flip to **CLAUDE maker / CODEX checker** (codex ACKed, checker-standby). 8 idle investigation/impl subagents terminated. Codex granted a small disjoint protocol-docs task (preempted by my reviews per §19).

- **F-20260624-003** (Claude maker): source-adapter registry refactor [behavior-preserving] + cursor pagination [additive contract].
- **F-20260624-005** (Claude maker): timeout-safe RLS-on-read (NOT naive withOrgContext wrap — must avoid the 2026-06-22 interactive-tx 5s timeout, preserve fail-soft, keep explicit org_id filters).
- **Design DONE**: ultracode Workflow (wt0ox27hl, 17 agents/1.05M tok) produced a concrete file-level plan → saved `.agent-loop/plans/F-20260624-003-timeline-followups-plan.md`. claude verified the high-risk decisions (pagination Group-A/B split rule for deep-page event-loss; per-source short-tx `withReadOrgContext` timeout:3000 structurally timeout-safe; ph_os-superuser FORCE-RLS test → it.skip+BLOCKED if no non-superuser role; A/B no-migration). **PLAN_REVIEW_REQUEST sent to codex** (§26 compact + artifact ref) → awaiting PLAN_REVIEW_RESULT.
- **Cycle A LANDED**: codex plan APPROVED_CYCLE_A_ONLY (B/C → rev2 for 5 findings). Implemented via ultracode workflow (1 implementer + 3 adversarial verifiers, all PASS) → all gates green (106 oracle, tsc, no-unused, eslint, prettier, **build** under §26 long-gate lease) → codex CODE_REVIEW APPROVED → **committed e0b4f364** (claude, 3 files +1177/-875). DONE/lock released. Registry: 13 SourceAdapters; op_history stays inline/unguarded-throw; buildPatientTimelineEvents rebuilt on registry (keeps route.ts byte-identical); events↔registry value cycle is call-time/type-only (codex advisory: do NOT add module-init reads of events in registry.ts during B/C).
- **B/C rev2 designed** (wuz3g6u2j, artifact `.agent-loop/plans/F-20260624-003-bc-rev2-plan.md`): resolved C cleanly (DI-preserving ScopedTxRunner seam, op_history fail-soft-with-partial_failures, honest RLS-proof). **BUT claude adversarial self-review found the rev2 Group-B pagination mechanism (per-source native keyset + occurred MergeFloor) STILL has a deep-page LOSS** (the exact B-GROUPB class): ~36 of ~76 fetched rows/page are non-emitted (occurred<floor); Group-A re-fetches them via lte floor but Group-B's native keyset advances PAST them → never re-fetched → lost; plus a no-progress edge. Root cause: occurred_at is a computed coalesce, not a DB column → no single-column Group-B keyset bounds the occurred window without a materialized-occurred migration (human-gated) or unbounded over-fetch. The single-source test would NOT catch it (needs a multi-source cut).
- **codex VERDICT (validated my finding)**: B-GROUPB-RESIDUAL CONFIRMED. **Cycle B DEFERRED entirely** (codex: even Group-A+op_history-only pagination risks users reading "Load More" as full-history; keep the F-002/F-004 bounded+fail-soft+JST+banner digest stable). **Cycle C APPROVED** to proceed independently + 1 condition: actor-name resolution (batchResolveNames) also tx-wrapped → must be fail-soft (codex option 1) or it newly 500s the panel.
- **DEFERRED TASK — `timeline-deep-pagination-deferred` (design-first, NOT started; renamed off F-006 to avoid collision — codex took F-20260624-006 for schedule-team-board org-header convergence, claude-APPROVED + lock-granted)**: deep, loss-free cursor pagination needs EITHER a materialized per-event occurred_at/order_key column (additive migration, HUMAN-GATED) OR a formally loss-free source-local cursor preserving un-emitted native-prefix rows, proven by a MULTI-SOURCE overfetch/cut loss test. Do not implement opportunistically. Artifact `.agent-loop/plans/F-20260624-003-bc-rev2-plan.md` §2 is the shelved (flawed) attempt — keep for reference.
- **Cycle C (RLS-on-read) LANDED `815a8baf` (2026-06-24, claude maker / codex checker)**: ScopedTxRunner DI seam (createScopedTxRunner, timeout 3000 / maxWait 2000, per-source short tx), route drops prisma import + injects runScoped, op_history + source-actor + op-actor name resolution ALL fail-soft-with-partial_failures [keys 'operation_history'/'actor_names'/'operation_actor_names'], honest structural-only RLS proof (8 set_config on handed-out tx + throwing-proxy global) + FORCE-RLS it.skip → BLOCKED.md rls-force-nonsuperuser-proof (human-gated). Resumed after /clear: self-reviewed impl already in tree → all gates GREEN (focused vitest 137 pass/1 skip, tsc exit0, build exit0, no-unused exit0 serial under long-gate lease, prettier/eslint/diff-check) → LONG_GATE_RELEASE + PATCH_REVIEW_REQUEST → codex ran independent serial typecheck/build/no-unused GREEN + CODE_REVIEW APPROVED (no findings, C-only scope, no Cycle B/pagination/schema/registry creep) → committed 8 locked files only (STATE/BLOCKED/projects/ops/plans excluded). C-only lock RELEASED, DONE sent.
- Codex protocol-docs §26 (comm compression + long-gate lease) committed fe197d9d (claude-APPROVED, §26 human-gate for permanent promotion).

Remaining of "全て修正して": program now essentially COMPLETE. Landed set: F-20260624-002 backend hardening `a0dfa217` (codex) / F-20260624-004 FE timeline `244e8843` (claude) / F-20260624-001 safety-check `87400f54` (claude) / F-003 Cycle A registry `e0b4f364` (claude) / **F-003 Cycle C RLS-on-read `815a8baf` (claude, just landed)**. F-005 (timeout-safe RLS-on-read) folded INTO Cycle C — done. Only two items remain, BOTH honest human-gated blockers (not actionable by the loop): (1) **timeline-deep-pagination-deferred** — loss-free deep cursor needs a materialized per-event occurred_at column (additive migration, HUMAN-GATED) or a formally-proven loss-free source-local cursor; artifact `.agent-loop/plans/F-20260624-003-bc-rev2-plan.md` §2 is the shelved flawed attempt. (2) **rls-force-nonsuperuser-proof** (BLOCKED.md) — FORCE-RLS denial proof needs a non-superuser Postgres role + cross-org seed fixture. Next Discover (§22b/§23 Axis 2): pick a fresh component-vertical-slice or area-batch target outside these blockers.

### ROUND-ORG-HEADERS-2 (2026-06-24, claude×codex 並列 dual-maker, resumed after /clear)

User「過去ログ確認して続きを開始」→ F-003 Cycle C を再開・完遂後、§23 Axis 2 で admin org-header/path-segment 収束 sweep を継続。

**LANDED（全 maker/checker'd・objective gate GREEN）:**

- F-003 Cycle C (RLS-on-read, timeout-safe) `815a8baf` + ledger `1b2b76f0`（claude / codex）
- F-007 card-workspace href `856b7bef`（codex / claude）
- F-009 packaging-methods `b4bcff8d`（claude / codex）
- F-011 alert-rules page `ac7c1ba2`（claude / codex; rev1 CHANGES_REQUESTED→rev2: saveMutation PATCH 分岐 + testMutation teeth 追加）
- F-013 signal-tuning-panel `745268e5`（claude / codex; NEW test）→ **admin/alert-rules dir 完全収束**
- F-015 service-areas `3148efd3`（claude / codex）
- F-016 institutions `359c38bc`（codex / claude）
- F-017 business-holidays（codex maker, in-flight）

**プロセス知見（FixPattern 候補）:**

- 共有ワークツリーでの並列 dual-maker build: 各 maker の source が compile する状態を「source stable」合図で確認 → 片方が combined build（両 source 検証）→ コミットは `git commit -- <自パス>` の partial commit で相手の uncommitted を温存。
- jest-dom matcher 未登録（repo は plain DOM assertion 規約 `.disabled`/`.textContent.toContain`）。
- zsh `${PIPESTATUS[0]}` は空 → gate exit は直接 `$?`。
- 並列 build の重複起動 → Next.js "wait for the build to complete" ロック衝突 → 単一実行厳守。
- URLSearchParams query の dynamic 部は encodePathSegment 不要（path segment のみ encode）。

**残: FEATURE_QUEUE.md「ROUND-ORG-HEADERS-2」backlog（~25 ファイル、未着手）。drug-master-content.tsx は BIG=sub-slice 必須。** gbrain writeback TODO: 本ラウンドの FixPattern（shared-tree-parallel-build-coordination / plain-dom-assertion-convention / zsh-pipestatus）。

### ROUND-MAINUI (2026-06-24, user /goal: 主要UI改善 — UI+対応backend, 高ROI新機能可, 左メニュー全リンク先必須, ultracode探索, 操作性全力)

User-directed program after the org-header sweep. Method: ultracode 51-screen research → master backlog → dual-maker (claude×codex) ROI slices, maker/checker + objective gates, §15 human-gate for auth/billing/security/destructive/prod.

**Research artifact**: `ops/MAINUI_RESEARCH_SYNTHESIS.json` (30 ROI candidates / 78 render defects / 10 themes, from a 52-agent Workflow). Render verification: PASS (render-smoke 94/0fail, all 25 sidebar routes clean).

**LANDED (all maker/checker'd, gates GREEN):**

- F-20260624-020 左メニュー: 到達不能3管理画面(ヒヤリハット/鑑査差戻し分析/薬局間協力)を admin サイドバー追加 `89c3bb3e` (claude/codex)
- F-20260624-021 visit-prep 在宅intake安全コンテキスト(PHI-minimal) `1d7a34a9` (codex/claude)
- F-20260624-022 /schedules 当日スコープ集計+perf(org-wide /api/tasks GET 撤廃) `352753f8` (codex/claude)
- F-20260624-023 dashboard @db.Time TZ バグ(JST~9hずれ)修正: route が wall-clock "HH:MM" emit `4da83466` (claude/codex)
- F-20260624-024 drug-masters 偽データスタブ→実 DrugMasterContent(variant=master) `fd05b650` (claude/codex)
- F-20260624-025 handoff recipient routing(BLOCKER#7: recipient_user_id, direction復旧) `b4c29119` (codex/claude)
- F-20260624-026 /prescriptions/intake 行アクション deep-link(buildPrescriptionHref) `5384f60c` (codex/claude)
- F-20260624-027 患者ボード truncation honesty(truncated=assignedTotal>fetched, バナー) `e71eb083` (claude/codex)
- F-20260624-028 dispense-task 読取権限を clerk read-all 整合(canDispense||canAuditDispense||canReport, write は canDispense-only) `c46f18c7` (codex maker/claude checker; **codex usage-limit handoff により claude が承認済みコードを commit**)
- §15 human-gate 8項目を BLOCKED.md 記録 `9c35cb6d`

**AUTH-POLICY 判断(人間)**: F-028 で「事務(clerk) read-all を維持(canReport も許可)」を AskUserQuestion で確定。checker が read-all 仕様との矛盾を検知→人間エスカレーション→反映、の流れが機能。

**CODEX HANDOFF (2026-06-24 04:42)**: codex が usage 上限で全タスクを claude へ委譲し standing down。**claude が単独実装エージェント**に。今後の claude maker スライスは **reviewer-audit/code-reviewer サブエージェントを checker パス**として使う(同一コンテキスト self-approve 禁止、OMC/CLAUDE.md)+ objective gates が arbiter。codex は人間が明示再開するまで新規作業しない。

**残 backlog(非§15・未着手)**: #2b/c/d 他 MasterEditorView スタブ画面(staff/facilities/external-professionals 実データ化=中規模, drop-in 実コンポーネントなし→構築要), #6 false-empty DataTable error 横断配線(~10 admin画面), #29 44px タッチターゲット, #30 StateBadge enum→token, #12b 患者ボード priority-before-take(design-gated: JS派生順序→bounded priority pre-query か materialized column[human-gate]). 詳細は `ops/MAINUI_RESEARCH_SYNTHESIS.json`。
**§15 human-gate(BLOCKED.md, 自動land禁止)**: workbench実データ既定化(prod/audit-attribution), 操作者ID(auth), billing集計(billing), 証跡写真S3(security/prod), data-explorer監査ログ+no-harddelete(prod), settings範囲(security), jobs error-log redaction(security), incidents/permission(auth), notification OS-bridge redaction(security/privacy).

**環境メモ**: 本セッションで claude が起動した `next dev`(PID 58301, :3000)が main `.next` を占有。auto-mode 分類器が claude による kill を拒否。in-place build は衝突するため build は **隔離 git worktree** で実施(render-smoke/codex 実証)。zsh は `${PIPESTATUS[0]}` 空→gate exit は直接 `$?`。

### ROUND-FALSEEMPTY (2026-06-24, claude solo — user: codex リミット到達、claude 単独運用へ。codex 宛タスクも claude が処理)

**運用変更**: codex usage 上限到達のため **claude 単独運用**へ正式移行（人間指示）。maker/checker 分離は **reviewer-audit/code-reviewer サブエージェント**の独立 checker パスで担保（同一コンテキスト self-approve せず）。codex 宛だった F-029 も claude が実装。build は dev server(PID 58301) 占有のため隔離 worktree（`pnpm_config_verify_deps_before_run=false` で symlink node_modules の purge 中断を回避; CI=true は main node_modules 削除リスクで厳禁）。

**LANDED (claude maker / reviewer-audit checker, 全 gate GREEN + 隔離 build exit0):**

- F-20260624-030 /admin/realtime workbench 優先度 enum→日本語ラベル(PRIORITY_DISPLAY_LABELS, 色のみ依存回避) `40fb1a20`
- F-20260624-029 pharmacist-credentials 一覧 DataTable false-empty→ErrorState+retry(isError 配線, PHI-free) `c3f80974`
- F-20260624-031 同 登録ダイアログ 対象スタッフ Select の silent-empty→inline role=alert+retry(reviewer LOW follow-up) `481b34f5`
- F-20260624-032 false-empty/false-zero 一掃 3画面(facility-standards 誤判定 top-level guard / staff-kpi-panel false-zero KPI 月ピッカー残し / document-templates 一覧 region scoped) `9252971e`
- F-20260624-035 /tasks タスク表(desktop+mobile)+staff-workload board の false-empty→ErrorState/inline+retry `5b2feecd` (reviewer-audit APPROVED, 隔離 build exit0)

**運用上の注意 (rogue fork context-bleed, 2026-06-24)**: ROUND-FALSEEMPTY で 3画面修正を **fork サブエージェント**に並列委譲したところ、fork が私のフルコンテキストを継承していたため scoped タスク(1ファイル編集+focused vitest)を超え、**計画全体を自律実行**(4画面を私の指示前に commit `481b34f5`/`9252971e`、STATE chore `b4ebf8e6`、対象外 /tasks にも同パターン適用)。整合性検証の結果 add -A 汚染/--amend なし・committed 分は reviewer-audit 承認済みで健全だったため採用、議論余地ある a11y 微調整のみ revert、/tasks は正式 gate/build/レビューに載せ直して land。**教訓**: scoped 機械的作業の委譲は fork ではなく **general-purpose/frontend-implementer**(orchestration 意図を継承しない)を使う。fork を使うなら「commit するな/他ファイルに触れるな/X で止まれ」を明示しても bleed しうる前提で監査する。

**FixPattern**: useQuery に `isError`+`refetch` 追加 → 失敗時 DataTable/KPI を `<ErrorState variant=server>`+「再読み込み」(`void refetch()`)へ置換。早期 return は全 hook 後（hook 順序保持）。テストは hoisted `useQueryMock` で isError 注入、または real QueryClient+`retry:false`+fetch 500。false 値の **不在** を assert（ErrorState 存在だけでなく）。

**残 backlog(非§15)**: billing-rules/page.tsx は admin DataTable で唯一 false-empty 残だが **§15 billing 隣接 → defer**(UI error-state のみでも billing は人間判断に寄せる)。pharmacist error 分岐の dangling `htmlFor` label = a11y NIT(reviewer 指摘, role=alert で SR 担保, 機能影響なし)。他: #2b/c/d MasterEditorView スタブ実データ化, #29 44px タッチ, #30 StateBadge enum→token 残(jobs/billing-rules/performance/pca), #12b priority-before-take(design-gated)。

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.

### ROUND-WORKBENCH (2026-06-24, claude solo + ultracode workflow)

**§15 人間承認**: ユーザーが AskUserQuestion で 4画面ワークベンチの「読取＋書込フル実データ化」を明示承認 → BLOCKED.md `mainui-workbench-real-data-default` / `mainui-workbench-operator-identity` の human-gate を解除（実装は maker/checker + objective gate + 非モック監査証跡検証を通す）。工程キュー=待ち+作業中、4工程=分離画面（切替は左メニュー）も確定。

**ultracode workflow `wf_4c349ea2-c3c`**: design(3レンズ)→synthesize→review(3敵対的, 全 CHANGES_REQUESTED で実バグ捕捉)→implement Slice T→verify。統合プラン=`~/.claude/plans/foamy-wishing-fern.md`（16k字＋レビュー補正20件追記）。後続 Slice 1〜4 はこの補正版で進める。レビュー補正の要点: `useRealtimeEvents().connected` はコンパイル不可→`useNetworkOnline()`; API auditor は現閲覧者であり履歴帰属でない→fail-closed「—」; seta は SetBatch 集計(Slice 2)前に base-status で出さない; phase を全 call site に通す; Slice T E2E は左メニュー(ラベル「監査」)＋href セレクタ。

**LANDED**:

- Slice T 工程タブ撤去→分離画面（PhaseHeader=静的 `<nav aria-label="現在の工程">`, phase-tabs.tsx 削除, .phaseTabBar 枠/トークン据置でレイアウト不変, 工程切替=左メニュー）`531ac1d3`（claude maker / reviewer-audit APPROVED; unit/tsc/no-unused/prettier/eslint/隔離build green; E2E 2スペックを新アンカー+左メニュー href へ移行＝lint/collection clean）。

**未了/follow-up**:

- E2E runtime 検証: 稼働 :3000 が turbopack で全スペック環境エラー → webpack e2e サーバ(:3012)で `pnpm test:e2e:local` 要確認（私の変更とは無関係の環境ブロック）。
- ローカル main は Slice T 未取込（main...refactor = 3 ahead / 1 behind; 先のマージは時点マージ。再マージは要指示）。

**全 Slice LANDED 完了（2026-06-24, claude maker / reviewer-audit checker, 全 objective gate GREEN + 隔離 build exit0）:**

- Slice 1B BFF per-phase patient queue filter `359823f4`（PHASE_CYCLE_STATUSES SSOT、後方互換、set-audit 空ゲート）。
- **Slice 1A** adapter 実データ既定化（USE_MOCK flip + `'mock'`/`'0'` opt-out seam）+ 全 call site phase 伝播 + PHASE_TO_API_PARAM `c6381067`。reviewer teeth: 4 mutation。
- **Slice 2** set/set-audit を SetBatch 集計で排他分割 `17b74b05`（classifySetBatchPhase = set-derivations と同一基準。reviewer P1: NG セル無視を ng 軸追加で修正＝差戻し待ちを set-audit に保持。teeth 6 mutation）。
- **Slice 3 (§15)** operator-identity 実結線 `d74bf88e`（実 dispenser 保持 / API auditor=viewer は「操作者」表示で監査帰属に非混入 / useNetworkOnline / --wb-status-offline AA / calBarMeta fail-closed '—'。捏造名 山田花子・佐々木健 完全排除。reviewer 10観点 PASS + teeth 3 mutation）。
- **Slice 4 (§15 teeth)** 書込監査帰属検証 `aa91f085`（dispense-results/dispense-audits/set-audits が ctx.userId のみで帰属、改竄 client id を無視。各 route の create を client 値優先へ脆弱化すると赤転。self-audit 例外不可侵）。
- **Slice 1 UI/UX** 左ペイン honest loading/error/empty + retry `2a08802d`（adapter `ok` discriminator、store loadError/retryNonce 非永続、buildView listState、seed ちらつき防止、fail-closed 維持。reviewer APPROVED + teeth 3 mutation + 空実データ crash 安全性確認）。

**§15 sign-off**: BLOCKED.md `mainui-workbench-real-data-default` / `mainui-workbench-operator-identity` を **RESOLVED 注記**（人間承認 via AskUserQuestion + maker/checker + objective gate + 非モック監査証跡を Slice 4 teeth で実証）。

**残 follow-up（非ブロッカー、別スライス）**: (1) set/seta 左ペインの取得失敗が empty 表示（calendar 経路の error 判別未配線、Slice 1 UI/UX P2）。(2) calBarMeta の実 set者/監査者名結線（現状 honest '—'、Slice 3 follow-up）。(3) AuditLog actor / CycleTransitionLog.actor_id / セル単位帰属の追加 teeth（Slice 4 P2）。(4) 左ペイン密度 14/12/11px の cosmetic。(5) 委譲事故の教訓: frontend-implementer は stale base の auto-worktree で作業し未完→破棄、精密 §15 作業は claude 直実装が安全（subagent は read-only review 限定）。

### Resume point - 2026-07-02 05:52 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-BUG-20260702-0552-rate-limit-safe-failure-log`.
- Changed owned runtime files:
  `src/lib/api/rate-limit.ts` and `src/lib/api/rate-limit.test.ts`.
- Fixed rate-limit raw failure diagnostics and catalog drift:
  DynamoDB rate-limit store failures now log only safe event/operation/error
  name metadata, while preserving production fail-closed behavior and
  non-production memory fallback. The route template catalog now includes
  `/api/visit-schedules/:id/conflict-reconfirmation`.
- Validation passed:
  focused red-then-green rate-limit safe-log regression, full rate-limit suite
  `1` file / `33` tests, scoped ESLint/Prettier/diff-check,
  `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
  `pnpm format:check`, and `pnpm build`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/rate-limit-raw-dynamodb-failure-log`.
- Next action: continue current bug-hunt / duplicate-helper / query
  inefficiency inventory; keep DB schema, migrations, RLS/auth semantics,
  external sends, billing semantics, production config, and destructive
  operations proposal-only unless explicitly approved.

### Resume point - 2026-07-02 12:36 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-PERF-20260702-F04-offline-base64-chunking`.
- Changed owned runtime files:
  `src/lib/utils/base64.ts`, `src/lib/offline/crypto.ts`,
  `src/phos/api/offlineEvidenceQueue.ts`, and
  `src/phos/contracts/phos_contracts.ts`.
- Changed owned tests:
  `src/lib/utils/base64.test.ts`, `src/lib/offline/crypto.test.ts`, and
  `src/phos/api/offlineEvidenceQueue.test.ts`.
- Fixed:
  encrypted offline payload base64 encoding now uses a canonical chunked helper;
  PH-OS evidence queue uses the same helper; replay validates decoded bytes,
  size, and SHA-256 before presign/upload; unreadable evidence remains visible
  with sanitized `EVIDENCE_PAYLOAD_UNREADABLE`.
- Validation passed:
  focused offline/PH-OS suite `6` files / `86` tests, scoped
  ESLint/Prettier/diff-check, `pnpm typecheck`, `pnpm typecheck:no-unused`,
  `pnpm lint`, and `pnpm build`.
- Validation exception:
  `pnpm format:check` failed only on unrelated existing `ops/refactor/*`
  formatting issues; changed files passed scoped Prettier.
- gbrain writeback slugs:
  `projects/careviax/decisions/2026-07-02/offline-base64-helper-consolidation`
  and
  `projects/careviax/failures/2026-07-02/offline-evidence-unreadable-payload-hidden`.
- Next action:
  commit this coherent slice with explicit paths, send coordination FYI if the
  local messenger is available, then continue the next highest-value ULTRACODE
  item after rechecking dirty ownership.

### Resume point - 2026-07-02 06:06 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-BUG-20260702-0606-secrets-safe-fallback-log`.
- Changed owned runtime files:
  `src/lib/config/secrets.ts` and `src/lib/config/secrets.test.ts`.
- Fixed Secrets Manager fallback raw diagnostics:
  `getSecrets()` now logs only safe event/operation/error-name metadata when a
  configured Secrets Manager fetch fails and the helper falls back to
  environment values. `bootstrapSecretsIntoEnv()` uses the same safe metadata
  warning pattern for unexpected bootstrap failures.
- Validation passed:
  focused red-then-green secrets fallback safe-log regression, full secrets
  config suite `1` file / `6` tests, scoped ESLint/Prettier/diff-check,
  `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
  `pnpm format:check`, and `pnpm build`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/secrets-manager-raw-fallback-log`.
- Next action: continue current bug-hunt / duplicate-helper / query
  inefficiency inventory; keep DB schema, migrations, RLS/auth semantics,
  external sends, billing semantics, production config, and destructive
  operations proposal-only unless explicitly approved.

### Resume point - 2026-07-02 06:12 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-BUG-20260702-0612-phos-lambda-safe-observability-log`.
- Changed owned runtime files:
  `src/phos/backend/lambda-handler.ts`,
  `src/phos/backend/lambda-handler.test.ts`,
  `src/phos/backend/lambda-observability.ts`, and
  `src/phos/backend/lambda-observability.test.ts`.
- Fixed PHOS Lambda raw observability diagnostics:
  observability flush and security-event persistence failures now log safe
  `error_name` metadata instead of raw provider/runtime exception messages.
- Validation passed:
  focused red-then-green PHOS Lambda safe-log regressions, full PHOS Lambda
  handler/observability suites `2` files / `24` tests, scoped
  ESLint/Prettier/diff-check, `pnpm typecheck`, `pnpm typecheck:no-unused`,
  `pnpm lint`, `pnpm format:check`, and `pnpm build`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/phos-lambda-raw-observability-log`.
- Next action: continue current bug-hunt / duplicate-helper / query
  inefficiency inventory; keep DB schema, migrations, RLS/auth semantics,
  external sends, billing semantics, production config, and destructive
  operations proposal-only unless explicitly approved.

### Resume point - 2026-07-02 06:23 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-BUG-20260702-0623-phos-evidence-cleanup-safe-principal-log`.
- Changed owned runtime files:
  `src/phos/backend/evidence-upload-verification.ts` and
  `src/phos/backend/evidence-upload-verification.test.ts`.
- Fixed PHOS evidence cleanup raw principal diagnostics:
  default S3 evidence cleanup failure logs now emit hash-only tenant/user
  identifiers, and cleanup reporter failure logs reuse the same hash-only
  context. Custom `on_cleanup_failure` callback payloads remain unchanged.
- Validation passed:
  focused red-then-green evidence cleanup safe-principal-log regression, full
  evidence verifier plus structured logger tests `2` files / `14` tests,
  scoped ESLint/Prettier/diff-check, `pnpm typecheck`,
  `pnpm typecheck:no-unused`, `pnpm lint`, `pnpm format:check`, and
  `pnpm build`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/phos-evidence-cleanup-raw-principal-log`.
- Next action: continue current bug-hunt / duplicate-helper / query
  inefficiency inventory; keep DB schema, migrations, RLS/auth semantics,
  external sends, billing semantics, production config, and destructive
  operations proposal-only unless explicitly approved.

### Resume point - 2026-07-02 06:30 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-BUG-20260702-0630-security-event-safe-failure-log`.
- Changed owned runtime files:
  `src/lib/auth/security-events.ts` and
  `src/lib/auth/security-events.test.ts`.
- Fixed security-event audit persistence fallback diagnostics:
  fire-and-forget AuditLog write failures now log through the shared safe logger
  object overload instead of legacy raw console arguments containing request
  paths and caught error objects.
- Validation passed:
  focused red-then-green security-event safe-failure-log regression, related
  security-events/logger/auth/RLS tests `5` files / `44` tests with `1`
  skipped, scoped ESLint/Prettier/diff-check, `pnpm typecheck`,
  `pnpm typecheck:no-unused`, `pnpm lint`, `pnpm format:check`, and
  `pnpm build`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/security-event-audit-log-raw-failure-log`.
- Next action: continue current bug-hunt / duplicate-helper / query
  inefficiency inventory; keep DB schema, migrations, RLS/auth semantics,
  external sends, billing semantics, production config, and destructive
  operations proposal-only unless explicitly approved.

### Resume point - 2026-07-02 06:37 JST

- Active broad refactor/bug-fix objective remains open. Latest validated slice:
  `RR-BUG-20260702-0637-me-profile-mfa-safe-failure-log`.
- Changed owned runtime files:
  `src/app/api/me/profile/route.ts` and
  `src/app/api/me/profile/route.test.ts`.
- Fixed `/api/me/profile` Cognito MFA fallback diagnostics:
  optional MFA state lookup failures now log through the shared safe logger
  object overload instead of legacy raw `console.warn` errors, while preserving
  successful profile response behavior and `mfaEnabled: false` fallback.
- Validation passed:
  focused red-then-green profile MFA safe-failure-log regression, full profile
  route plus logger tests `2` files / `18` tests, scoped
  ESLint/Prettier/diff-check, `pnpm typecheck`, `pnpm typecheck:no-unused`,
  `pnpm lint`, `pnpm format:check`, and `pnpm build`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/me-profile-mfa-raw-failure-log`.
- Next action: continue current bug-hunt / duplicate-helper / query
  inefficiency inventory; keep DB schema, migrations, RLS/auth semantics,
  external sends, billing semantics, production config, and destructive
  operations proposal-only unless explicitly approved.

### Resume point - 2026-07-02 13:08 JST

- Active broad ULTRACODE/refactor objective remains open. Latest validated
  slice:
  `RR-FE-20260702-F05-F10-F12-patient-share-management-plan-error-state`.
- Changed owned runtime files:
  `src/app/(dashboard)/patients/[id]/card-workspace.tsx` and
  `src/app/(dashboard)/patients/[id]/card-workspace.test.tsx`.
- Fixed patient-share management-plan false-empty and stale payload behavior:
  lookup failures now show a retryable alert instead of `承認済み計画なし`;
  true empty remains distinct; retry calls `refetch`; stale retained
  TanStack Query data is not rendered as options and cannot populate
  `shared_management_plan_id/version`.
- Validation passed:
  full card-workspace suite `1` file / `62` tests, related patient UI bundle
  `4` files / `87` tests, scoped ESLint/Prettier, `pnpm typecheck`,
  `pnpm typecheck:no-unused`, `pnpm lint`, and `pnpm build`.
  `pnpm format:check` failed only on unrelated existing `ops/refactor/*.mjs`
  formatting warnings.
- Incidental current-worktree note:
  `src/components/ui/data-table.test.tsx` had a pre-existing dirty CSV export
  test whose mock typing broke full typecheck; the local mock typing was fixed
  and its suite passed `1` file / `6` tests. Keep it separate from the
  patient-share commit unless explicitly owning that test slice.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/patient-share-management-plan-false-empty`.
- Next action: commit the patient-share slice and ledgers with explicit paths,
  leave unrelated dirty files unstaged, send coordination FYI if messenger is
  available, then continue the next highest-value ULTRACODE/refactor item.

### Resume point - 2026-07-02 13:21 JST

- Active broad ULTRACODE/refactor objective remains open. Latest validated
  slice:
  `RR-FE-20260702-F11-visit-record-schedule-error-fail-closed`.
- Changed owned runtime files:
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx` and
  `src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`.
- Fixed visit-record schedule false-safe behavior:
  schedule fetch failure or missing schedule data now shows page-level
  assertive ErrorState with retry, and does not render the editable visit form,
  save action, medication-management section, CDS false no-alert state, or
  carry-item acknowledgement. Visit-preparation fetch waits for `schedule.id`;
  loaded-schedule/CDS failure remains visible via `isUnavailable`.
- Validation passed:
  focused visit form / CDS / ErrorState / visit-record API backstop bundle
  `4` files / `102` tests, scoped ESLint/Prettier, `pnpm typecheck`,
  `pnpm typecheck:no-unused`, `pnpm lint`, `pnpm build`, and
  `pnpm format:check`.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/visit-record-schedule-fetch-false-safe`.
- Next action: commit this F11 slice and ledgers with explicit paths, notify
  via agmsg if messenger is available, then continue the next highest-value
  ULTRACODE/refactor item.

### Resume point - 2026-07-02 13:33 JST

- Active broad ULTRACODE/refactor objective remains open. Latest validated
  slice:
  `RR-FE-20260702-F02-data-table-source-row-index`.
- Changed owned runtime files:
  `src/components/ui/data-table.tsx` and
  `src/components/ui/data-table.test.tsx`.
- Fixed DataTable sorted/filtered desktop row identity:
  selected-row highlight, click activation, and Enter/Space activation now use
  source `row.index`, matching mobile behavior and DataTable consumers that
  resolve callbacks against original arrays. Rendered zebra striping remains
  based on rendered row order.
- Validated same-file CSV export safety:
  client export uses shared `quotedCsvRow()` and neutralizes formula-prefix
  cells like `=SUM(...)`; the regression mocks anchor click to avoid jsdom
  navigation warning noise.
- Validation passed:
  DataTable focused suite `1` file / `7` tests, final DataTable + safe-csv
  bundle `2` files / `17` tests, scoped ESLint/Prettier/diff-check,
  `pnpm typecheck`, `pnpm typecheck:no-unused`, `pnpm lint`,
  `pnpm format:check`, and `pnpm build`.
- Review:
  Codex frontend reviewer and test architect reported no blockers; optional
  filter coverage and test hygiene suggestions were applied.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/data-table-sorted-filtered-row-index`.
- Commit:
  `574a91fb` (`fix(data-table): preserve source row identity after sorting`).
- Next action: notify via agmsg if available, then continue the next
  highest-value ULTRACODE/refactor item.

### Resume point - 2026-07-02 13:47 JST

- Active broad ULTRACODE/refactor objective remains open. Latest validated
  slice:
  `RR-BUG-20260702-F01-patient-status-window-query-order`.
- Changed owned runtime files:
  `src/server/services/patient-status-tracker.ts` and
  `src/server/services/patient-status-tracker.test.ts`.
- Fixed patient-status tracking daily job SQL:
  the raw SQL now orders the outer ranked audit-log query by projected `rn`,
  not non-projected `created_at`. The inner window still orders by
  `created_at DESC`, preserving newest-first status history per patient and the
  malformed-latest-log fallback behavior.
- Validation passed:
  focused patient-status tracker suite `1` file / `7` tests, scoped
  ESLint/Prettier/diff-check, `pnpm typecheck`, `pnpm typecheck:no-unused`,
  `pnpm lint`, `pnpm format:check`, and `pnpm build`.
- Review:
  Codex db steward and test architect reported no blockers; optional `AS rn`
  alias coverage was added before final validation.
- gbrain writeback slug:
  `projects/careviax/failures/2026-07-02/patient-status-window-query-outer-order-created-at`.
- Commit:
  `a5a9c84f` (`fix(patient-status): avoid invalid audit log ordering`).
- Next action: notify via agmsg if available, then continue the next
  highest-value ULTRACODE/refactor item.
