---
type: PerformanceFinding
title: Patient Detail Root Scoped Read 2026 07 08
confidence: high
evidence_level: validated
validity_scope: /Users/yusuke/workspace/careviax main after 5fdea246e
ingested_via: put_page
ingested_at: '2026-07-07T17:10:37.839Z'
source_kind: put_page
tags:
  - careviax
  - db-performance
  - patient-detail
  - perf-db-005
  - phi
  - rls
---

# Patient detail root scoped read and timeline fan-out removal

## Context

`GET /api/patients/[id]` was still acting as a legacy all-surfaces detail endpoint. It loaded the patient shell plus timeline-only sources in one request, including communication events, inquiry records, prescription intakes, dispense results, management plans, conference notes, operation audit history, and actor-name resolution.

## Decision

Keep the compatibility payload keys that remaining root consumers still use, but move root GET reads into `withOrgContext(ctx.orgId, ..., { requestContext: ctx })` and remove timeline-only fan-out from the root route. Timeline data should be read through `/api/patients/[id]/timeline` and the patient-detail timeline service.

## Implementation

Commit `5fdea246e`:

- `src/app/api/patients/[id]/route.ts`
  - wraps authenticated root GET read work in `withOrgContext`;
  - passes the scoped transaction client into helper/service reads;
  - removes root reads for communication timeline events, inquiries, prescription intakes, dispense results, management plans, conference notes, audit operation history, and actor-name resolution;
  - keeps `timeline_events: []` as a compatibility key;
  - adds `take: 8` to root first-visit document reads.
- `src/app/api/patients/[id]/route.test.ts`
  - asserts root GET uses scoped RLS context;
  - asserts timeline-only sources are not called from root GET;
  - removes old root timeline event expectations covered by dedicated timeline slice tests.

## Validation

- `pnpm exec vitest run 'src/app/api/patients/[id]/route.test.ts' --reporter=dot --testTimeout=30000`
- `pnpm exec vitest run 'src/app/api/patients/[id]/route.test.ts' 'src/app/api/patients/[id]/detail-slices.test.ts' 'src/app/api/patients/[id]/timeline/route.test.ts' --reporter=dot --testTimeout=30000`
- `pnpm exec eslint 'src/app/api/patients/[id]/route.ts' 'src/app/api/patients/[id]/route.test.ts'`
- `pnpm exec prettier --check 'src/app/api/patients/[id]/route.ts' 'src/app/api/patients/[id]/route.test.ts'`
- `git diff --check -- 'src/app/api/patients/[id]/route.ts' 'src/app/api/patients/[id]/route.test.ts'`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`

All passed.

## Remaining follow-ups

- Replace broad patient master `include` in root GET and `findPatientOverviewBase` with bounded `select` and per-relation `take`.
- Scope overview route/service reads through request-aware transaction where feasible.
- Add dedicated tests that fail on broad relation `include` in patient shell readers.
