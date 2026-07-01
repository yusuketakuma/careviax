# REFACTOR_EXECUTION_PLAN.md

Snapshot: 2026-07-01 JST

This plan turns the broad refactor objective into small, behavior-preserving
work units. It keeps the full objective open while preventing unsafe bulk
rewrites.

## Scope

- Repository: current `careviax` checkout / `ph-os` package.
- Refactor mode: behavior-preserving.
- Explicitly out of normal implementation scope:
  - DB schema and migrations
  - RLS policies
  - auth/authz behavior
  - tenant selection behavior
  - audit semantics
  - external sends
  - billing semantics
  - medication identity semantics
  - patient medical data behavior changes
  - old UI removal
  - response envelope migration
  - production config/secrets
  - dependency upgrades

If any of those are needed, create a proposal first. Do not implement silently.

## Current Evidence

- Worktree was clean at Phase 0 restart.
- `refactor-instructions.md` remains an important behavior-preserving refactor
  handoff document, but the three required Phase 0 `REFACTOR_*` files were not
  present before this slice.
- `.agent-loop/GATE_CONFIG.md` defines cheap gates:
  - lint
  - format check
  - typecheck
  - no-unused typecheck
  - targeted Vitest
- Heavy gates:
  - full unit suite
  - build
  - E2E / audit E2E
- Recent validated progress includes:
  - document-delivery-rule helper/no-store hardening
  - unused admin `MasterEditorView` stub removal
  - `/admin/metrics` placeholder zero removal
  - nav badge API path/header helper convergence
  - `/api/nav-badges` no-store response boundary hardening

## Completed Slices

### 2026-07-01 11:33 JST: Nav Badge API Path And Header Helper

- Completed safe candidate: `Nav badge path helper only`.
- Files changed:
  - `src/components/layout/use-nav-badges.ts`
  - `src/components/layout/use-nav-badges.test.ts`
  - `src/lib/nav-badges/api-paths.ts`
  - `src/lib/nav-badges/api-paths.test.ts`
- Validation:
  - focused nav badge/sidebar/API/service suite passed `6` files / `41` tests
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - diff whitespace check passed
- Remaining follow-up:
  - `/api/nav-badges` no-store route assertion/hardening is a separate API
    privacy candidate, not part of the helper-only slice.

### 2026-07-01 11:43 JST: Nav Badge Route No-Store Boundary

- Completed safe follow-up: `/api/nav-badges` response privacy hardening.
- Files changed:
  - `src/app/api/nav-badges/route.ts`
  - `src/app/api/nav-badges/route.test.ts`
- Validation:
  - focused nav badge/sidebar/API/service suite passed `6` files / `44` tests
  - full typecheck passed
  - no-unused typecheck passed
  - full lint passed
  - full format check passed
  - diff whitespace check passed
- Remaining follow-up:
  - Nav badge service parity/date-boundary/RLS request-context questions remain
    separate behavior candidates.

## Execution Order

1. Maintain Phase 0 documents.
   - Keep `REFACTOR_REPOSITORY_INVENTORY.md`,
     `REFACTOR_RISK_MAP.md`, and this plan current when the repo shape or
     refactor strategy changes.
2. Pick one bounded change.
   - Prefer one surface, one helper family, or one route family.
   - Inspect live code and tests before editing.
3. Declare slice intent.
   - Purpose.
   - Target files.
   - Expected behavior preservation.
   - Risks.
   - Validation.
4. Implement the smallest complete change.
   - No opportunistic unrelated formatting.
   - No broad staging.
   - No migration/auth/RLS/audit/PHI behavior changes.
5. Validate.
   - Focused tests first.
   - Cheap gates before commit.
   - Heavy gates only at larger boundaries or when impacted.
6. Record progress.
   - Update `.codex/ralph-state.md` and `CODEX_GOAL_PROGRESS.md` when relevant.
   - Include commands and results, not intent-only claims.
7. Commit as a coherent group.
   - Implementation commit.
   - Progress/docs commit if separate.
   - Send agmsg FYI after commit.
8. Repeat.
   - Re-scan for remaining high-value candidates.
   - Keep the full objective open until requirement-by-requirement evidence
     proves completion.

## Repository Priority

1. Low-risk helper convergence and dead-code cleanup with proof.
2. False-empty/truncation display improvements where API compatibility is
   additive and tests can prove behavior.
