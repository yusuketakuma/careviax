---
type: PerformanceFinding
title: Dashboard segment payload budgets
branch: main
source:
  - 'file:src/lib/api/response.ts'
  - 'file:src/lib/utils/route-payload-budgets.ts'
  - 'file:src/server/services/dashboard-cockpit.ts'
  - 'file:src/app/api/dashboard/cockpit/route.test.ts'
  - 'file:src/lib/utils/performance.test.ts'
  - >-
    test:pnpm exec vitest run src/lib/utils/performance.test.ts
    src/app/api/dashboard/cockpit/route.test.ts
    src/app/api/patients/board/route.test.ts
    src/app/api/care-reports/route.test.ts --reporter=dot --testTimeout=30000
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck'
task_id: PAYLOAD-BUDGET-001A
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/reviews/2026-07-08/dashboard-segment-payload-budget
confidence: high
created_at: '2026-07-07T20:26:12Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-07T20:26:12Z'
owner_agent: codex-lead
commit_after: f67a0db1b192f1c8fdea46aa78dbc0b574fc27f8
commit_before: ee2c739e1714db2d7ff906cb7a97ef2158e3d231
superseded_by: null
evidence_level: tested
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/lib/api/response.ts
    - src/lib/utils/route-payload-budgets.ts
    - src/server/services/dashboard-cockpit.ts
    - src/app/api/dashboard/cockpit/route.test.ts
    - src/lib/utils/performance.test.ts
  tech_stack:
    - Next.js
    - TypeScript
  directories:
    - src/app/api/dashboard/cockpit
    - src/lib/api
    - src/lib/utils
    - src/server/services
ingested_via: put_page
ingested_at: '2026-07-07T20:27:32.602Z'
source_kind: put_page
tags:
  - api
  - careviax
  - dashboard
  - payload-budget
  - performance
---

## Finding

Dashboard cockpit segment routes beyond `summary` were not payload-budgeted. Even after registry rows are added, `withRoutePerformance` can only record payload bytes when the response emits a `Content-Length` header.

## Fix

Use a shared measured JSON success helper for payload-budgeted JSON routes. The helper sets `Content-Length` to the UTF-8 byte length of the serialized response. Dashboard cockpit segment responses now use this helper, and the route payload budget registry includes `details`, `team`, `comments`, `inbound`, `stock-risks`, and `report-billing` segment routes.

## Measurement contract

For critical list, summary, and dashboard segment routes, a payload budget registry entry is not enough. The successful JSON response path must also emit `Content-Length`; otherwise the route remains `unmeasured` in performance telemetry.

## Verification

- Performance tests assert dashboard segment budget matching after query stripping.
- Dashboard route tests assert measured `Content-Length` on a segment response.
- Existing patient board and care-report route tests passed after migrating their local measured helpers to the shared helper.
- Focused Vitest, ESLint, Prettier check, diff whitespace check, and full typecheck passed.

## Next time

Apply the same two-part contract to movement timeline, inbound inbox/signals, and medication-stock summary routes: register the budget and verify the measured response path.
