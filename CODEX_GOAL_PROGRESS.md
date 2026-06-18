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

## Loop 4 - Async Safety, Pass 2

### Found Candidates

- The shared realtime SSE stream invoked each event/status listener directly. A throwing consumer listener could abort dispatch for later listeners and push the shared stream toward reconnect/error handling even though the network stream itself was healthy.

### Implemented

- Wrapped event and status listener callbacks in `src/lib/realtime/shared-event-stream.ts` with exception isolation and centralized realtime listener logging.
- Covered event listener and status listener failures in `src/lib/realtime/shared-event-stream.test.ts`, including the non-reconnect expectation for a healthy shared stream.

### Stability Impact

- One broken subscriber can no longer stop other subscribers from receiving realtime events or status transitions for the same shared SSE connection.

### Tests and Validation

- `pnpm exec vitest run src/lib/realtime/shared-event-stream.test.ts`: passed, 1 file / 4 tests.

## Loop 6 - Cache and State Management, Pass 1

### Found Candidates

- `PresenceAvatars` duplicated the presence heartbeat effect even though `usePresenceHeartbeat` already owns the same POST/interval/cleanup responsibility.
- Re-scan found `useCollaborativeForm` still building the same best-effort `/api/presence` POST request shape for active-field updates.
- Re-scan found `VisitRecordForm` still owning direct `online`/`offline` event listeners even though `useNetworkOnline` is the existing shared browser network-state subscription hook.

### Implemented

- Replaced the local `PresenceAvatars` timer/ref/fetch effect with the existing `usePresenceHeartbeat` hook.
- Updated `src/components/features/collaboration/presence-avatars.test.tsx` to verify the shared heartbeat hook receives the correct entity and enabled state.
- Extracted `postPresenceUpdate` from `usePresenceHeartbeat` and migrated `useCollaborativeForm` active-field focus/blur updates to the shared sender.
- Added `src/lib/hooks/use-presence-heartbeat.test.ts` for shared request shape and best-effort network failure behavior.
- Replaced `VisitRecordForm`'s direct `window.addEventListener('online'/'offline')` effect with `useNetworkOnline` plus the existing offline-store `syncOnlineStatus` update.

### Duplicate State / Timer Logic Reduced

- Removed one local interval implementation and one duplicate best-effort presence POST path from the component layer.
- Removed the second hand-built presence POST request payload from collaborative form focus/blur handling while preserving immediate active-field updates.
- Removed one more component-owned browser online/offline listener pair from the visit-record form.

### Tests and Validation

- `pnpm exec vitest run src/components/features/collaboration/presence-avatars.test.tsx src/lib/hooks/use-collaborative-form.test.tsx`: passed, 2 files / 26 tests.
- `pnpm exec vitest run src/lib/hooks/use-presence-heartbeat.test.ts src/lib/hooks/use-collaborative-form.test.tsx src/components/features/collaboration/presence-avatars.test.tsx`: passed, 3 files / 28 tests.
- `pnpm exec vitest run 'src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx'`: passed, 1 file / 8 tests.
- Targeted ESLint over the presence hook/collaborative form/presence avatars files: passed.
- Targeted ESLint over the visit-record form/network hook files: passed.

## Loop 9 - Measurement and Validation, Pass 1

### Found Candidates

- Full `pnpm lint` and `pnpm format:check` picked up local/generated design-sync artifacts (`.ds-sync`, `.design-sync`, `ds-bundle`) even though they are not tracked source files.

### Implemented

- Added local/generated design-sync directories to ESLint global ignores.
- Added the same local/generated prefixes to `tools/scripts/check-format-changed-files.mjs` so format validation matches the repository source boundary.

### Validation Results

- Targeted ESLint over changed source/test files: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- Final `pnpm test`: passed, 981 files / 1 skipped and 7660 tests / 1 skipped.
- Final `pnpm build`: passed, Next.js 16.2.9 webpack build and 272 generated app routes.
- `git diff --check`: passed.

