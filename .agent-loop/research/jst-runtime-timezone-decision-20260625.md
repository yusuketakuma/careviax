# JST civil-time architecture + runtime-TZ guard decision (2026-06-25, claude)

Outcome of "日本時間に統一して". After investigation the user chose **ランタイムTZ保証を推進(推奨)**, not a
per-call code refactor. This note records WHY a per-call refactor is the wrong fix and what the guard does.

## Finding: the codebase consistently assumes server process TZ = Asia/Tokyo

Civil-time logic (calendar-day keys, `@db.Date` day boundaries, dispensing/billing today/after-hours
classification) is written against the convention that the **runtime process timezone is JST**. Evidence:

- `src/lib/utils/date-boundary.ts` — `localDateKey()` returns the **server-local** date key BY DESIGN
  (documented JST convention); `@db.Date` columns store "JST date at UTC-midnight". A server in UTC would
  shift every day boundary 9h and mis-key today.
- `tools/infra/eventbridge-schedules.json` — every schedule uses `scheduleExpressionTimezone: "Asia/Tokyo"`.
- The Vitest runner is pinned to Asia/Tokyo, so local-time test fixtures pass — which **masks** TZ bugs
  rather than proving correctness (see the after-hours billing escalation below).
- The correct explicit-JST idiom already exists where authors were careful:
  `billing-evidence/core.ts:263` `japanCivilMonthParts` does `new Date(t + JAPAN_TIME_ZONE_OFFSET_MS)`
  then `getUTC*`. JST = UTC+9, no DST, so `getTimezoneOffset() === -540` is a stable signal.

## Why NOT a per-call refactor

Rewriting every `getHours()`/`localDateKey()` call site to bake in `+9h` would be a large, error-prone
change across dozens of files, and it would be **redundant** when the process runs in JST. Worse, a
half-done refactor (some sites JST-explicit, some still server-local) produces *inconsistent* boundaries —
strictly worse than the current uniform "assume JST" convention. The right unification point is the
**runtime**, guaranteed once and observable, not N call sites.

The one place that genuinely deviates and is independently a §15 算定 bug —
`resolveAfterHoursVisitCategory` classifying 夜間/深夜/休日加算 from server-local `getHours()` on a UTC
`DateTime` instant — is escalated separately (`F-20260625-billing-evidence-afterhours-tz`) because it
needs the explicit-JST idiom AND tz-independent tests, and touches 算定 (human approval).

## What was implemented (non-breaking guard, landed via dual-maker)

`src/lib/env/assert-env.ts`:
- `resolveRuntimeTimezone(probe?)` — reports `{ ok, expected, resolvedName, offsetMinutes }`;
  `ok = offsetMinutes === -540`. `probe` injects offset/name for tz-independent tests.
- `assertRuntimeTimezone(env?, probe?)` — startup guard. **Default non-breaking**: `console.warn` when the
  runtime is not JST so the misconfiguration is observable without taking down a running deploy. **Fails
  fast only** when `isProductionEnv(env) && ENFORCE_APP_TZ` is truthy (opt-in, enabled once prod TZ is set).
- Wired in `src/instrumentation.ts register()` after `assertProductionEnvSafety()` (Node runtime only).
- Tests (`assert-env.test.ts`): offset -540 → ok/silent; offset 0 → warn (non-fatal); dev+ENFORCE → warn
  not throw; prod+ENFORCE+offset 0 → throws. All use injected probe so they are tz-independent.

## What still needs a human (§15 — recorded in BLOCKED.md)

The guard only **detects**. Actually guaranteeing prod JST is a prod-deploy/env change:
1. Set `TZ=Asia/Tokyo` on the production runtime (Amplify/Lambda default is UTC).
2. After (1) is confirmed in prod, enable `ENFORCE_APP_TZ=1` so the guard fails fast on regression.

Both are §15 (prod deploy / env). See BLOCKED row `F-20260625-runtime-tz-prod-env`.
