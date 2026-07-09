---
type: PerformanceFinding
title: Query Shape Watchlist 003a 003d
confidence: high
evidence_level: tests-passing
validity_scope: careviax query-shape watchlist guard as of 2026-07-08
ingested_via: put_page
ingested_at: '2026-07-07T22:19:36.394Z'
source_kind: put_page
tags:
  - careviax
  - db-performance
  - phi-minimization
  - prisma
  - query-shape
---

# Query shape watchlist 003A/003D implementation note

CareViaX expanded the watchlist-only query-shape guard with a zero-allowlist batch and focused tests.

Implemented evidence:
- `tools/query-shape-watchlist.json` now includes care-report detail, prescriber institution suggestions, document delivery rules, visit-schedules route entrypoint, and visit-preparation brief batch.
- `pnpm db:query-shape:check` passes with 0 allowlisted and 0 new violations.
- Care-report detail nested `delivery_records` is capped and uses stable `created_at + id` order.
- Helper top-1 reads for prescriber institution suggestions and document delivery rules now include `id` tie-breakers.
- Guard tests now cover transaction-client `tx.*.findMany` and reject date-range-only reads as unbounded.
- MedicationStock summary tests lock snapshot fan-in scope/projection.
- Patient timeline registry adapter tests lock scoped, bounded, stable, include-free source reads.

Important residual decision:
- `src/app/api/visit-schedules/route.ts` is only an entrypoint marker. The actual list query lives in `src/server/services/visit-schedule-service.ts` and still uses `include: buildScheduleListInclude(orgId)`. Do not treat the route watchlist entry as service-level protection. A later slice should move service reads toward tx/withOrgContext evidence and explicit bounded select before adding the service file to the watchlist.
- Do not put write-side ledger replay paths into this read-path watchlist without a separate policy.

Validation commands that passed:
- `pnpm db:query-shape:check`
- focused Vitest suite covering query-shape guard, care-report detail, helper top-1 order, MedicationStock summary, timeline registry, visit schedules route, and brief-batch route
- scoped ESLint and Prettier
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`