### Re-scan Result

- `/api/presence` POST request construction is now centralized in `postPresenceUpdate`; remaining hits are the shared helper and its callers/tests.
- Shared realtime SSE listener dispatch now catches per-listener exceptions for both event and status callbacks.
- No new tracked-source duplicate timer/request implementation was found in the current collaboration/realtime slice.

## Maintainability Re-audit - Collaboration/Realtime Slice

### Subagents

- Architecture Agent (`019edafa-6aea-7b21-ab32-6ba6e422504c`)
- Refactor/Duplication Agent (`019edafa-7416-7b00-b91e-021d1be854db`)
- Test & Behavior Agent (`019edafa-79fc-72a1-b280-4498cc83cc7f`)
- Strict Review Agent (`019edafa-80ba-7ca3-8f6a-21ebe6a1d48f`)

### Found Candidates

- `PresenceUser` was owned by the UI component `presence-avatars.tsx` while lib hooks imported it.
- Presence response parsing / query key / fetch logic was duplicated in presence avatars, collaborative form, and patient collaboration.
- Collaborator color hashing was duplicated in avatars, field lock indicators, and Yjs cursor overlay.
- `postPresenceUpdate` lived in a hook file despite being a presence API client helper.
- `.design-sync/**` was incorrectly excluded from lint/format checks even though `.design-sync` inputs are tracked source files.
- Realtime listener logging emitted raw `Error` objects.
- Missing regression tests for heartbeat timers, active-field focus/blur POST, visit-record network status sync, and shared presence parsing.

### Implemented

- Added `src/lib/collaboration/presence.ts` as the owner for `PresenceUser`, presence response parsing, query key/URL construction, fetch, POST, and collaborator color selection.
- Migrated `PresenceAvatars`, `useCollaborativeForm`, patient collaboration content/shared helpers, `FieldLockIndicator`, and `CursorOverlay` to the lib-owned presence contract.
- Removed UI-to-lib type dependency on `presence-avatars.tsx`.
- Sanitized realtime listener exception logging to `{ name, message }` instead of raw error object.
- Re-scoped `.design-sync` validation ignores to generated subpaths only and formatted tracked `.design-sync` inputs.
- Added `src/lib/collaboration/presence.test.ts` and expanded heartbeat/collaborative form/visit-record/realtime tests.

### Duplicate Implementations Reduced

- Presence user parsing and malformed-row filtering now has one implementation.
- Presence query key / URL / fetch construction now has one implementation.
- Presence POST request construction now has one implementation under `lib/collaboration`.
- Collaborator color hashing now has one implementation.
- `VisitRecordForm` remains on the shared network-state hook instead of owning online/offline listeners.

### Tests and Validation

- `pnpm exec vitest run src/lib/collaboration/presence.test.ts src/lib/hooks/use-presence-heartbeat.test.ts src/lib/hooks/use-collaborative-form.test.tsx src/components/features/collaboration/presence-avatars.test.tsx 'src/app/(dashboard)/patients/[id]/collaboration/collaboration-content.test.tsx' 'src/app/(dashboard)/patients/[id]/collaboration/collaboration.shared.test.ts' 'src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx' src/lib/realtime/shared-event-stream.test.ts`: passed, 8 files / 58 tests.
- Targeted ESLint over touched source/test/config files and `.design-sync/previews/Button.tsx`: passed.
- `pnpm exec prettier --check .design-sync/previews/Button.tsx .design-sync/config.json .design-sync/NOTES.md`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `pnpm test`: passed, 982 files / 1 skipped and 7668 tests / 1 skipped.
- `pnpm build`: passed, Next.js 16.2.9 webpack build and 272 generated app routes.

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

- `git mv src/server/services/visit-schedule-conflicts.ts → src/lib/schedules/visit-schedule-conflicts.ts`. The module is pure (only imports a type from `@/lib/validations/visit-schedule`, no prisma/db/server-only), and its sole importer is the client component `conflict-resolution-content.tsx`. Moving it to the leaf `lib/` layer removes the only client→server _value_ import in the repo.
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

