# BACKEND REVIEW — F-20260624-002 patient-timeline backend hardening

- maker: codex
- reviewer: claude (read-only audit; no source edited)
- scope: patient timeline service hardening (H1/H2/M2/M3/L2) + additive indexes
- vitest: `Test Files 4 passed (4) | Tests 106 passed (106)` (1.80s) — files: detail-slices.test.ts, patient-detail.test.ts, patient-detail-tasks.test.ts, patient-detail-timeline-query.test.ts

## VERDICT: 🔴 CHANGES_REQUESTED

All behavioral guarantees are correctly implemented and proven by non-vacuous tests, and the
source-code partition is clean. **However there is a Prisma schema ↔ migration drift defect
(must-fix):** the new FirstVisitDocument index was declared on the WRONG model. Tests pass because
they do not assert index placement, but this will cause migration-integrity failure and silently
strip the H1 performance index from the table that needs it.

---

## Checklist

### 1. H2 event-loss guard — ✅ PASS

- `patient-detail-timeline-query.ts` unmodified (`git diff HEAD --stat` empty). No `patient_id` predicate added.
- `patient-detail-timeline-query.test.ts:46-83`: asserts `filters[0]` (Patient target) and `filters[1]` (export) have NO `patient_id` property (`.not.toHaveProperty('patient_id')`).
- `patient-detail.test.ts` "bounds first-visit document timeline reads and keeps legacy audit filters visible": constructs an AuditLog row with `target_type:'medication_history'`, `target_id:'patient_1'` and **no `patient_id` field**, then asserts `result.timeline_events` contains `operation_history:audit_legacy_export` AND `JSON.stringify(query).not.toContain('patient_id')`. Non-vacuous — proves a legacy row without patient_id still surfaces.

### 2. M2 settled-helper / fail-soft — ✅ PASS

- `patient-detail-tasks.ts:43-92` `runPatientDetailTasksSettled`: per-task try/catch → pushes `{key,error}` to `failures`, calls `onTaskError`, assigns `results[key]=fallbacks[key]`. Never throws.
- `patient-detail.ts:799-836`: timelineTasks wrapped with safe-empty `timelineFallbacks`; `partial_failures` added additively (`:928-933`, spread only when length>0).
- **Fail-fast preserved**: patient lookup `:448-460` (`if (!patient) return null`) and `listPatientBillingCaseRefs` `:464-466` are awaited OUTSIDE the settled helper → a throw there still propagates.
- `runPatientDetailTasks` (fail-fast) still used by overview path at `:187`. Settled used only by timeline.
- Tests: `patient-detail.test.ts` "renders available timeline sources when one source query fails" (communicationEvent rejects → `visit_schedule:schedule_1` still renders + `partial_failures:[{source:'communicationEvents',...}]`); `patient-detail-tasks.test.ts` adds a fail-fast assertion for the default helper + a settled-helper fallback/onTaskError assertion.

### 3. Log redaction (PHI/compliance) — ✅ PASS (stricter than spec)

- `patient-detail.ts:124-129` `describePatientTimelineTaskError` returns `error.name` ONLY (or `'Unknown error'`) — not even the message body.
- `:131-137` logs `{ orgId, source: failure.key, error: <name> }`. No patient data, no request body, no raw error object, no error message interpolation.
- Client-facing message `:144` is a static Japanese string, no interpolation.
- Test asserts `console.error('[patient-timeline] source query failed', {orgId:'org_1', source:'communicationEvents', error:'Error'})`. No PHI leak path found.

### 4. M3 JST correctness — ✅ PASS

- `patient-detail-timeline-events.ts:244-249` `Intl.DateTimeFormat('ja-JP-u-ca-gregory', { timeZone:'Asia/Tokyo', ... })`; bare `date-fns format()` removed (import dropped).
- `formatTimelineDate` `:260-265` and `formatTokyoMonthStart` `:268-271` both use Tokyo parts; `billing_month` href uses `formatTokyoMonthStart` `:974`.
- Test asserts JST-evening boundary: `scheduled_date 2026-04-10T15:30:00Z` → `訪問日 2026/04/11` (UTC would be 04/10); `billing_month 2026-03-31T15:00:00Z` → `算定月 2026/04/01` + `href ...billing_month=2026-04-01` (UTC would be 03). Proves Tokyo day, not UTC day.

### 4b. H1 first-visit take:8 — ✅ PASS (runtime), see Finding-1 for index

- `patient-detail.ts:745` `take: 8`; `where`/`orderBy:[{created_at:'desc'}]`/`select` otherwise preserved. Test asserts `take:8`.

### 5. L2 stable sort — ✅ PASS

