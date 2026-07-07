---
type: PerformanceFinding
title: Patient movement timeline payload budget
branch: main
source:
  - 'file:src/app/api/patients/[id]/timeline/route.ts'
  - 'file:src/app/api/patients/[id]/timeline/route.test.ts'
  - 'file:src/lib/utils/route-payload-budgets.ts'
  - 'file:src/lib/utils/performance.test.ts'
  - >-
    test:pnpm exec vitest run src/lib/utils/performance.test.ts
    'src/app/api/patients/[id]/timeline/route.test.ts'
    'src/app/api/patients/[id]/detail-slices.test.ts'
    src/server/services/patient-movement-timeline-presenter.test.ts
    --reporter=dot --testTimeout=30000
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck'
task_id: PAYLOAD-BUDGET-001B
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/reviews/2026-07-08/patient-timeline-payload-budget
confidence: high
created_at: '2026-07-07T20:40:00Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-07T20:40:00Z'
ingested_at: '2026-07-07T20:39:34.159Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: null
ingested_via: put_page
commit_before: a7673c39266bd8641ffb6b639f5909c44087da6a
superseded_by: null
evidence_level: tested
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - 'src/app/api/patients/[id]/timeline/route.ts'
    - 'src/app/api/patients/[id]/timeline/route.test.ts'
    - src/lib/utils/route-payload-budgets.ts
    - src/lib/utils/performance.test.ts
  tech_stack:
    - Next.js
    - TypeScript
  directories:
    - src/app/api/patients
    - src/lib/utils
tags:
  - api
  - careviax
  - patient-detail
  - payload-budget
  - performance
---

## Finding

`GET /api/patients/:id/timeline` was a critical patient detail list read path but was not registered in the payload budget registry. It also returned plain JSON, so payload bytes would be unmeasured unless the response emits `Content-Length`.

## Fix

Register the route as `patient-movement-timeline-list` with a 250 KiB payload budget and use `successWithMeasuredJsonPayload()` for the successful JSON response.

## Important implementation detail

Authenticated route handlers built with `withAuthContext()` already run inside `withRoutePerformance()`. Do not add a second explicit performance wrapper around those routes; only ensure the JSON success response includes `Content-Length`.

## Verification

- Route test asserts measured JSON `Content-Length`.
- Performance test asserts dynamic patient IDs and query strings normalize to `/api/patients/:id/timeline`.
- Focused Vitest, ESLint, Prettier check, diff whitespace check, and full typecheck passed.

## Next time

Apply the same budget + measured response contract to inbound inbox/signals and medication-stock summary routes, while preserving additive metadata and raw/detail separation.
