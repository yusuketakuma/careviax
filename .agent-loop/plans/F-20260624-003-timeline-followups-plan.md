All references confirmed. The `withOrgContext` signature, the conditional-spread return shape, the `.slice(0,40)` sort, and the `satisfies`-pinned fallbacks all match the maps. Here is the merged plan.

---

# PLAN_REVIEW_REQUEST — Patient Timeline: Adapter Registry + Cursor Pagination + RLS-on-Read

**Scope:** `getPatientTimelineData` (`src/server/services/patient-detail.ts:447-933`) and its projection/route/FE consumers. Three independent maker/checker cycles (A, B, C), each green at every commit, each verified by Codex against the same 94-case oracle (`patient-detail.test.ts`, `patient-detail-tasks.test.ts`, `patient-detail-timeline-query.test.ts`, `detail-slices.test.ts`).

**Maker/checker:** Claude implements each cycle; Codex reviews via PATCH_REVIEW_REQUEST; final verdict is the objective gate (`pnpm lint && typecheck && typecheck:no-unused && format:check && test && build`). No self-completion.

---

## 1. SEQUENCE — A → B → C (and why)

**A (source-adapter registry) first — behavior-preserving refactor, zero contract/security change.**
It is the highest blast-radius edit (touches all 13 source thunks + projection + types) but the lowest _semantic_ risk: every `where/orderBy/select/take` and every projection string is **relocated, not rewritten**, so the 94-case oracle is a byte-for-byte regression net. Landing it first gives B and C a single clean descriptor per source to extend, instead of forcing each to thread changes through 5 hand-parallel sites. Doing A last would mean re-doing B's per-source floor wiring and C's per-source `scoped()` wrap inside a registry afterward — wasted work.

**B (cursor pagination) second — additive contract, depends on A's clean per-source seam.**
B adds an optional `{cursor, limit}` request param and a conditionally-spread `next_cursor` response key (additive, like `partial_failures`). It needs the per-source `fetch` seam from A to inject the Group-A `lte` floor + over-fetch `take` cleanly. It must land before C because C wraps each `fetch` in a transaction — and B changes what those `fetch` bodies contain (the floor predicate + bumped take). Sequencing B before C means C wraps a _stable, final_ fetch body.

**C (timeout-safe RLS-on-read) last — security, must wrap the final fetch shape.**
C is the only cycle that changes the execution model (`db.x` → `scoped(tx => tx.x)`), touches `src/lib/db/rls.ts`, and carries tenant-isolation risk. It must wrap fetch bodies _after_ A normalized them and B finalized their floor/take, so the wrap is mechanical (`db` → `tx`, nothing else). Landing security last also means the objective gate runs against the most-tested surface. **C does not depend on B's correctness**, only on the fetch-body shape being final — so if B is deferred, C can still proceed against A's output.

> The orchestrator may run A→C→B if pagination slips, since C only requires A. The recommended order keeps the security cycle wrapping a frozen fetch body.

---

## 2. CYCLE A — Source-Adapter Registry (behavior-preserving)

### Files touched

- **NEW** `/Users/yusuke/workspace/careviax/src/server/services/patient-detail-timeline-registry.ts` — interface, `defineTimelineSource`, `EMPTY`, the two ctx types, the `TimelineHrefBundle` builder.
- **MODIFIED** `/Users/yusuke/workspace/careviax/src/server/services/patient-detail.ts` — replace `timelineTasks`/`timelineFallbacks` literals + actor-ID array + `buildPatientTimelineEvents` call with registry-driven driver. Leave `runPatientDetailTasksSettled` call, op_history block, the two `batchResolveNames` + merge, return shape verbatim.
- **MODIFIED** `/Users/yusuke/workspace/careviax/src/server/services/patient-detail-timeline-events.ts` — move each per-source projection block into the matching adapter's `toEvents`; extract `buildOperationHistoryEvents`; extract `buildTimelineHrefBundle`; keep all label maps and helpers.
- **UNTOUCHED:** `patient-detail-tasks.ts`, `patient-detail-scope.ts`, `patient-detail-timeline-query.ts`, `name-resolver.ts`, all four test files.

