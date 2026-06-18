# CODEX Goal Progress

Goal started: 2026-06-18 JST

Objective: Preserve existing CareViaX behavior while improving runtime speed, response performance, resource efficiency, exception tolerance, async safety, and stability until actionable candidates are exhausted and two consecutive Zero Candidate Audits pass.

## Session Constraints

- Active goal tool could not be replaced because a previous unfinished goal is still registered in the thread.
- Latest user instruction supersedes the earlier objective for this turn.
- Worktree started dirty with pre-existing refactor/validation changes from the interrupted previous turn. These changes are preserved and treated as baseline state for this performance/reliability goal.
- Vercel CLI is not installed; current task is not Vercel-specific.

## Loop 0 - Baseline

### Required Context Checked

- `AGENTS.md`
- `README.md`
- `package.json`
- `.github/workflows/ci.yml`
- `eslint.config.mjs`
- `vitest.config.ts`
- `tsconfig.json`
- `next.config.ts`
- `.codex/ralph-state.md`
- local Next.js 16 route handler and upgrade docs under `node_modules/next/dist/docs/`

### Initial Subagents

- Performance Agent: `019eda3c-c3fb-7520-8b9c-bbb28844b2fa`
- Reliability Agent: `019eda3c-e610-7693-9a52-83363217a4a0`
- Duplication Agent: `019eda3d-0804-7223-b12c-e2f2c7c158fe`
- Frontend Rendering Agent: `019eda3d-282e-71d3-ba04-d9236f1b2906`
- Backend/Data Agent: `019eda3d-4907-7783-941e-aaef06c860a4`
- Async Safety Agent: `019eda3d-6901-73a1-abeb-a9b8b24682ac`
- Test & Benchmark Agent: `019eda3d-8b64-7d93-99a8-9fa889229e82`

### Initial Existing Diff

Pre-existing dirty files at goal start include API validation/date/channel contract changes, PHOS domain error relocation, patient-status audit minimization, route-catalog metadata, and related tests from the interrupted previous turn. These are not reverted.