3. Large-module pure helper/type extraction with characterization tests.
4. Patient/report/schedule helper work only with privacy/medical/date review.
5. P0 work only as proposals unless explicitly approved.

## Standard Change Unit

Each slice should normally satisfy:

- 1 purpose.
- 1 user-facing surface, route family, or helper family.
- 2-6 changed files where possible.
- Existing behavior preserved.
- Tests added/updated when the behavior needs locking.
- Focused validation run.
- Cheap gates green before commit.
- Progress ledger updated with evidence.

## Candidate Work Packages

### 1. Report Generation Path Helper

- Files:
  - `src/lib/reports/generate-from-visit-client.ts`
  - existing or new `src/lib/reports/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize `/api/care-reports/generate-from-visit`.
  - Reduce URL/path drift.
- Risk:
  - Care report generation touches patient care content.
  - Path-only change must preserve payload and headers.
- Validation:
  - focused report generation client tests
  - hostile/encoded path assertions if applicable
  - cheap gates
- Rollback:
  - Revert helper commit.

### 2. Nav Badge API Helper

- Files:
  - `src/components/layout/use-nav-badges.ts`
  - existing or new `src/lib/nav-badges/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize `/api/nav-badges`.
  - Reduce layout fetch drift.
- Risk:
  - Badge counts are operational signals.
  - Must not expose PHI in errors/logs.
- Validation:
  - hook/helper tests
  - org-missing disabled behavior
  - fetch failure behavior
  - cheap gates
- Rollback:
  - Revert helper commit.

### 3. Admin Notification Settings Path Helpers

- Files:
  - `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`
  - existing or new `src/lib/notification-rules/api-paths.ts`
  - existing or new `src/lib/escalation-rules/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize notification/escalation rule paths.
- Risk:
  - Notification/escalation settings affect operations.
  - No delivery, escalation, permission, or audit behavior changes.
- Validation:
  - focused admin notification tests
  - helper tests
  - cheap gates
- Rollback:
  - Revert helper commit.

### 4. Admin Shifts Helper Split

- Files:
  - `src/app/(dashboard)/admin/shifts/shifts-content.tsx`
  - helpers for pharmacy sites, pharmacists, shifts, templates, holidays
  - related tests
- Expected effect:
  - Reduce raw path/header drift in scheduling admin UI.
- Risk:
  - Scheduling is operationally sensitive and date-boundary sensitive.
- Validation:
  - helper tests for query/date/path shape
  - focused shifts UI tests
  - `pnpm date-slices:check` if date logic is touched
  - cheap gates
- Rollback:
  - Revert per-helper commit.

### 5. Additive Count Metadata For Bounded Lists

- Candidate route families:
  - pharmacist shift templates
  - PCA pumps / rentals
  - UAT feedback
  - other bounded admin lists after inspection
- Expected effect:
  - Reduce false-empty and silent truncation.
- Risk:
  - Must be additive and backward-compatible.
  - Must not reveal PHI or alter filters.
- Validation:
  - route tests for total/visible/hidden/limit
  - UI tests if labels consume metadata
  - cheap gates
- Rollback:
  - Consumers should tolerate missing metadata; revert additive commit.

### 6. Patient/Report Share Helper Cleanup

- Files:
  - `src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx`
  - `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx`
  - communication/tasks API path helpers
  - related tests
- Expected effect:
  - Reduce duplicate communication request/task path construction.
- Risk:
  - Patient/report sharing is PHI and external-access sensitive.
- Validation:
  - privacy and medical safety review
  - helper path tests
  - component tests
  - no external-send semantic changes
  - cheap gates
- Rollback:
  - Revert helper commit.

### 7. Medication Cycle History Helper

- Files:
  - `src/components/features/workflow/cycle-transition-query.ts`
  - existing or new `src/lib/medication-cycles/api-paths.ts`
  - related tests
- Expected effect:
  - Centralize medication cycle history URL construction.
- Risk:
  - Medication workflow interpretation is safety-relevant.
- Validation:
  - medical safety review
  - helper tests for hostile IDs
  - workflow query tests
  - cheap gates
- Rollback:
  - Revert helper commit.

### 8. Large Module Pure Extraction

- Candidate modules:
  - `admin/drug-masters/drug-master-content.tsx`
  - schedule day/proposal components
  - prescription intake form
  - patient detail service modules
  - billing evidence core
  - daily job logic
- Expected effect:
  - Improve testability without changing JSX/hook order or server semantics.
- Risk:
  - Large modules are high-coupling and easy to break.
- Validation:
  - characterization test before movement
  - move only pure functions/types/constants
  - existing focused tests
  - cheap gates
- Rollback:
  - Revert extraction commit.

## First 10 Safe Candidates

1. Reports generate-from-visit path helper only.
2. Nav badge path helper only.
3. Admin notification settings path helper extraction only.
4. Admin capacity read fetch helper cleanup.
5. Admin realtime dashboard read fetch helper cleanup.
6. `/api/me/preferences` and `/api/me/sites` helper extraction only.
7. Admin shifts helper split A: pharmacy-sites/business-holidays read paths.
8. Interprofessional report share communication-request collection helper only.
9. Patient external share communication-request collection helper with privacy
   review.
10. Medication cycle history path helper with medical safety review.

## Validation Matrix

For every implementation slice:

- `git status --short --untracked-files=all`
- focused `rg` before/after
- focused Vitest for touched files
- `pnpm typecheck`
- `NODE_OPTIONS=--max-old-space-size=16384 pnpm typecheck:no-unused`
- `pnpm lint`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm format:check`
- `git diff --check`