### New types/interfaces (final form in §3)

`TimelineFetchCtx`, `TimelineProjectCtx`, `SourceAdapter<Key,Row>`, `defineTimelineSource`, plus driver-side derived types:

```ts
type Entry<R> = R extends SourceAdapter<infer K, infer Row> ? { key: K; row: Row } : never;
type E = Entry<(typeof TIMELINE_SOURCES)[number]>;
type TimelineTasks = { [X in E as X['key']]: () => Promise<readonly X['row'][]> };
type TimelineFallbacks = { [X in E as X['key']]: readonly X['row'][] };
```

This _centrally_ recovers the `satisfies` guarantee that today lives at `patient-detail.ts:816-818`.

### Precise changes

1. Add the registry file with 13 `defineTimelineSource(...)` descriptors (`visitSchedules … billingCandidates`), each carrying `key`, `fetch` (verbatim thunk body incl. `caseIds.length===0` short-circuit + `take` + `select` + `org_id`), `emptyFallback: EMPTY`, `toEvents` (verbatim projection block returning `TimelineEvent[]`), and optional `collectActorIds`.
2. In `patient-detail.ts`, build `TIMELINE_SOURCES` array (order = today's literal order — laundered by `.sort()`), reconstruct `timelineTasks`/`timelineFallbacks` via `Object.fromEntries`, drive actor-ID collection from `collectActorIds`, and project via `TIMELINE_SOURCES.flatMap(s => s.toEvents(...))` + `buildOperationHistoryEvents(...)` then the verbatim `.sort().slice(0,40)`.
3. **operation_history stays OUT of the registry** (load-bearing): keep its inline `db.auditLog.findMany` (`:881-897`), its `buildPatientTimelineOperationHistoryFilters`, its separate `batchResolveNames`, and its unguarded-throw semantics. Only its _projection_ moves to a sibling `buildOperationHistoryEvents`.
4. Migration is strangler (Phase 0 scaffold → Phase 1 one adapter per commit, risk-ordered, with `{ ...registryDerived, ...remainingInlineThunks }` so the task-map shape is identical at every step → Phase 2 cutover → Phase 3 op_history projection extraction). Run the 4 oracle files after each commit.

### New tests

**None added in A.** A is proven _by_ the unchanged 94-case oracle (zero test edits). Codex independently asserts in review: (a) the registry-built actor-ID `Set` equals the legacy hand-list on an overlapping-ID fixture, (b) `operation_history` is absent from `TIMELINE_SOURCES`, (c) the billing gate and every `org_id` survive, (d) no transaction introduced. If Codex wants a guard committed, add one assertion in `patient-detail.test.ts` that `TIMELINE_SOURCES.map(s=>s.key)` has no `operationHistory` — but the default is zero test churn.

---

## 3. ADAPTER INTERFACE (final) — with `visitRecords` fully worked

```ts
// patient-detail-timeline-registry.ts
import type { Prisma } from '@prisma/client';

export const EMPTY = Object.freeze([]) as readonly never[];

/** Captured-once fetch inputs. No actorNameMap (doesn't exist at fetch time). */
export interface TimelineFetchCtx {
  db: PatientTimelineDb; // C swaps this to Prisma.TransactionClient via the scoped() wrap
  orgId: string;
  patientId: string;
  caseIds: string[];
  canManageBilling: boolean;
  billingRefs: { visitRecordIds: string[]; cycleIds: string[] };
  // B adds: cursorDate: Date | null; take override is computed per-source inside fetch
}

/** Projection inputs. Superset of fetch ctx + post-fetch derived artifacts. */
export interface TimelineProjectCtx {
  patientId: string;
  actorNameMap: ReadonlyMap<string, string>;
  firstVisitDocumentActions: ReadonlyMap<string, FirstVisitDocumentAction>; // derived from op_history
  hrefs: TimelineHrefBundle; // today's precomputed builders (events.ts:695-703)
}

export interface SourceAdapter<Key extends string, Row> {
  readonly key: Key;
  fetch(ctx: TimelineFetchCtx): Promise<readonly Row[]>;
  readonly emptyFallback: readonly Row[]; // === EMPTY, type-linked to Row
  toEvents(rows: readonly Row[], ctx: TimelineProjectCtx): TimelineEvent[]; // 0..N (fan-out native)
  collectActorIds?(row: Row): Array<string | null | undefined>; // omit = contributes no actor IDs
}

export function defineTimelineSource<Key extends string, Row>(
  a: SourceAdapter<Key, Row>,
): SourceAdapter<Key, Row> {
  return a;
}
```

**Worked adapter — `visitRecords`** (relocates fetch `patient-detail.ts:498-521`, projection `events.ts:732-754`, row type `events.ts:72-82`):

```ts
type VisitRecordRow = {
  id: string;
  schedule_id: string | null;
  pharmacist_id: string | null;
  visit_date: Date | null;
  outcome_status: string | null;
  next_visit_suggestion_date: Date | null;
  cancellation_reason: string | null;
  postpone_reason: string | null;
  revisit_reason: string | null;
  created_at: Date;
};

export const visitRecordsSource = defineTimelineSource<'visitRecords', VisitRecordRow>({
  key: 'visitRecords',
  emptyFallback: EMPTY,

  // VERBATIM 498-521 — org_id, buildVisitRecordCaseScope, take:12, select all preserved
  fetch: ({ db, orgId, patientId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitRecord.findMany({
          where: { org_id: orgId, patient_id: patientId, ...buildVisitRecordCaseScope(caseIds) },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            schedule_id: true,
            pharmacist_id: true,
            visit_date: true,
            outcome_status: true,
            next_visit_suggestion_date: true,
            cancellation_reason: true,
            postpone_reason: true,
            revisit_reason: true,
            created_at: true,
          },
        }),

  collectActorIds: (row) => [row.pharmacist_id],

  // VERBATIM 732-754 — id namespace, occurred_at = visit_date ?? created_at, JST format
  toEvents: (rows, { actorNameMap, hrefs }) =>
    rows.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record',
      category: 'visit',
      occurred_at: item.visit_date ?? item.created_at,
      title: '訪問実施記録',
      summary:
        compactTimelineValues([
          /* …char-for-char from 732-754… */
        ]).join(' / ') || null,
      href: hrefs.buildVisitHref(item.id),
      action_label: null,
      status: item.outcome_status,
      status_label: item.outcome_status
        ? (VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status)
        : null,
      actor_name: item.pharmacist_id ? (actorNameMap.get(item.pharmacist_id) ?? null) : null,
      metadata: compactTimelineValues([
        /* …char-for-char… */
      ]),
    })),
});
```

**Driver (replaces the literals + projection call):**

```ts
const TIMELINE_SOURCES = [
  visitSchedulesSource,
  visitRecordsSource,
  careReportsSource,
  communicationEventsSource,
  selfReportsSource,
  externalSharesSource,
  inquiryRecordsSource,
  prescriptionIntakesSource,
  dispenseResultsSource,
  managementPlansSource,
  firstVisitDocumentsSource,
  conferenceNotesSource,
  billingCandidatesSource,
] as const;

const fetchCtx: TimelineFetchCtx = {
  db,
  orgId: args.orgId,
  patientId: args.patientId,
  caseIds,
  canManageBilling,
  billingRefs,
};
const timelineTasks = Object.fromEntries(
  TIMELINE_SOURCES.map((s) => [s.key, () => s.fetch(fetchCtx)]),
) as TimelineTasks;
const timelineFallbacks = Object.fromEntries(
  TIMELINE_SOURCES.map((s) => [s.key, s.emptyFallback]),
) as TimelineFallbacks;

// UNCHANGED settled call (concurrency 8, onTaskError, partial_failures identical)
const { results: timelineSources, failures: sourceFailures } = await runPatientDetailTasksSettled(
  timelineTasks,
  timelineFallbacks,
  {
    concurrency: PATIENT_TIMELINE_QUERY_CONCURRENCY,
    onTaskError: (f) => logPatientTimelineTaskFailure(args.orgId, f),
  },
);

// Source actor IDs — same union/order as today's 867-875
const sourceActorNameMapPromise = batchResolveNames(
  db,
  args.orgId,
  Array.from(
    new Set(
      compactPreviewValues(
        TIMELINE_SOURCES.flatMap((s) =>
          s.collectActorIds
            ? (timelineSources[s.key] as readonly unknown[]).flatMap((r) =>
                s.collectActorIds!(r as never),
              )
            : [],
        ),
      ),
    ),
  ),
);

// --- op_history: UNCHANGED inline fetch + separate batchResolveNames + merge (881-907) ---

const projectCtx: TimelineProjectCtx = {
  patientId: args.patientId,
  actorNameMap,
  firstVisitDocumentActions: latestFirstVisitDocumentActionByDocumentId(operationHistory),
  hrefs: buildTimelineHrefBundle(args.patientId),
};
const timelineEvents = [
  ...TIMELINE_SOURCES.flatMap((s) => s.toEvents(timelineSources[s.key] as never, projectCtx)),
  ...buildOperationHistoryEvents(operationHistory, projectCtx),
]
  .sort((l, r) => r.occurred_at.getTime() - l.occurred_at.getTime() || r.id.localeCompare(l.id))
  .slice(0, 40); // VERBATIM events.ts:1104-1108
```

The two `as never` casts at the `flatMap` sites are the honest, contained cost (runtime-sound: the task map was built from the same keys; TS can't prove per-key `Row` correspondence through heterogeneous iteration). Strictly better than 7 hand-maintained restatements; never exposed to adapter authors.

---

## 4. PAGINATION CONTRACT (final) — additive, backward-compatible

### Cursor (NEW `src/server/services/patient-timeline-cursor.ts`)

```ts
export const CURSOR_VERSION = 1;
export type TimelineKey = { occurredAtMs: number; id: string };

// SSOT comparator — imported by BOTH the builder sort AND the seek, so order == pagination.
export function compareTimelineKey(a: TimelineKey, b: TimelineKey): number {
  return b.occurredAtMs - a.occurredAtMs || b.id.localeCompare(a.id); // occurred_at DESC, id DESC
}
export function encodeTimelineCursor(e: { occurred_at: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, t: e.occurred_at.getTime(), id: e.id }),
    'utf8',
  ).toString('base64url');
}
export class TimelineCursorError extends Error {}
export function parseTimelineCursor(raw: string): TimelineKey {
  let p: unknown;
  try {
    p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new TimelineCursorError('malformed');
  }
  if (
    !isRecord(p) ||
    p.v !== CURSOR_VERSION ||
    typeof p.t !== 'number' ||
    !Number.isFinite(p.t) ||
    typeof p.id !== 'string' ||
    p.id.length === 0
  )
    throw new TimelineCursorError('invalid');
  return { occurredAtMs: p.t, id: p.id };
}
```

### Request

`GET /api/patients/[id]/timeline?cursor=<opaque>&limit=<n>`

- **No params → byte-identical to today.** `limit` defaults 40, clamped to `[1,40]` (lenient — never errors).
- `cursor` malformed/stale/version-mismatch → route returns **400 `{ error: 'invalid_cursor' }`** (never degrade to page 1, which would dup-append in `useInfiniteQuery`).
- Opaque base64url; carries **no source/permission/authz** — a sort-position selector, not an access-control input.

### Response (one new conditionally-spread key)

```ts
return {
  timeline_events: page,
  self_reports: selfReports, // NOT paginated; full array every page (take:8, tiny)
  ...(nextCursor ? { next_cursor: nextCursor } : {}),
  ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
};
```

`next_cursor` omitted when null — same convention as `partial_failures`. Empty timeline → both absent → `detail-slices.test.ts:150-158` exact-body assertion stays green.

### Per-source `take` interaction — the split rule (resolves event-loss + wrong-column drop)

When `cursor` present, `take` per source = `min(40, limit)`; worst case `14 × 40 = 560` rows (timeout-safe, no tx). Floor predicate **only** where orderBy lead column provably equals projected `occurred_at`:

- **Group A (push DB `lte` keyset floor):** `dispense_result`(`dispensed_at`), `billing_candidate`(`updated_at`), `communication`(`occurred_at`), `self_report`/`external_share`/`care_report`(`created_at`), `operation_history`(`created_at`). Use **`lte`** (not `lt`); the exact-`(t,id)` row is removed precisely by the in-memory seek so no tiebreak row is lost.
- **Group B (NO predicate; over-fetch + global trim):** `visit_schedule`(`scheduled_date`≠`confirmed_at??…`), `visit_record`, `inquiry`, `management_plan`, `first_visit_document`, `prescription_intake`. Pushing a floor on the lead column here would drop valid events whose lead column is new but `occurred_at` is old.

### Builder + seek

`buildPatientTimelineEvents` drops the trailing `.slice(0,40)` (`events.ts:1108`) and returns the **full sorted list** (sort uses imported `compareTimelineKey` so sort == seek). Service windows:

```ts
const all = buildPatientTimelineEvents({ ... });
const key = cursor ? parseTimelineCursor(cursor) : null;
const seeked = key
  ? all.filter((e) => compareTimelineKey({ occurredAtMs: e.occurred_at.getTime(), id: e.id }, key) > 0)
  : all;
const page = seeked.slice(0, limit);
const nextCursor =
  page.length === limit && (seeked.length > limit || anySourceHitTakeCap)
    ? encodeTimelineCursor(page[page.length - 1]) : null;
```

`anySourceHitTakeCap` = any source's returned count === its `take` (bias to emit; a final short/empty page sets `hasNextPage=false`). **No-cursor path is byte-identical**: `key=null` → `all.slice(0,40)` with unchanged per-source takes.

### FE load-more (additive)

- `patient-timeline-panel.tsx`: `useQuery` → `useInfiniteQuery`, **queryKey unchanged** `['patient-timeline', patientId, orgId]`. `getNextPageParam: (last) => last.next_cursor ?? undefined`. Events = `data.pages.flatMap(p => p.timeline_events)`; `selfReports = data.pages[0]?.self_reports ?? []` (page-1 only — do **not** flatMap, would dup).
- `patient-activity-timeline.tsx`: three **optional** props (`hasNextPage?`, `onLoadMore?`, `isFetchingNextPage?`) + one「もっと読み込む」`<Button>` after `timelineGroups.map(...)`, before `</CardContent>` (`:573`). Optional → existing render sites/tests unaffected. Client-side filtering unchanged; `timeline-completeness-note` testid retained.
- `patient-detail.types.ts:537-551`: add optional `next_cursor?: string` AND (fixing pre-existing drift) `partial_failures?: PatientTimelinePartialFailure[]` to `PatientTimelineSnapshot`. Both optional → all consumers still compile.

### Files touched (B)

NEW `patient-timeline-cursor.ts`; MODIFIED `patient-detail-timeline-events.ts` (drop slice, import comparator), `patient-detail.ts` (thread `{cursor,limit}`, Group-A floor + over-fetch take in adapter `fetch`, seek/window/`next_cursor`), `api/patients/[id]/timeline/route.ts` (parse, 400 on `TimelineCursorError`), `patient-detail.types.ts`, `patient-timeline-panel.tsx`, `patient-activity-timeline.tsx`.

### New tests (B)

- `patient-timeline-cursor.test.ts` (NEW): round-trip encode/parse; version-mismatch → `TimelineCursorError`; malformed base64 → `TimelineCursorError`; comparator equivalence with the builder sort on a fixed fixture.
- `patient-detail.test.ts` additions: no-cursor request returns the same first 40 as today (regression pin); page-2 with a Group-A source asserts `dispensed_at: { lte: cursorDate }` in the serialized query AND **no `skip`**; page-2 with a Group-B source asserts **no floor predicate** added (where unchanged, only `take` bumped); deep-page event-loss guard — seed >40 events across both groups, assert page-2 contains the next-oldest events with no source silently dropped; `next_cursor` omitted on the last page; `anySourceHitTakeCap` emits a cursor that yields an empty terminal page.
- `detail-slices.test.ts` additions: malformed `cursor` → 400 `{error:'invalid_cursor'}`; happy-path no-cursor body still exactly `{timeline_events, self_reports}`.

---

## 5. RLS MECHANISM (final) — timeout-safe per-source `withReadOrgContext`

### Mechanism

Per-source **short-lived** org-scoped interactive tx — one tx per source, NOT one wrapper around the fan-out. New thin seam (zero logic duplication over `withOrgContext`):

```ts
// src/lib/db/rls.ts — NEW
export function withReadOrgContext<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { requestContext?: RequestAuthContext; maxWaitMs?: number; timeoutMs?: number },
): Promise<T> {
  return withOrgContext(orgId, fn, {
    maxWaitMs: 2_000,
    timeoutMs: 3_000, // read default; BELOW the 5s that fired 2026-06-22; never inherits 20s mutation budget
    ...options,
    requestContext: options?.requestContext,
  });
}
```

Same `validateOrgId`, same `requestContext.orgId !== orgId` guard, same 8 `SET LOCAL` vars (`set_config(..., is_local=true)`), inherited unchanged. Applied via a one-line factory in `patient-detail.ts`:

```ts
const scoped = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  withReadOrgContext(args.orgId, run, { requestContext });
```

Each adapter `fetch` body changes **only the executor** `db.x` → `scoped((tx) => tx.x...)`; `where/orderBy/select/take` byte-identical. (In cycle order, A normalizes the fetch body, B finalizes floor/take, C wraps — so C's edit is purely `db`→`tx`.) Also wrap: eager `billingRefs` (`:463-466`), both `batchResolveNames`/`user.findMany` (`:861-906`), and the `operationHistory` `auditLog` query (`:881-897`) — the last **with an added `.catch(() => [])`** because it is not in the settled pool and an RLS/timeout reject there would 500 the whole timeline (closes a pre-existing M2 hole that wrapping forces us to address; called out, not silently widened).

### Why it cannot hit the interactive-tx timeout

The 2026-06-22 incident was one interactive tx whose 5s budget had to span ~17 serialized queries on one pinned connection. Per-source wrapping makes that **structurally impossible**: each tx contains exactly `8 × set_config + 1 × findMany` over a bounded `take` (≤12 today; ≤40 with B's over-fetch), so its budget bounds **one** bounded query, never the fan-out sum. Independent txs preserve true concurrency-8 over the worker pool (no serialization). Pool math: ≤8 in-flight short txs + eager `billingRefs` ≈ ≤9 vs pool `max:20` — the post-batch name/audit txs run after the batch drains, so they don't stack. `timeout:3000` turns a pathological single source into a fast fail-soft (`partial_failures`), strictly better than a slow whole-page 500. **No single fan-out wrapper, no bare-proxy `SET LOCAL` (lands on a different pooled connection → silent no-op), no session-level `set_config(false)` (leaks org_id across requests).**

### The test proving it

1. **RLS context set per source:** spy `tx.$executeRaw`; assert `set_config('app.current_org_id', <orgId>, true)` runs _before_ each source's `findMany`.
2. **Structural timeout-safety invariant:** assert exactly **one `findMany` per `$transaction` callback**, and `$transaction` invoked with `{ timeout: 3000, maxWait: 2000 }` — never 20s. Deterministic, replaces a flaky timing test.
3. **M2 under tx failure:** force one source's tx to reject (query throw + a P2028/timeout-shaped reject) → assert surviving sources render + the exact `partial_failures` entry; force the `operationHistory` tx to reject → assert no 500, degrades to `[]`.
4. **Defense-in-depth intact:** existing `where`-shape assertions (`org_id` present, `not.toContain('patient_id')`, `take` values) stay green, retargeted to the `tx` mock; add one assertion a representative source's serialized query still contains `org_id` (so a future "RLS makes the filter redundant" deletion fails).
5. **RLS genuinely engages (superuser guard):** integration test as a **non-superuser role with `FORCE ROW LEVEL SECURITY`**, seeds two orgs, removes the explicit `org_id` filter in the test query, asserts org-B rows excluded — the only assertion that proves _RLS_, not the app filter, isolates.

### Documented fallback (if unsafe)

The local DB runs as `ph_os` **superuser** (project memory `careviax-e2e-local-db`), so test 5 can pass for the wrong reason (the explicit filter does the blocking, not RLS). If a non-superuser role cannot be provisioned, mark **`it.skip('// BLOCKED: test DB runs as ph_os superuser; FORCE RLS + non-superuser role required')`** and record it in `.agent-loop/BLOCKED.md`. **Do NOT ship a green test that passes for the wrong reason.** Tests 1–4 (structural, deterministic) remain the active proof of timeout-safety and context-application; test 5 is the only one gated on role provisioning.

### Files touched (C)

MODIFIED `src/lib/db/rls.ts` (add `withReadOrgContext`); `patient-detail.ts` (`scoped` factory; wrap 13 fetches + `billingRefs` + 2 name resolves + auditLog-with-catch); `patient-detail.test.ts` (retarget mocks to `tx`; add test classes 1–4; `it.skip`-guarded class 5). **`patient-detail-tasks.ts` — no change** (the M2 try/catch seam we rely on).

---

## 6. RISK REGISTER

| Risk                                                 | Cycle   | Mitigation                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant isolation regression**                      | A, B, C | Every adapter `fetch` keeps `org_id: ctx.orgId` verbatim (A); cursor carries no authz and floor only narrows an already-`org_id`-AND-ed where (B); C adds RLS as a _second_ layer without removing the explicit filter; Codex asserts no `org_id` dropped + a representative query still contains `org_id`. |
| **Event loss on deep pages**                         | B       | Split rule: DB `lte` floor only where lead column == `occurred_at`; over-fetch + global trim for the 6 mismatched sources; `anySourceHitTakeCap` biases toward emitting a cursor. Dedicated deep-page event-loss test.                                                                                      |
| **Interactive-tx timeout**                           | C       | Per-source short tx (1 query, bounded take) → budget bounds one query not the fan-out; `timeout:3000`; ≤9 connections vs pool 20; over-fetch capped at ≤560 rows. Structural "1 findMany per tx" invariant test.                                                                                            |
| **Contract breakage**                                | B       | `next_cursor` + `partial_failures` conditionally spread (omitted when null/empty) → exact-body slice contract green; `limit` lenient (clamp), `cursor` strict (400); FE props optional.                                                                                                                     |
| **Test regression (94 oracle)**                      | A, B, C | A: zero test edits — relocation not rewrite, oracle is the net. B: no-cursor path byte-identical (regression pin). C: only mock executor retargets `prisma.x`→`tx.x`; query args/output unchanged.                                                                                                          |
| **`as never` casts hiding a real type bug**          | A       | Contained to two driver lines built from the same key set; `TimelineTasks`/`TimelineFallbacks` derived types re-establish the `satisfies` guarantee centrally; adapter authors never see the cast.                                                                                                          |
| **op_history asymmetry broken**                      | A, B, C | op_history stays outside `TIMELINE_SOURCES`/settled pool with unguarded-throw intact (asserted at `:3405`); only its projection (A) and `take`/floor (B) and tx-wrap+catch (C) change.                                                                                                                      |
| **Event-loss guard (legacy audit, no `patient_id`)** | A, B, C | `buildPatientTimelineOperationHistoryFilters` untouched; serialized auditLog query still `not.toContain('patient_id')` (`query.test.ts:47`, `:3330`).                                                                                                                                                       |

---

## 7. COMPLIANCE / HARD-STOPS

- **No schema/migration in A or B.** A relocates code; B adds in-memory windowing + `where`-keyset (`lte`) + larger `take` — **no `skip`, no new column, no index migration**. If profiling later shows the `lte` floor needs an index, that is a **separate human-gated migration**, explicitly out of this plan.
- **C is security (RLS = care).** It must **not weaken auth**: explicit `org_id`/assignment filters stay verbatim as defense-in-depth; RLS is added as the _second_ layer; the `requestContext.orgId !== orgId` mismatch guard and `validateOrgId` are inherited unchanged from `withOrgContext`. C touches `src/lib/db/rls.ts` (additive thin wrapper only — `withOrgContext` itself unmodified). The superuser test caveat is a documented BLOCKED fallback, not a silent skip.
- **Billing gate** (`canManageBilling`) is re-derived per request from `args.role` and never carried in the cursor — a clerk's replayed pharmacist cursor cannot surface a billing event (not in the clerk's candidate set). Asserted at `timeline-query.test.ts:21`.
- No production deploy, no destructive migration, no payments/auth mutation in scope.

---

## 8. TEST PLAN — proving behavior preservation

**Oracle (must stay green across A, B, C, unedited except C's mock retarget):** the ~94 cases across `patient-detail.test.ts` (~47), `patient-detail-tasks.test.ts` (4), `patient-detail-timeline-query.test.ts` (3), `detail-slices.test.ts` (40). They assert against `getPatientTimelineData`'s return and serialized Prisma spies — every `select/where/orderBy/take` and every projection string is relocated, not rewritten, so spies + DTO assertions pass by construction.

- **A — pure preservation:** zero test edits; the oracle _is_ the proof. Codex independently re-verifies actor-ID-union equivalence, op_history exclusion, billing gate, `org_id` retention, no-tx. Specific pins it must keep green: sort+id-tiebreak (`:3529`, `:1466`), JST dates (`:3467`), `partial_failures` shape/log (`:3405`, `detail-slices:333`), per-source `take`+no-`skip` (`:3231/:3165/:3330`), self-report dedupe (`:3231`), `{timeline_events, self_reports}` exact body (`detail-slices:150`), legacy-audit target-scoping (`query.test:47`).
- **B — additive + new:** all oracle stays green via the byte-identical no-cursor path (regression pin asserts page-1 == today's 40). New: `patient-timeline-cursor.test.ts` (encode/parse/version/comparator), page-2 Group-A `lte`/no-`skip`, page-2 Group-B no-floor, deep-page event-loss, `next_cursor` omission, 400-on-malformed, no-cursor exact body.
- **C — preservation under tx:** oracle green with mocks retargeted `prisma.x`→`tx.x` (executor change only). New: RLS-context-per-source, structural 1-findMany-per-tx + `{timeout:3000,maxWait:2000}`, M2-under-tx-reject + op_history-reject→`[]`, defense-in-depth `org_id`-retained, and the `it.skip`-guarded non-superuser FORCE-RLS isolation test.
- **Gate (each cycle):** `pnpm lint && typecheck && typecheck:no-unused && format:check && test && build` (build/typecheck not parallelized — `.next/types` race). Codex is the independent checker; no self-approval.

**Net of A:** adding a source goes from 5-restatement / 3-file hand-wiring to one `defineTimelineSource` literal + one line in `TIMELINE_SOURCES`. B and C then extend that single descriptor (one `fetch` floor, one `scoped` wrap) instead of re-threading five sites.