## 20260618-2332 JST - Realtime/Presence Maintainability + Performance Loop

### Implemented

- Consolidated presence read policy into `usePresenceUsers`, backed by `presence-api-client` and pure `presence-contract`; migrated `PresenceAvatars`, `useCollaborativeForm`, and patient collaboration content away from duplicated query/SSE/fallback polling logic.
- Extracted `useRealtimeInvalidation` and simplified `useRealtimeQuery` to reuse it; migrated notifications, handoff board, admin realtime, and prescriptions infinite-query invalidation to the shared realtime invalidation contract where appropriate.
- Changed presence SSE handling from full `/api/presence` refetch on every `presence_update` to cache patching via `readPresenceUpdateEvent` + `mergePresenceUserUpdate`; disconnected/failure fallback polling remains.
- Debounced shared stream reconnects when presence target sets change in a burst, reducing org-wide SSE abort/reconnect churn from rapid presence mount/unmount.
- Fixed prescriptions workspace realtime event contract to invalidate on actual backend `workflow_refresh` broadcasts instead of the non-emitted `prescription_intake_created` event.
- Narrowed handoff realtime task invalidation from broad `['tasks']` prefix to `['tasks','handoff-confirmation',orgId]` while leaving explicit mutation refresh behavior unchanged.
- Split pure UI presence helpers/types (`presence-contract`) from transport helpers (`presence-api-client`); added static regression coverage so visual collaboration atoms do not import the API transport layer.

### Subagent Review Results Addressed

- Test Auditor High: denied collaboration token now has test coverage proving presence stream disabled, `presenceData` empty, no post-focus presence POST, and no extra presence GET after denial.
- Test Auditor Medium: added missing-org disabled coverage for prescriptions, notifications, admin realtime, and handoff.
- Test Auditor Medium: strengthened notifications/admin cache merge tests for duplicate handling, timestamp ordering, and caps.
- Performance Auditor Medium: removed N x M presence GET refetch behavior by patching cache from presence payloads.
- Performance Auditor Medium: batched presence target reconnect aborts.
- Performance Auditor Low: narrowed handoff realtime task invalidation.
- Strict Reviewer P1: fixed prescriptions realtime event mismatch.
- Strict Reviewer P3: separated pure presence contract from API transport.

### Validation So Far

- Focused realtime/presence suites passed after each slice, latest: 10 files / 70 tests passed.
- Targeted ESLint over touched realtime/presence/prescriptions files: exit 0.
- `pnpm typecheck`: exit 0.
- Final gates after subagent follow-ups: `pnpm format:check` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0; `pnpm date-slices:check` exit 0; `pnpm eventbridge-schedules:check` exit 0; `pnpm test` exit 0 with 985 files passed / 1 skipped and 7689 tests passed / 1 skipped; `pnpm build` exit 0 for 272 app routes; `git diff --check` exit 0.

### Rescan Result

- `rg` rescan found direct `useRealtimeEvents` only inside `use-realtime-invalidation`; presence fetch/query helpers only inside `presence-api-client` and `usePresenceUsers`; visual collaboration atoms now import only `presence-contract`.
- Remaining actionable candidates move outside this slice: larger `useCollaborativeForm` CRDT/provider decomposition and offline draft hook commonality need separate characterization before structural changes.

## 20260618-2343 JST - Collaborative Form Responsibility Split

### Implemented

- Extracted room-token client contract into `src/lib/collaboration/room-token-client.ts`:
  - token response parser
  - Retry-After parser
  - bounded retry delay calculation
  - `/api/collaboration/room-token` fetch classifier (`ok`, `access-denied`, `transient-error`)
