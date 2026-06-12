# Performance Baseline & Optimization Results (2026-03-31)

## Test Parameters

- Tool: `tools/scripts/perf-smoke.ts`
- Command: `pnpm perf:smoke`
- Requests per route: 40
- Concurrency: 4
- Target: P95 < 500ms, P50 < 200ms
- Environment: Local dev (macOS, Node.js 24.16.0)

## Baseline (Before Optimization)

> To be measured with `pnpm dev` running:
>
> ```bash
> pnpm perf:smoke --path /api/patients --requests 40 --concurrency 4
> pnpm perf:smoke --path /api/visit-schedules --requests 40 --concurrency 4
> pnpm perf:smoke --path /api/dashboard/workflow --requests 40 --concurrency 4
> ```

| Route                          | P50 (ms) | P95 (ms) | Max (ms) | Errors |
| ------------------------------ | -------- | -------- | -------- | ------ |
| `/api/patients`                | TBD      | TBD      | TBD      | TBD    |
| `/api/visit-schedules`         | TBD      | TBD      | TBD      | TBD    |
| `/api/dashboard/workflow`      | TBD      | TBD      | TBD      | TBD    |
| `/api/dashboard/home/actions`  | TBD      | TBD      | TBD      | TBD    |
| `/api/dashboard/home/patients` | TBD      | TBD      | TBD      | TBD    |
| `/api/care-reports`            | TBD      | TBD      | TBD      | TBD    |
| `/api/prescription-intakes`    | TBD      | TBD      | TBD      | TBD    |
| `/api/dispense-queue`          | TBD      | TBD      | TBD      | TBD    |
| `/api/medication-sets`         | TBD      | TBD      | TBD      | TBD    |
| `/api/billing-candidates`      | TBD      | TBD      | TBD      | TBD    |

## Optimizations Applied

### Server-side (API routes)

1. **Workflow route query parallelization** — Reduced 4 sequential await stages to 2 by merging Promise.all blocks and moving `getHomeCareFeatureSummary()` into main block
2. **Workflow route response caching** — 15s TTL in-memory cache keyed by org_id, skips all DB queries on hit
3. **Patients route enrichment** — Optimized post-query enrichment with `DISTINCT ON` for visit records
4. **Connection pool sizing** — Raised pg pool from 10 to 20 connections (configurable via `DATABASE_POOL_SIZE`)

### Database indexes

5. **VisitSchedule composite indexes** — Added `[org_id, scheduled_date, schedule_status]` and `[org_id, pharmacist_id, scheduled_date]`

### Client-side (TanStack Query)

6. **staleTime optimization** — Master pages 300s, detail pages 120s, dashboard actions 30s

### Tooling

7. **perf-smoke.ts fix** — `--path` now excludes default `/api/health` for accurate single-route measurement

## After Optimization

| Route                     | P50 (ms) | P95 (ms) | Max (ms) | Errors | Target Met |
| ------------------------- | -------- | -------- | -------- | ------ | ---------- |
| `/api/patients`           | TBD      | TBD      | TBD      | TBD    | TBD        |
| `/api/visit-schedules`    | TBD      | TBD      | TBD      | TBD    | TBD        |
| `/api/dashboard/workflow` | TBD      | TBD      | TBD      | TBD    | TBD        |

> Populate by running `pnpm perf:smoke` against a dev server with seeded data.