Additional gates by impact:

- Date/schedule: `pnpm date-slices:check`, `pnpm test:schedule-time:tz`
- EventBridge/scheduled jobs: `pnpm eventbridge-schedules:check`
- DB/RLS/migration: proposal first, then `pnpm db:e2e:prepare` and migration
  precondition checks after approval
- UI visible behavior: focused component tests, browser/Playwright evidence
- Medical/PHI surfaces: medical safety and privacy review, targeted E2E where
  feasible
- Large boundary or completion audit: `pnpm test`, `pnpm build`, impacted E2E

## Rollback Plan

- Keep each unit in one small commit or PR.
- Avoid migrations in normal refactor slices.
- For helper extraction, rollback is reverting the helper commit.
- For additive metadata, consumers must tolerate old responses and rollback must
  not require DB changes.
- For docs-only changes, rollback is a docs revert.
- For P0 proposals, no runtime rollback is needed because no implementation
  occurs before approval.

## Commit / PR Split

Recommended PR 1:

- Phase 0 docs and first helper convergence.
- Commits:
  - `docs(refactor): add phase zero inventory and plan`
  - `refactor(reports): centralize generate-from-visit api path`
  - `refactor(nav): centralize nav badge api path`
  - `docs(progress): record helper convergence validation`

Recommended PR 2:

- Admin helper convergence.
- Commits:
  - `refactor(admin): centralize notification settings api paths`
  - `refactor(admin-shifts): centralize pharmacy site and holiday paths`
  - `docs(progress): record admin helper validation`

Recommended PR 3:

- Additive count metadata after route inspection.
- Commits:
  - `fix(api): add shift template count metadata`
  - `fix(api): add pca equipment count metadata`
  - `fix(ui): surface hidden list counts where available`
  - `docs(progress): record count metadata validation`

Recommended PR 4:

- Patient/report/share helper cleanup with specialist review.
- Commits:
  - `refactor(reports): centralize interprofessional share api paths`
  - `refactor(patients): centralize external share api paths`
  - `docs(progress): record share helper validation`

Proposal-only PRs:

- DB schema/RLS/auth/audit/external-send/billing/medication identity changes.
- Must include acceptance criteria, impact radius, rollback, data-flow review,
  privacy review, and approval record.

## Required Reviewer / Subagent Routing

- Default planning: `implementation_planner`, `spec_guardian`
- API contract: `api_contract_reviewer`
- Patient/report/medication/schedule: `medical_safety_reviewer`,
  `privacy_compliance_reviewer`, `data_integrity_auditor`
- UI: `frontend_reviewer`, `accessibility_ux_reviewer`, `ui_flow_tester`
  when visible behavior changes
- Security/tenant/auth-adjacent: `security_critic`, `threat_modeler`,
  `privacy_compliance_reviewer`
- Final proof: `verifier`

## Completion Notes

The broad objective is not complete just because a small slice is green.
Completion requires requirement-by-requirement proof across the original
objective. Until then, continue using this plan to select and close bounded
behavior-preserving slices.
