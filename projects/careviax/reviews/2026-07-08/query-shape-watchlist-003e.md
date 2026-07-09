---
type: PerformanceFinding
title: Query Shape Watchlist 003E Visit Schedule Service
confidence: high
source_kind: put_page
evidence_level: tests-passing
validity_scope: careviax visit schedule and query-shape guard as of 2026-07-08
ingested_via: put_page
ingested_at: '2026-07-07T22:46:31.279Z'
tags:
  - careviax
  - db-performance
  - phi-minimization
  - prisma
  - query-shape
  - visit-schedules
---

# Query shape watchlist 003E implementation note

CareViaX tightened the visit schedule read path and query-shape guard without changing runtime authorization semantics or applying migrations.

Implemented evidence:
- `src/server/services/visit-schedule-service.ts` now uses explicit `buildScheduleListSelect(orgId)` for schedule list reads instead of top-level `include`.
- Vehicle route duration validation reads are capped with `take: routeDurationValidationLimit + 1` and stable `route_order + time_window_start + id` ordering.
- `src/lib/db/patient-operational-summary-select.ts` includes an `id` tie-breaker for operational insurance top-N reads.
- `tools/query-shape-watchlist.json` includes the visit schedule service file with zero allowlist debt.
- `tools/scripts/check-query-shape.mjs` no longer treats nested relation `take` as a top-level `findMany` bound; fixture coverage proves this regression.
- `src/app/api/care-reports/route.ts` expresses the list read limit as explicit top-level `take: reportReadLimit`, allowing static proof without relying on conditional spread parsing.

Validation commands that passed:
- `pnpm db:query-shape:check`
- `pnpm exec vitest run tools/scripts/check-query-shape.test.ts src/app/api/visit-schedules/route.test.ts src/app/api/care-reports/route.test.ts --reporter=dot --testTimeout=30000`
- scoped ESLint and Prettier checks
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`

Important residual decision:
- This slice preserves app-layer `org_id` and patient-boundary predicates. Do not treat it as DB-RLS hard-boundary proof. `withOrgContext`/RLS proof belongs to a separate permission/RLS task.
- Remaining query-shape cleanup targets are patients board, day-board, contact profiles, visit-preparation detail, visit-brief, and visit-record BFF.