### Validation Commands Identified

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm date-slices:check`
- `pnpm eventbridge-schedules:check`
- `pnpm phos:deploy-template:validate:artifact`
- E2E and DB-gated checks exist but require local Postgres/server setup or longer browser runs.

### Baseline Results

- `pnpm format:check`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed with 976 files passed / 1 skipped and 7590 tests passed / 1 skipped.
- `pnpm build`: passed with Next.js 16.2.9 webpack build and 272 app routes.
- `perf:smoke`: script exists and is tested, but no local app server/authenticated target was running for a meaningful baseline beyond static inspection.

### Candidate Inventory

Initial subagent results received.

Short-term Actionable:

- Handoff board first GET can race on `org_id + shift_date` create.
- Google route optimization should degrade on non-OK upstream responses instead of surfacing 500.
- Offline evidence photo sync can create duplicate file assets/uploads if upload completion succeeds but visit-record patch fails.
- Report send UI should pass `Idempotency-Key` so existing server ledger is used.
- Typeahead/search inputs should debounce before React Query keys and network calls.
- `communication-events` route needs route-level channel contract tests.
- Date-key and PHOS error compatibility tests should pin broad shared contracts.

Mid-term Actionable:

- `billing-evidence/analytics`, `reject-reason-stats`, and staff/operations metrics should move raw-row aggregation toward DB-side aggregation.
- `staff-workload` should avoid fetching every open task when only top-N per staff is needed.
- `drug-masters` and `medication-cycles` should move offset cursors toward keyset cursors.
- PHOS handler domain-error conversion and Dynamo transaction executor duplication should be consolidated.

Long-term Actionable if still safe in-session:

- Common client action id/idempotency helper across report/visit/billing/dispense mutations.
- Performance smoke non-blocking CI/manual workflow wiring.
- Static guards for date-key regex and legacy PHOS backend imports.

### Blocked Items

- Production-like DB `EXPLAIN (ANALYZE, BUFFERS)` and latency/cardinality proof need live data or a seeded benchmark dataset.
- DDL/index additions need migration planning and explicit schema change review.
- External Google/SES/S3/IAM/quota failure drills need credentials and external service approval.
- Large patient-detail BFF redesign needs product/API/privacy decisions and browser waterfall evidence.
- Exact external email exactly-once semantics need provider/outbox design beyond local DB request ledgers.

### Next Loop Target

Loop 1-4 first pass: fix handoff-board create race, Google Routes non-OK degradation, offline evidence replay duplication, report-send idempotency header, and high-churn typeahead requests with focused tests.

## Loop 1 - Duplicate I/O and Request Stabilization, Pass 1

### Found Candidates

- `GET /api/handoff-board` performed find-then-create without race recovery.
- Report detail send UI did not pass the existing server `Idempotency-Key` contract.
- Typeahead inputs in prescription intake and drug-master operations generated query keys from raw input on every keystroke.

### Implemented

- Added a shared handoff board include object and reused `isPrismaUniqueConstraintError` so concurrent missing-board creates re-read the race winner instead of returning 500.
- Added `Idempotency-Key` headers for single and bulk care-report send mutations.
- Added `useDebouncedValue` and moved drug suggestion, prescription patient search, prescription prescriber-institution search, drug-master search, and formulary template search query keys to debounced values.

### Duplicate I/O Reduced

- Reduced rapid per-character patient, prescriber institution, drug-master, and formulary-template requests to the settled 250 ms search value.
- Removed duplicate local debounce logic from `DrugSuggest` by adopting the shared hook.

### Tests and Validation

- `pnpm exec vitest run src/components/features/pharmacy/drug-suggest.test.tsx 'src/app/(dashboard)/reports/[id]/page.test.tsx' src/lib/offline/evidence-drafts.test.ts`: passed, 3 files / 12 tests.
- `pnpm exec vitest run src/app/api/handoff-board/route.test.ts src/server/services/google-routes.test.ts src/lib/offline/evidence-drafts.test.ts src/components/features/pharmacy/drug-suggest.test.tsx 'src/app/(dashboard)/reports/[id]/page.test.tsx'`: passed, 5 files / 27 tests.
- `pnpm typecheck`: initially failed on unvalidated `fileAssetId` typing in offline evidence sync, then passed after explicit string validation.

## Loop 3 - Rendering Optimization, Pass 1

### Found Candidates

- Typeahead-backed React Query keys changed on each keystroke in multiple UI surfaces.

### Implemented

- Centralized debounce behavior in `src/lib/hooks/use-debounced-value.ts`.
- Kept visible input values immediate while delaying only query keys and network parameters.

### Duplicate Rendering / Recalculation Reduced

- Avoided creating distinct React Query subscriptions for each transient search character in prescription intake, drug suggestion, drug-master list, and template search.

### Tests and Validation

- `src/components/features/pharmacy/drug-suggest.test.tsx` continues to verify debounce timing through the shared hook.
- `pnpm typecheck`: passed after Loop 4 boundary fix.

## Loop 4 - Async Safety, Pass 1

### Found Candidates

- Google Routes non-timeout fetch failures and non-OK responses threw through route planning.
- Offline evidence sync could complete upload/asset creation and then fail visit-record attachment, causing retry to upload the same PHI payload again.

### Implemented

- Normalized Google Routes non-OK and fetch failures to `status: 'unavailable'` using existing `unavailableGoogleRoutePlan`.
- Persisted completed offline evidence `fileAssetId` and `uploadedVisitRecordId` before visit-record PATCH so retries resume attachment without re-uploading.
- Added explicit string validation for completed file asset ids before saving or attaching.

### Duplicate I/O / Side Effects Reduced

- Prevented repeated file upload and file-asset creation after upload completion but before attachment success.
- Converted upstream route-planning failures from exception paths into typed unavailable results.

### Tests and Validation

- Added `src/lib/offline/evidence-drafts.test.ts` for upload-resume and failed-attachment retry metadata.
- Added Google Routes tests for HTTP 429 and fetch failure degradation.
- Added handoff-board race recovery test.
- Added report send idempotency-header test.
- Targeted test set passed: 5 files / 27 tests.

### Blocked Items

- None for this pass.

### Next Loop Target

Loop 2/5/8 pass 1: inspect DB/API aggregation and error-handling consolidation candidates, prioritizing safe high-impact changes with focused tests.

---

# New Goal (2026-06-18 JST) — Maintainability Refactoring

Objective: Preserve existing CareViaX behavior while maximizing maintainability, readability, separation-of-concerns, type-safety, and testability. Loop until actionable candidates are exhausted and two consecutive Zero Candidate Audits pass. This supersedes the earlier performance objective for this turn; the prior performance work (Loops 0-4 above) and the pre-existing dirty worktree are preserved as baseline state.

Execution mode: ultracode (xhigh + Workflow orchestration). Main loop owns strategy/decision/integration/validation/report; read-only subagents own investigation/analysis/candidate extraction.

## Loop 0 (Maintainability) - Baseline

### Required Context Checked

- `AGENTS.md` (Ralph-loop rules, whole-repo scope, no-silence/no-weaken-types rules)
- `CLAUDE.md` (stack pinned 2026-03-25, UI/UX SSOT, RLS tenancy model)
- `package.json` scripts (validation commands)
- existing `CODEX_GOAL_PROGRESS.md` (prior performance goal state)

### Validation Commands Identified

- `pnpm lint` (eslint .)
- `pnpm typecheck` (next typegen && tsc --noEmit && tsc -p tsconfig.sw.json)
- `pnpm test` (vitest run)
- `pnpm build` (next build --webpack)
- `pnpm format:check`
- `pnpm date-slices:check`, `pnpm eventbridge-schedules:check`
- E2E / DB-gated checks require local Postgres (:5433) + running server — out of fast-loop scope.

### Repo Signals (audit input)

- Source file counts: app 1212, lib 397, server 317, components 240, phos 229, types 23.
- Largest non-test source files (refactor candidates): drug-master-content.tsx (4161), card-workspace.tsx (4053), schedule-proposals-content.tsx (3302), prescription-intake-form.tsx (2963), api/patients/[id]/route.ts (2729), server/jobs/daily.ts (2489), visit-record-form.tsx (2451), patient-form.tsx (2280), shifts-content.tsx (2255), billing-evidence/core.ts (2241), and ~16 more >1300 lines.

### Baseline Run

- Prior performance-goal baseline (same dirty worktree, earlier this session) recorded: lint/typecheck/test/build all passed.
- Re-confirm (task `b9wcup1sa`): `typecheck` exit 0, `test` exit 0, but `lint` exit 1 — one NEW pre-existing failure surfaced in the worktree.

### Baseline Fix (pre-existing failure, in-session actionable)

- `src/lib/hooks/use-debounced-value.ts:10` failed `react-hooks/set-state-in-effect` (synchronous `setState` inside the effect for the `delayMs<=0` branch). This file was added by the prior performance Loop 3; the failure was pre-existing, not introduced by this goal.
- Root-cause fix (no rule suppression, behavior preserved): the `delayMs<=0` branch now derives the live value during render (`return delayMs <= 0 ? value : debouncedValue`) instead of calling `setState` in the effect. All callers pass a positive constant delay, so the returned value is identical; the only removed behavior is the redundant cascading re-render.
- Added regression test `src/lib/hooks/use-debounced-value.test.ts` (4 cases: immediate initial value, debounce window timing, rapid-change coalescing, zero/negative-delay live passthrough).
- Re-validation: `pnpm exec eslint` on both files clean; `pnpm lint` full run exit 0; targeted vitest (hook + drug-suggest) 7/7 passed. Baseline now fully green (lint/typecheck/test).

### Initial Audit (read-only, parallel)

- Workflow `careviax-maintainability-audit` launched (task `wyzhr46my`, run `wf_5d2ad2d6-80e`).
- Dimensions: Architecture, Duplication, Type&Contract, Behavior&Test, DeadCode, Dependency → Synthesis (deduped, prioritized candidate inventory + recommended first batch).

### Status

- Awaiting audit synthesis + baseline re-confirm before deciding the first implementation batch (per "wait for all subagents before deciding" rule).

### Next Loop Target

- On audit return: lock candidate inventory, implement `recommendedFirstBatch` (behavior-preserving, test-backed), then re-audit. Do not stop until two consecutive Zero Candidate Audits.

## Audit Result (read-only, task `wyzhr46my`, 7 agents)

Synthesis produced 12 candidates (10 actionable, 2 blocked). recommendedFirstBatch = C01-C08. Full inventory saved to `/tmp/cvx-audit-plan.json` + `/tmp/cvx-audit-dimensions.json`. The synthesis correctly dropped the use-debounced-value finding (test now exists from Loop 0).

Actionable: C01 dead modules, C02 dead exports, C03 type-safety (Window aug + report-edit-form), C04 billing test pins, C05 tracker/claim test pins, C06 dup consolidation (status labels/yen/date/audit), C07 move visit-schedule-conflicts to lib + planner test pins, C08 db barrel normalization, C09 split daily.ts/billing core.ts, C10 extract oversized routes/component into existing services.
Blocked: C11 (diverged user-visible label strings — product/UX sign-off), C12 (repo-wide follow-ups: withAuthContext×112, apiFetch×447, optimistic-lock×43, lib→server inversions, phantom deps, FHIR adapter — each needs contract/product/install decision).

## Loop 7 (Maintainability) - Dead Code, Pass 1 [C01, C02]

### C01 — Deleted 7 whole dead modules (verified 0 importers via grep, full repo incl. tools/prisma)

- `src/lib/utils/session.ts`, `src/lib/api/query-keys.ts`, `src/lib/api/hooks.ts`, `src/lib/stores/patient-list-store.ts`, `src/lib/i18n/labels.ts`, `src/lib/push-subscription.ts`, `src/lib/auth/index.ts` (dead barrel, exact `@/lib/auth` specifier = 0 importers).
- Removed now-empty `src/lib/i18n/`.

### C02 — Removed dead exports from live modules (verified 0 external refs per symbol)

- `app-env.ts`: removed `isProduction/isStaging/isDevelopment/isDebug/perEnv`; de-exported `AppEnv` type (0 external refs, still used by `APP_ENV` annotation); kept `APP_ENV`. (Confirmed the 2 `isProduction` hits were a local const in a tools script, not this export.)
- `cloudwatch.ts`: removed `putCount`/`putLatency`; kept `putMetrics` + re-exported `StandardUnit`/`MetricDatum` (consumed by `performance.ts` + test).
- `encryption.ts`: removed `encryptIfPresent`/`decryptIfPresent`; kept `encrypt`/`decrypt`.
- `sensitive.ts`: removed `maskAddress`/`maskPersonName`; kept the live mask helpers.
- `use-media-query.ts`: removed `useIsTablet`/`useIsDesktop`; kept `useMediaQuery`/`useIsMobile` (mock-consumed).
- `jahis-qr.ts`: removed dead `decodeShiftJIS` and the unreachable `buildJahisQRText_placeholder_removed` stub.

### Validation

- `pnpm typecheck` (full: next typegen + tsc + tsc sw): exit 0.
- `pnpm exec eslint` on all 6 changed files: exit 0.
- `pnpm exec vitest run` cloudwatch + jahis-qr tests: 5/5 passed.

### Next Loop Target

- C03 type-safety (Window augmentation + report-edit-form union), then C04/C05 characterization tests (pin behavior before C09/C10 structural splits), then C06 dup consolidation, C07 file move, C08 db barrel.

## Loop 4 (Maintainability) - Type Safety, Pass 1 [C03]

### Implemented

- Added `src/types/phos-demo-hooks.d.ts` — ambient `interface Window` augmentation declaring the 6 dev/demo seed hooks (`__phosSeedPresenceDemo`, `__phosSeedEvidenceDemo`, `__phosSeedVisitModeDemo`, `__phosSeedVoiceMemoDemo`, `__phosSeedOfflineSyncDemo(mode?)`, `__phosSeedPeriodReviewDemo`).
- Replaced `const target = window as unknown as Record<string, unknown>` with `const target = window` at all 6 attach sites (collaboration, evidence-gallery, visit-record-form, voice-memo, offline-sync, prescription-intake-form). Behavior identical (same property set/deleted on window); names now type-checked.
- `report-edit-form.tsx`: retyped `pendingFields` state from `Record<string, unknown>` to `Partial<PhysicianFields & CareManagerFields>` (the two field shapes share only `self_management: string`, so the partial intersection is sound). Removed two `as unknown as Record<string, unknown>` onChange casts and the `pendingFields as PhysicianFields`/`as CareManagerFields` reads in `buildUpdatedContent`. All `f.x ?? base.x` accesses unchanged → byte-identical payload.

### Validation

- `pnpm typecheck`: exit 0.
- `pnpm exec eslint` on all 8 changed files: exit 0.
- `pnpm exec vitest run src/components/features/reports/`: 4 files / 6 tests passed (incl. report-edit-form.test.tsx).

### Next Loop Target

- C04 + C05 characterization tests via parallel workflow (5 disjoint test files), then C06/C07/C08.

## Loop 6 (Maintainability) - Test容易性, Pass 1 [C04, C05] — DONE (60 tests added)

- Parallel workflow `wtwb40t1y` (5 lanes, each edits only its own test file + verifies via `vitest run <file>`) — all 5 GREEN:
  1. NEW `billing-evidence/candidate-regeneration.test.ts` (status resolution + optimistic-lock persist branches).
  2. EXTEND `billing-evidence/core.test.ts` (workflow-state read/write round-trip, buildValidationLayers, japanMonthRangeForBillingMonth JST boundaries).
  3. EXTEND `billing-evidence/duplicate-interaction.test.ts` (generateHomeDuplicateInteractionCandidates orchestration).
  4. EXTEND `patient-status-tracker.test.ts` (NOTIFICATION_TRIGGERS matrix: business/high/normal/no-trigger/no-change).
  5. EXTEND `claimCandidateLifecycle.test.ts` (reason_code VALIDATION_ERROR + reason_note trim/omit).
- Results: candidate-regeneration +16, core +30, duplicate-interaction +6, patient-status-tracker +4, claimCandidateLifecycle +4 = 60 tests. Lanes correctly followed SOURCE over hypotheses (e.g. validation layers live nested under `source_snapshot.validation_layers`; `isRegenerationLocked` short-circuits reviewed records before any updateMany).
- Post-integration `pnpm typecheck` initially failed (exit 2): candidate-regeneration.test.ts `buildSnapshot` returned `Record<string, unknown>` (not assignable to `Prisma.JsonValue`). vitest had not caught it (no type pass). Fixed: typed `buildSnapshot(workflow: Prisma.JsonObject): Prisma.JsonObject` — no rule suppression, runtime unchanged (16/16 still green).
- LESSON: delegated test lanes verify via vitest only (no tsc), so the orchestrator MUST run full `pnpm typecheck` after integrating delegated tests.

## Loop 9 (Maintainability) - Validation gate after C01-C07 + C04/C05

- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0 (after the buildSnapshot fix).
- `pnpm test`: exit 0 — 980 files passed / 1 skipped, 7657 tests passed / 1 skipped (baseline was 7590; +67 from the 60 characterization tests + the Loop 0 use-debounced-value test + others).

## Loop 1/8 (Maintainability) - Structure/Boundary, Pass 1 [C07] — source done, validation pending

### Implemented (C07: client→server layer violation fix)

- `git mv src/server/services/visit-schedule-conflicts.ts → src/lib/schedules/visit-schedule-conflicts.ts`. The module is pure (only imports a type from `@/lib/validations/visit-schedule`, no prisma/db/server-only), and its sole importer is the client component `conflict-resolution-content.tsx`. Moving it to the leaf `lib/` layer removes the only client→server *value* import in the repo.
- Updated `conflict-resolution-content.tsx` import path + the doc comment to `@/lib/schedules/visit-schedule-conflicts`. No other importers existed.
- Deferred (Low/short): pinning extra schedule-day-planner pure builders in its existing test — to be picked up in a later test pass.

### Validation

- Confirmed green in the Loop 9 gate above (lint/typecheck/test all exit 0) — the moved module resolves at its new `@/lib/schedules` path and all consumers pass.

## Loop 2 (Maintainability) - Duplication, Pass 1 [C06]

### C06a — Status-label maps consolidated onto canonical `@/lib/constants/status-labels`

- `management-plan-panel.tsx`: deleted byte-identical inline `caseStatusLabel`; now `import { CASE_STATUS_LABELS as caseStatusLabel }`.
- `cases-tab.tsx`: deleted byte-identical inline `caseStatusLabel` AND `caseStatusVariant`; now alias-imports `CASE_STATUS_LABELS`/`CASE_STATUS_VARIANTS`. Call sites unchanged.
- Verified both inline maps were byte-identical to the canonical (6 keys, same Japanese strings/variants) before replacing — zero render change.

### C06b — Canonical yen formatter

- Created `src/lib/ui/currency-format.ts` exporting `formatYen(value, fallback = '—')`.
- 4 local formatters now delegate (logic centralized, fallback preserved per call site, call sites unchanged): `patient-home-operations.ts#formatCurrency` ('未記録'), `visit-record-form.tsx#formatVisitBillingAmount` ('未記録'), `pca-pumps-content.tsx#yen` ('—'), `pdf-documents.tsx#formatPdfCurrency` ('—').
- NOT migrated (intentional): `card-workspace.tsx:1866` (uses `collectedAmount ?` truthy + `Number()` coercion → differs from `== null` for 0) and `billing-candidates-content.tsx:565` (one branch of a nested ternary). Converging would change 0/empty handling or hurt readability — not byte-identical.

