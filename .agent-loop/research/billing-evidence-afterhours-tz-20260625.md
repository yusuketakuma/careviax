# CONFIRMED §15 billing bug: after-hours 加算 uses server-local time, not JST (2026-06-25, claude scout R2)

Status: **CONFIRMED real 算定/billing correctness bug. §15 hard-stop → escalated to BLOCKED.md. NOT auto-fixed.**

## Where

`src/server/services/billing-evidence/core.ts:237-251` — `resolveAfterHoursVisitCategory`:

```ts
function resolveAfterHoursVisitCategory(args: { visitDate: Date; isHoliday: boolean }):
  'night' | 'holiday' | 'midnight' | null {
  const hours = args.visitDate.getHours();      // <-- server LOCAL tz
  const minutes = args.visitDate.getMinutes();  // <-- server LOCAL tz
  const seconds = args.visitDate.getSeconds();  // <-- server LOCAL tz
  const hasMeaningfulTime = hours !== 0 || minutes !== 0 || seconds !== 0;
  if (args.isHoliday) return 'holiday';
  if (!hasMeaningfulTime) return null;
  if (hours >= 22 || hours < 6) return 'midnight';   // 深夜加算
  if (hours < 8 || hours >= 18) return 'night';      // 夜間加算
  return null;
}
```

Caller: `core.ts:1554` inside `upsertBillingEvidenceForVisit`, feeding `afterHoursVisit` into `buildBillingCandidateSpecs` → drives 夜間/深夜/休日 reimbursement points.

## Why it is a real bug (not a false positive)

1. **`visit_date` is a full `DateTime`** (`prisma/schema/visit.prisma:195`), i.e. a UTC instant — NOT `@db.Date` and NOT `@db.Time`. So `getHours()` returns the hour in the **server process timezone**, which is deployment-dependent.

2. **The intended semantic is Japan civil time.** The very same file defines and uses the correct JST idiom:
   ```ts
   // core.ts:263-268
   function japanCivilMonthParts(value: Date) {
     const japanDate = new Date(value.getTime() + JAPAN_TIME_ZONE_OFFSET_MS); // +9h
     return { year: japanDate.getUTCFullYear(), monthIndex: japanDate.getUTCMonth() };
   }
   ```
   `JAPAN_TIME_ZONE_OFFSET_MS = 9 * 60 * 60 * 1000` (core.ts:261). Billing-month bucketing correctly converts to JST; the after-hours classifier does NOT — it deviates by using raw `getHours()`.

3. **Production runs in UTC.** AWS Lambda / Amplify SSR default `TZ=UTC`. There, `getHours()` is 9 hours behind JST wall-clock:
   - A real 22:00 JST visit is stored 13:00 UTC → `getHours()=13` → classified `night`? No: 13 is not <8 and not >=18 → **`null`** → 深夜/夜間加算 dropped → **under-billing**.
   - A real 02:00 JST visit (深夜) is stored 17:00 UTC prev day → `getHours()=17` → `null` → **深夜加算 dropped**.
   - A real 09:00 JST daytime visit stored 00:00 UTC → `hasMeaningfulTime=false` → `null` (ok by luck), but 07:00 JST stored 22:00 UTC → `getHours()=22` → **`midnight`** → **over-billing 深夜加算** on a morning visit.
   Net: both **under- and over-claiming** of 夜間/深夜加算 depending on the visit hour, whenever the server tz != JST.

4. **The existing test masks it.** `core.test.ts:1499` constructs `new Date(2026, 2, 20, 22, 0, 0)` — the **local-time** Date constructor — and comments "22:00 local", asserting `midnight`. It passes ONLY because the Vitest runner is pinned to `Asia/Tokyo`. The same stored instant on a UTC server classifies differently. The test gives false confidence and is itself tz-dependent.

## Correct fix (for human approval — do NOT auto-land)

Mirror the file's own JST idiom inside `resolveAfterHoursVisitCategory`:
```ts
const japanDate = new Date(args.visitDate.getTime() + JAPAN_TIME_ZONE_OFFSET_MS);
const hours = japanDate.getUTCHours();
const minutes = japanDate.getUTCMinutes();
const seconds = japanDate.getUTCSeconds();
```
and rewrite the test to construct the stored instant in UTC (e.g. a 22:00 JST visit = `new Date(Date.UTC(2026, 2, 20, 13, 0, 0))`) and assert `midnight` independent of runner tz. NOTE: `getUTCHours()` ALONE (without the +9h offset) is also wrong — it would classify by UTC, not JST. The offset conversion is required.

Also re-examine the `isHoliday` input and any day-of-week / holiday determination upstream for the same server-tz dependence (out of scope of this note; flag for the same review).

## Why escalated, not fixed

This changes how 夜間/深夜/休日加算 (reimbursement points) are computed → **算定/billing correctness = §15 hard-stop**. Requires human/domain approval before implementation, with tz-independent tests proving correct classification (no over-claim, no dropped 加算). Recorded in `.agent-loop/BLOCKED.md`.

Evidence files: core.ts:237-251 (classifier), core.ts:261-268 (JST idiom), core.ts:1554 (caller), visit.prisma:195 (visit_date DateTime), core.test.ts:1498-1518 (tz-dependent test).
