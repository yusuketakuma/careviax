# Performance Findings

Snapshot: 2026-07-02 02:10 JST

## Confirmed Improvements

No material runtime performance improvement is claimed for this artifact-sync
slice or the recent logger-convergence route slices.

## Recent Slice Impact

- Recent logger convergence removed small duplicated helpers and changed
  logging call shape/tests only. The latest dashboard slice also updated one
  route snapshot to match the current service href contract.
- Latest query-param helper slices, including medication-cycles and
  dispense-tasks, removed tiny duplicated parsing code only. They make no
  performance claim.
- Latest external-access rollback warning slice adds one logger warning only on
  a cleanup failure path and makes no performance claim.
- Latest patient MCS failure observability slice adds one logger warning only
  when failed-state persistence itself fails and changes fixed error text only;
  it makes no performance claim.
- Latest visit schedule proposal pharmacist enrichment warning slice adds one
  logger warning only when optional enrichment itself fails and makes no
  performance claim.
- Latest presence heartbeat client warning slice adds one throttled logger
  warning per entity type/status class when heartbeat delivery fails and makes
  no performance claim.
- Latest room-token client warning slice adds one throttled logger warning per
  entity type/failure-code/status class when room-token fetch or payload
  validation fails and makes no performance claim.
- These slices intentionally added no DB query, dependency, network call,
  polling, background job, external request, response DTO change, render work,
  sort behavior, cache behavior, or unbounded loop.
- Expected performance effect: negligible runtime effect; maintainability and
  privacy-boundary consistency are the primary benefit.

## Flagged Performance Candidates

Performance work remains proposal/evidence-driven. Do not change behavior or
add operationally significant infrastructure without explicit proof.

- DB indexes, migrations, RLS policy changes, and cache infrastructure are
  proposal-only.
- Potential N+1, over-fetching, and unbounded query candidates must be measured
  or proven with route/service tests before implementation.
- Browser/render performance work should use Playwright/browser evidence and
  screenshots when UI is touched.

## Verification Pattern For Future Perf Slices

- Capture before/after command or measurement.
- Preserve response shape, ordering, side effects, and auth behavior.
- Prefer algorithmic or structural simplification over speculative
  micro-optimization.
- Record the expected effect and actual verification in
  `ops/refactor/VERIFICATION.md`.

## 2026-07-03 A2 Live Scan (server N+1 / over-fetch / FE render sweep)

Scope: fresh read-only sweep for N+1 loops, over-fetch selects, in-request
duplicate queries, loop-body regex compiles, and FE heavy render chains, on
top of the 2026-07-02 snapshot above. Confirmed the already-fixed items
(W2-P1 prescription-intakes tx, W2-P4 drug-master cache, W0-9
optimizePackageImports, W0-10 findMany audit, W2-F2 pagination) are intact
and were not re-reported.

### New Candidates (non-P0, implementable)

