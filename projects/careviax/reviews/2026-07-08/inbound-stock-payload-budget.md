---
type: PerformanceFinding
title: Inbound and medication-stock payload budgets
branch: main
source:
  - 'file:src/lib/api/response.ts'
  - 'file:src/lib/utils/route-payload-budgets.ts'
  - 'file:src/app/api/communications/inbound/route.ts'
  - 'file:src/app/api/communications/inbound/signals/route.ts'
  - 'file:src/app/api/patients/[id]/medication-stock/route.ts'
  - >-
    file:src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.ts
  - 'file:src/lib/utils/performance.test.ts'
  - 'file:src/app/api/communications/inbound/route.test.ts'
  - 'file:src/app/api/communications/inbound/signals/route.test.ts'
  - 'file:src/app/api/patients/[id]/medication-stock/route.test.ts'
  - >-
    file:src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.test.ts
  - >-
    test:pnpm exec vitest run src/lib/utils/performance.test.ts
    src/app/api/communications/inbound/route.test.ts
    src/app/api/communications/inbound/signals/route.test.ts
    src/app/api/patients/[id]/medication-stock/route.test.ts
    src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.test.ts
    src/lib/auth/context.test.ts src/lib/auth/__tests__/context.test.ts
    --reporter=dot --testTimeout=30000
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck'
task_id: PAYLOAD-BUDGET-001C-D
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/reviews/2026-07-08/inbound-stock-payload-budget
confidence: high
created_at: '2026-07-07T21:30:28Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-07T21:34:00Z'
owner_agent: codex-lead
commit_after: d216d7561a870d1b517ac4ffe79e31ec7f63123f
commit_before: 3e1a9574ee0e767d28c4d50a8d0dd3e075837e6b
superseded_by: null
evidence_level: tested
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/lib/utils/route-payload-budgets.ts
    - src/app/api/communications/inbound/route.ts
    - src/app/api/communications/inbound/signals/route.ts
    - 'src/app/api/patients/[id]/medication-stock/route.ts'
    - >-
      src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.ts
  tech_stack:
    - Next.js
    - TypeScript
  directories:
    - src/app/api/communications/inbound
    - 'src/app/api/patients/[id]/medication-stock'
    - src/lib/utils
    - src/modules/pharmacy/medication-stock
ingested_via: put_page
ingested_at: '2026-07-07T21:32:54.720Z'
source_kind: put_page
tags:
  - api
  - careviax
  - inbound
  - medication-stock
  - no-store
  - payload-budget
  - performance
  - privacy
---

## Finding

Inbound communication inbox, inbound signal candidates, and patient medication-stock summary are PHI-bearing bounded-read routes. They need both route payload-budget registry entries and measured successful JSON responses so payload telemetry can catch regressions.

## Fix

Registered payload budgets for the three routes and moved their success paths to measured JSON responses that emit `Content-Length`. The response metadata now reports visible and hidden row counts with explicit count-basis semantics so bounded windows remain truthful to operators.

## Security and privacy hardening

Sensitive route handlers now catch internal handler failures and return no-store internal errors through the route helper instead of letting exceptions bypass the route-local no-store path. Inbound action links are constrained to relative paths and reject query material commonly associated with tokens, storage keys, or signatures.

## Route matching lesson

Route normalization regexes for id-like path segments must not be broad enough to classify static collection segments such as `communications` as `:id`. Use stricter CUID-like matching or explicit tests for static paths when adding budgeted routes.

## Verification

- Focused route and summary tests assert `Content-Length`, count metadata, hidden counts, no-store internal errors, and safe fallback links.
- Performance tests assert the new route families match after query stripping and dynamic segment normalization.
- Scoped ESLint, Prettier check, diff whitespace check, focused Vitest, and full typecheck passed.

## Next time

Extend the same budget and measured-response contract to remaining patient board, report, and detail surfaces. Add cross-route payload perf-smoke once enough route families use the shared helper.