- Added `src/lib/collaboration/room-token-client.test.ts` for malformed payloads, Retry-After seconds/date parsing, capped backoff, success request shape, denied responses, transient 429, malformed JSON, and expired tokens.
- Extracted Yjs provider/document/awareness lifecycle from `useCollaborativeForm` into `src/lib/hooks/use-yjs-collaboration-room.ts`.
- Reduced `useCollaborativeForm.ts` to the integration responsibilities it owns: presence data access, access-denied state, active-field presence posting, and `registerCollaborative` wiring.

### Validation

- Focused `pnpm exec vitest run src/lib/collaboration/room-token-client.test.ts src/lib/hooks/use-collaborative-form.test.tsx`: exit 0, 2 files / 30 tests passed.
- Targeted ESLint over `room-token-client`, `use-yjs-collaboration-room`, `use-collaborative-form`, and related tests: exit 0.
- `pnpm typecheck`: exit 0.
- `wc -l`: `use-collaborative-form.ts` now 140 lines; extracted `use-yjs-collaboration-room.ts` 373 lines and `room-token-client.ts` 119 lines.

### Final Validation

- `pnpm format:check`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm date-slices:check`: exit 0.
- `pnpm eventbridge-schedules:check`: exit 0.
- `pnpm test`: exit 0, 986 files passed / 1 skipped and 7694 tests passed / 1 skipped.
- `pnpm build`: exit 0, 272 app routes generated.
- `git diff --check`: exit 0.

### Rescan Result

- `rg` rescan shows room-token parsing/fetch/backoff now lives in `room-token-client`; `useCollaborativeForm` no longer owns direct provider creation and delegates Yjs provider/document/renewal lifecycle to `useYjsCollaborationRoom`.
- No direct realtime/presence duplicate implementation resurfaced in the touched collaboration paths.
- Next highest-value executable candidate remains offline draft hook commonality; it needs characterization before any extraction to avoid merging distinct offline persistence semantics.

## 20260619-0004 JST - Offline Draft/Sync Performance + Reliability Loop

### Subagent Findings Integrated

- Refactor Agent: identified duplicated encrypted draft load/save/clear shape, duplicated legacy SOAP plaintext purge, autosave lifecycle commonality, and online sync listener duplication.
- Performance Agent: prioritized the hot-path issue where visit record form polling called full `refreshSyncState()`, forcing sync queue detail decryption/JSON parsing every 5 seconds.
- Concurrency Agent: identified stale queue success deleting newer visit drafts and non-atomic draft upsert patterns.
- Test Agent: identified missing direct voice memo storage tests, missing v8 offline DB migration coverage, and missing prescription/SOAP draft scope/update/clear tests.

### Implemented

- Split offline store refresh into lightweight `refreshSyncCount()` and detailed `refreshSyncState()`; migrated visit record form's 5-second polling to count-only refresh while leaving `/offline-sync` on detailed refresh.
- Added `offline-store` tests proving count-only refresh does not call `listSyncQueueItems()` and therefore avoids queue payload decrypt/parse work.
- Guarded sync queue success cleanup with a current-item check; if a queue row was changed or replaced while an older POST was in flight, the old success no longer deletes the refreshed queue item or scoped visit draft.
- Wrapped SOAP and prescription draft save upsert paths in Dexie transactions without changing snapshot or scope semantics.
- Consolidated duplicated legacy plaintext SOAP field purge into `src/lib/offline/soap-draft-legacy.ts`, reused by both DB migration and SOAP draft save updates.
- Changed evidence draft summary/sync candidate reads to use the new `retryCount` index path, avoiding unindexed all-table scans for retry-limited sync work.
- Added Dexie v9 schema to index evidence draft `retryCount`; v8 data is preserved through migration.
- Limited `/offline-sync` patient-name resolution to schedule IDs present in the current pending queue instead of decrypting every `visitBriefCache` row, and added error handling for initial refresh failures.
- Added direct storage tests for voice memo drafts and expanded offline DB migration/draft hook regression tests.

### Validation

- `pnpm exec vitest run src/lib/stores/offline-store.test.ts src/lib/stores/sync-engine.test.ts src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx src/lib/offline/voice-memo-drafts.test.ts src/lib/stores/offline-db.test.ts src/app/(dashboard)/offline-sync/offline-sync.shared.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx`: exit 0, 8 files / 54 tests passed before evidence index follow-up.
- `pnpm exec vitest run src/lib/offline/evidence-drafts.test.ts src/lib/offline/evidence-drafts.shared.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/stores/sync-engine.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx`: exit 0, 8 files / 47 tests passed after evidence index follow-up.
- Targeted ESLint over touched offline sync/draft files: exit 0.
- `pnpm typecheck`: exit 0.

### Rescan Result

- `refreshSyncCount()` is now used by visit record polling; detailed `refreshSyncState()` remains for `/offline-sync` and post-mutation refreshes.
- Legacy SOAP plaintext purge has a single implementation.
- Evidence draft sync now uses `retryCount` index; boolean `synced` index was avoided after focused test exposed IndexedDB `DataError` for boolean key range usage.
- Remaining actionable candidates: sync queue claim/lease for cross-tab replay, PHOS queue dedupe races, autosave hash-skip/common timer hook, and additional evidence sync failure/retry tests. Blocked/deferred: voice memo server sync/STT and full dashboard/PHOS queue engine unification require product/external-service design decisions.

## 20260619-0123 JST - Offline Sync Post-Review Hardening + Full Gate

### Post-Review Findings Addressed

- Strict Review High: production imports of new SOAP legacy purge helper and new offline tests are now represented in the working tree and included in validation scope; no clean-checkout missing-module issue remains as long as these new files are included with the change set.
- Strict Review High/Medium: `deleteSyncedQueueItem()` is now a transaction-scoped compare-and-delete operation. It compares payload/scope/entity/createdAt plus `retryCount`, `lastError`, `conflict_state`, and `conflict_payload`, and returns `deleted`, `missing`, or `stale` instead of silently no-oping.
- Test Auditor High: normal sync and conflict overwrite paths now both verify stale queue rows are not deleted and stale overwrite is reported as a failure message instead of success.
- Strict Review Low: Dexie v9 evidence migration now normalizes malformed legacy evidence rows with missing/non-finite `retryCount` to `0` and missing/non-boolean `synced` to `false`, preserving uploaded file metadata.
- Test Auditor Medium/Low: added count-refresh timestamp/failure immutability coverage, retry-index filtering coverage, and a fake-indexeddb voice memo transaction rollback test.

### Implemented

- Changed sync completion cleanup to run inside `offlineDb.transaction('rw', syncQueue, visitDrafts, ...)`.
- Changed `processSyncQueue()` so stale successful responses are not counted as synced.
- Changed `overwriteVisitRecordConflict()` so stale completion returns `{ ok: false }` with a refresh/retry message.
- Added `readDateTime()` to make completion identity tolerant of Date/string/number stored timestamps without weakening type contracts.
- Added v9 Dexie `.upgrade()` normalization for evidence draft retry/synced fields.
- Added `voice-memo-drafts.integration.test.ts` to prove old voice memo drafts survive replacement add failure.

### Validation

- Focused post-review tests: `pnpm exec vitest run src/lib/stores/sync-engine.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/offline/evidence-drafts.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/offline/voice-memo-drafts.integration.test.ts --reporter=dot --testTimeout=30000` passed with 6 files / 32 tests.
- Broader offline target tests: `pnpm exec vitest run src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx src/app/(dashboard)/offline-sync/offline-sync.shared.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx src/lib/stores/sync-engine.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/offline/evidence-drafts.test.ts src/lib/offline/evidence-drafts.shared.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/offline/voice-memo-drafts.integration.test.ts --reporter=dot --testTimeout=30000` passed with 11 files / 73 tests.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed with 989 files passed / 1 skipped and 7719 tests passed / 1 skipped.
- `pnpm build`: passed, 272 app routes generated.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.
- `git diff --check`: passed.

### Rescan Result

- `rg` confirms visit-record polling uses `refreshSyncCount()` while detailed queue decryption remains scoped to `/offline-sync` and explicit post-mutation refreshes.
- `rg` confirms evidence summary/sync candidate reads use the `retryCount` index path and no boolean `synced` index query remains.
- `rg` confirms SOAP legacy plaintext purge has one implementation in `src/lib/offline/soap-draft-legacy.ts`.
- Post-review actionable items in the current offline slice are implemented and validated. A fresh read-only performance/reliability subagent (`019edb8b-32f8-7520-8357-8b1a870c6585`) is running to identify any remaining actionable candidate before the next loop.

### Remaining Candidates

- Actionable candidates still under consideration for the next loop: durable cross-tab sync queue lease/claim, PHOS offline action/evidence dedupe races, autosave hash-skip/common timer hook, and deeper evidence upload partial-complete recovery tests.
- Blocked/deferred: voice memo server sync/STT requires external STT/product/PHI retention decisions; full PHOS/dashboard queue engine unification requires broader product/runtime contract decisions.

## 20260619-0140 JST - Offline Sync Short Follow-Up Loop

### Re-Audit Findings Addressed

- Performance re-audit High: `syncConfigKey()` now builds its active-run key from canonical default-merged endpoints, so `{ endpoints: {} }` and `{ visit_record: '/api/visit-records' }` share the same single-flight run.
- Performance re-audit High: sync queue rows are now checked again before POST/overwrite. If the row changed or disappeared after the initial queue read, the stale request is not sent.
- Performance re-audit Medium: visit record polling now catches `refreshSyncCount()` failures and logs one warning instead of producing repeated unhandled rejections every 5 seconds.
- Performance re-audit Medium: visit record evidence badge now calls `listEvidenceDraftSummariesForSchedule(id)`, using the `scheduleId` index instead of reading all unsynced evidence summaries for one visit.

### Implemented

- Added `resolveSyncEndpoints(config)` and reused it for both `syncConfigKey()` and processing.
- Added `verifyQueueItemCurrent()` and used it before normal sync POST and conflict overwrite POST.
- Added schedule-scoped evidence summary helper while preserving the existing all-summary helper for screens that need all drafts.
- Added visit-record form regression tests for schedule-scoped evidence summary and safe sync-count refresh failure handling.
- Added sync-engine regression coverage proving implicit and explicit default endpoint configs coalesce to one fetch.

### Validation

- Focused tests: `pnpm exec vitest run src/lib/stores/sync-engine.test.ts src/lib/offline/evidence-drafts.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx --reporter=dot --testTimeout=30000` passed with 3 files / 30 tests.
- Broader offline target tests: `pnpm exec vitest run src/lib/hooks/use-prescription-draft.test.tsx src/lib/hooks/use-soap-draft.test.tsx src/app/(dashboard)/offline-sync/offline-sync.shared.test.ts src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx src/lib/stores/sync-engine.test.ts src/lib/stores/offline-db.test.ts src/lib/stores/offline-store.test.ts src/lib/offline/evidence-drafts.test.ts src/lib/offline/evidence-drafts.shared.test.ts src/lib/offline/voice-memo-drafts.test.ts src/lib/offline/voice-memo-drafts.integration.test.ts --reporter=dot --testTimeout=30000` passed with 11 files / 76 tests.
- `pnpm typecheck`: passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.
- `pnpm test`: passed with 989 files passed / 1 skipped and 7722 tests passed / 1 skipped.
- `pnpm build`: passed, 272 app routes generated.
- `pnpm date-slices:check`: passed.
- `pnpm eventbridge-schedules:check`: passed.

### Remaining Candidates

- Actionable but larger next-loop items: durable cross-tab sync/evidence leases, queue/server idempotency key contract, singleton draft duplicate collapse migration, skipped evidence backoff, and autosave hash-skip/common timer hook.
- Blocked/deferred: voice memo server sync/STT and full PHOS/dashboard queue engine unification require product/external-service/runtime decisions.