1. **O(n²) preview-row → operation lookup in CSV bulk stock import**
   `src/app/api/pharmacy-drug-stocks/bulk/route.ts:541-551` builds
   `previewRowByDrugId` by doing `preview.rows.filter(...).map((row) => {
   const operation = operations.find((item) => item.row.rowNumber ===
   row.rowNumber) ...})` — a linear `.find()` per preview row, nested inside
   a `.map()` over the same-sized `operations` array. For a CSV import of N
   rows this is O(N²) instead of O(N). Fix: index `operations` once into a
   `Map<number, operation>` keyed by `row.rowNumber` before the `.map()`.
   Pure in-memory computation, no query/behavior/shape change.
   Verification: existing route has unit/integration tests for the bulk
   import path (`pnpm test` on the route's spec) — add or extend a synthetic
   N≈500-1000 row fixture and assert wall-clock/iteration-count drops, or
   assert identical output before/after the refactor with a smaller fixture
   plus a `console.time` before/after note in `VERIFICATION.md`.

2. **Per-line sequential writes in dispense-results submission**
   `src/app/api/dispense-results/route.ts:678-760`: inside the same `tx`,
   `lines.map(async (line) => { ...tx.dispensingDecision.upsert(...);
   ...tx.dispenseResult.create/update(...); })` wrapped in `Promise.all`.
   Because all calls share one Prisma transaction client, they still
   execute as sequential round-trips (no real concurrency gain from
   `Promise.all` on a `tx`), so an N-line dispense submission does roughly
   1-3 DB round trips per line. Cardinality is bounded by prescription line
   count (typically small, but multi-drug home-care prescriptions can run
   into the teens), so this is a real but moderate-impact candidate.
   Lower safety than #1 because it interacts with unique-constraint retry
   logic (lines 744-758) and per-line optimistic paths — any restructuring
   (e.g. batching the decision upserts, or a single `createMany` +
   `updateMany` pass with a fallback for conflicts) must preserve the
   existing race-handling semantics exactly.
   Verification: route already has integration tests around
   `dispense-results`; a query-count assertion (e.g. via a Prisma
   middleware/spy counting queries per request in a test) before/after would
   make the improvement measurable without touching schema or contract.

3. **Sequential per-stock upsert loop in stock site-copy**
   `src/app/api/pharmacy-drug-stocks/copy/route.ts:133-161`: `for (const
   stock of operations) { await tx.pharmacyDrugStock.upsert(...) }` inside a
   transaction — one audit log entry total (already batched correctly), but
   N sequential upserts for a full-site copy. Lower priority than #1/#2:
   each row can have distinct `reorder_point`/`preferred_generic_id`, so
   there is no trivial single-statement batch upsert available without a
   raw SQL `INSERT ... ON CONFLICT` rewrite (bigger blast radius). Recording
   as a candidate, not proposing the raw-SQL rewrite without measurement.

### P0/Flag Only (do not implement — record per instructions)

- `src/app/api/visit-billing-candidates/route.ts:325-350` — `for (const
  record of records) { await tx.pharmacyContractVersion.findFirst(...) }`
  is a genuine per-record N+1 inside a billing candidate generation
  transaction. **Billing domain (課金) → P0, record only, no proposal.**
- `src/app/api/set-audits/route.ts:961-1000` — per-cell OCC
  `tx.setBatch.updateMany` + `createSetBatchChangeLog` loop over
  `cell_audits`. Touches audit/change-log writes per row.
  **監査ログ → P0, record only.**
- `src/app/api/tracing-reports/[id]/route.ts:342-370` — per-linked-request
  OCC `updateMany` + `createAuditLogEntry` loop; low cardinality (usually
  1-2 linked requests) so low impact even if it were in scope.
  **監査ログ → P0, record only.**

### Checked, No New Finding (already clean)

- `src/app/api/visit-schedules/day-board/route.ts` and its
  `buildReadyBlockerSummaries` helper: joins are all pre-batched via
  `findMany({ in: [...] })` + `Map` lookups, fixed query count regardless of
  schedule count. No N+1 found on this pass.
- `src/server/services/drug-master-import/{ssk,hot,mhlw,pmda}.ts` and
  `src/lib/pharmacy/qr-intake-mapper.ts`: chunked batch lookups from W2/W3
  remain intact; no new nested-loop-over-large-list `.find()` patterns
  found in the large-dataset import/mapping paths.
- Loop-body regex compiles: `qr-lab-promotion.ts` patterns are module-scope
  consts (not rebuilt per call); `patient-mcs-ai.ts`
  `anonymizeForExternalAi` rebuilds one small `RegExp` per message inside a
  bounded per-summary loop — excluded as micro-optimization per the
  no-speculative-optimization rule, not reported as a candidate.
- FE: recent WIP diffs in `workflow-dashboard-view.tsx`,
  `drug-master-content.tsx`, `drug-master-detail-sheet.tsx`, and
  `clerk-support-content.tsx` (all 200-3500 lines) were swept for
  `.find()`/`.filter()`/`.sort()` chains; all operate over small
  fixed-size arrays (site lists, import-action definitions, formulary
  templates), not the patient/visit-scale lists. No FE render-time O(n²)
  or unbounded non-virtualized list found on this pass.