- `patient-detail-timeline-events.ts:1104-1107` tie-break `|| right.id.localeCompare(left.id)`.
- Test "uses a deterministic id tiebreaker for same-timestamp events": two cross-/same-source comm events with identical `occurred_at` → deterministic `['communication:comm_b','communication:comm_a']`.

### 6. Scope creep / partition — ⚠️ CONCERN (product source clean; non-source artifacts present)

- Product source partition CLEAN: only the 8 listed files + migration changed. `route.ts` NOT modified, no `withOrgContext` wrap (M1 correctly deferred), no FE/dashboard/other-service edits, `timeline-query.ts` untouched. No speculative features.
- BUT working tree also shows `.agent-loop/STATE.md` (modified) and `projects/` (untracked) — loop-orchestration artifacts, unrelated §24 content. Not a product-code violation, but **they MUST NOT be staged with the F-002 commit** (`git add` only the listed F-002 paths).

### 7. partial_failures contract — ✅ PASS

- Additive only (spread when non-empty). `detail-slices.test.ts:337-364` confirms route passes the field through unchanged. Existing consumers unaffected.

### 8. Test adequacy overall — ⚠️ Strong, one gap

- Every behavioral guarantee (H1 take, H2 no-patient_id, M2 fail-soft+partial_failures+redacted log, M3 JST, L2 tiebreak) has a real, specific assertion. None vacuous/over-mocked.
- Gap: NO test/check asserts the new FirstVisitDocument index placement or guards Prisma schema drift — which is exactly why Finding-1 slipped through green gates.

---

## MUST-FIX

### Finding-1 (HIGH, migration integrity) — index declared on the WRONG model

`prisma/schema/medication.prisma:57` adds
`@@index([org_id, patient_id, created_at(sort: Desc)], map: "FirstVisitDocument_org_patient_created_idx")`
to model **`MedicationProfile`** (model at line 39, table `MedicationProfile`).

But:

- the migration `20260624063000_.../migration.sql` creates that index on table **`"FirstVisitDocument"`**, and
- the timeline code that needs it queries `db.firstVisitDocument.findMany({ where:{org_id,patient_id,case_id}, orderBy:[{created_at:'desc'}], take:8 })` — i.e. the **`FirstVisitDocument`** model (line 151), which currently has only `@@index([org_id])` and `@@index([patient_id])`.

Consequences:

1. **Schema↔DB drift.** Schema says the index lives on `MedicationProfile`; DB (post-migration) has it on `FirstVisitDocument`. `prisma migrate diff` / next `migrate dev` will want to DROP it from `FirstVisitDocument` and CREATE it on `MedicationProfile` — silently removing the H1 performance index from the very table the timeline query scans, defeating H1, and adding a non-matching index to `MedicationProfile`.
2. Tests stayed green because none assert index placement.

**Required change:** move the `@@index([org_id, patient_id, created_at(sort: Desc)], map: "FirstVisitDocument_org_patient_created_idx")` line from the `MedicationProfile` model (delete line 57) to the `FirstVisitDocument` model (add after its existing `@@index([patient_id])` at ~line 164). `MedicationProfile` keeps only its existing two indexes. The migration.sql is already correct and needs no change; after the schema move, `prisma migrate diff`/`prisma validate` should report no drift.

## CONCERNS (advisory, not blocking)

### Finding-2 (MED, prod migration lock) — non-CONCURRENT CREATE INDEX on AuditLog

`AuditLog` is a high-write ISMAP audit table that can grow large. `CREATE INDEX` (non-CONCURRENTLY, the Prisma default, run in a transaction) takes a lock that blocks writes to `AuditLog` for the full build duration. Recommend a production runbook note (or a separate `CONCURRENTLY` step outside the migration transaction) before applying to prod. Logically additive (2 CREATE INDEX, no DROP) — confirmed.

### Finding-3 (LOW) — H1 take:8 may truncate first-visit docs

`take:8` on first-visit documents bounds reads (intended). Overall timeline already `.slice(0,40)`, so acceptable; just noting older first-visit docs beyond the newest 8 won't appear — confirm this matches the F-002 spec intent.

---

## Required action for the lane (codex)

1. **(must-fix)** Move the FirstVisitDocument composite index from `MedicationProfile` to `FirstVisitDocument` in `medication.prisma`; re-run `pnpm prisma validate` / `prisma migrate diff` to confirm zero drift. Add/extend a test or schema-drift assertion if cheap.
2. Stage only the F-002 source paths at commit (exclude `.agent-loop/STATE.md`, `projects/`).
3. (advisory) Document the AuditLog index build as a CONCURRENT/maintenance-window step for prod.

Re-review required after Finding-1 fix.