### C06c — Date formatter consolidated

- `patient-history-summary.tsx`: deleted local `formatDate` (`format(parseISO(value),'yyyy/MM/dd',{locale:ja})`), now `import { formatDateLabel as formatDate }`. Identical output for valid dates; more robust (no throw) on malformed input. Removed now-unused `date-fns`/`ja` imports.

### C06d — Raw auditLog.create → createAuditLogEntry (partial, deliberate)

- MIGRATED: `patient-status-tracker.ts:256` — its `db: DbClient = typeof prisma | Prisma.TransactionClient` satisfies the helper's `AuditLogWriter`. Byte-equivalent (helper adds `ip_address/user_agent: undefined` → Prisma omits; the lane-4 test uses `objectContaining` and still passes 6/6).
- INTENTIONAL NON-CONSOLIDATION: `export-audit.ts:36` (`db: AuditClient`) and `billing-evidence/core.ts:2216` (`tx: CloseBillingCandidatesTx`) use hand-rolled narrow DI/test-seam client types whose `auditLog.create` is NOT structurally assignable to `Prisma.TransactionClient['auditLog'].create`. Routing them through the Prisma-shaped `createAuditLogEntry` would require loosening the shared helper's contract (used by 84 sites) or casting — a type weakening not justified by this Low-priority shape dedup. Recorded per the "don't blur responsibility / don't weaken types" rule. Could be revisited if the helper is intentionally widened to a structural writer type.

### Validation

- `pnpm exec eslint` on all C06 changed files: exit 0.
- `pnpm typecheck`: exit 0 (run twice — after C06a/b/c and after C06d).
- `pnpm exec vitest run patient-status-tracker.test.ts`: 6/6 (audit assertions intact post-migration).

### Next Loop Target

- C08 (db barrel normalization: 13 `@/lib/db` consumers → `@/lib/db/client`/`@/lib/db/rls`, delete `src/lib/db/index.ts`), then C09 (split daily.ts + billing core.ts), then C10 (extract oversized routes/component).

## Loop 8 (Maintainability) - Dependency/Boundary, Pass 1 [C08]

### Implemented — single canonical Prisma entry point

- All 13 barrel consumers rewritten `import { prisma } from '@/lib/db'` → `from '@/lib/db/client'` (all 13 imported only `prisma`; none used `withOrgContext` via the barrel). Files: audit-logs/export route, dashboard/page, and 11 server/jobs + report-reminders.
- Deleted `src/lib/db/index.ts` (the dual entry point). `@/lib/db/client` (prisma, 303 callers) and `@/lib/db/rls` (withOrgContext, 186 callers) are now the sole canonical entries.
- DOWNSTREAM (not in the audit's "13 import lines" estimate): 10 test files did `vi.mock('@/lib/db', ...)`. With sources no longer importing the barrel, those mocks were dead. Updated all 10 to `vi.mock('@/lib/db/client', ...)` (each only mocked `prisma`, which `@/lib/db/client` exports; `getPrismaClient` has no external importers, so the `{ prisma }` factory is sufficient).

### Validation

- `pnpm typecheck`: exit 0.
- `pnpm exec vitest run` on the 10 affected job/audit test files: 10 files / 59 tests passed.
- Full-suite gate: see Loop 9 (Pass 2) below.

## Loop 9 (Maintainability) - Validation gate Pass 2 (after C06+C07+C08) + regression fix

- `pnpm lint`: exit 0. `pnpm typecheck`: exit 0.
- `pnpm test` (full): 1 failed initially — `src/__tests__/audit-log-conventions-static.test.ts` ("reviewed allowlist"). Root cause: C06d migrated patient-status-tracker's raw `auditLog.create` to `createAuditLogEntry`, so its file dropped out of the raw-audit-write allowlist (6→5). This is the intended improvement; synced the static allowlist by removing `patient-status-tracker.ts` (remaining raw writers: audit-entry.ts [the helper], security-events.ts, billing-evidence/core.ts, export-audit.ts, visit-brief.ts). Re-ran: 1/1 green.
- NOTE: the full-suite gate caught a regression that per-file validation missed (static convention test) — full `pnpm test` is required at each loop boundary, not just targeted tests.
- Net test count after fix: 7657 pass / 1 skip (1 prior failure resolved).

## Loop 1 (Maintainability) - Structure, Pass 2 [C09a] — daily.ts split DONE

- Split the 2489-line `src/server/jobs/daily.ts` god-module into `src/server/jobs/daily/` (cohesive domain modules: shared, prescriptions, pca-pumps, visits, followups, preparation, billing, conferences, reports, emergency, visit-support, compliance-expiry, patient-status, cleanup, orchestrator). `daily.ts` is now a thin barrel preserving the IDENTICAL public surface (31 symbols). Function bodies moved verbatim from `git HEAD` (no logic/signature/string change).
- Verified: `pnpm typecheck` exit 0; `pnpm exec vitest run daily.test.ts` 31/31; full pre-push gate (lint+typecheck+test) green — 980 files / 7657 tests pass, 1 skip.
- Note: a concurrent session was racing on the same split; the agent rebuilt `daily/` atomically from `git HEAD` and re-verified. Final state stable.

### Pre-push validation (for the commit requested by the user)

- `pnpm lint` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (7657 pass / 1 skip). Tree is green and safe to commit/push.

### Next Loop Target

- C09b (split `billing-evidence/core.ts` 2241 into siblings via barrel) + C10 (extract oversized route/component logic into existing services) remain — to continue after this commit/push. (`patients/[id]` route → patient-detail; `care-reports/[id]/send` → idempotency/delivery; `visit-preparations` → detail service; drug-master-content → hook). Both are larger structural moves backed by the C04/C05 characterization pins; to be executed with per-step typecheck + targeted tests.
