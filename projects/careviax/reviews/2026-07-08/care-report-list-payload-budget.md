---
type: PerformanceFinding
title: Care report list search payload boundary
branch: main
source:
  - 'file:src/app/api/care-reports/route.ts'
  - 'file:src/app/api/care-reports/route.test.ts'
  - 'file:src/lib/utils/route-payload-budgets.ts'
  - 'file:src/lib/utils/performance.test.ts'
  - >-
    test:pnpm exec vitest run src/lib/utils/performance.test.ts
    src/app/api/care-reports/route.test.ts tools/scripts/perf-smoke.test.ts
    --reporter=dot --testTimeout=30000
  - 'test:NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck'
task_id: PAYLOAD-BUDGET-003
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/reviews/2026-07-08/care-report-list-payload-budget
confidence: high
created_at: '2026-07-07T20:09:21.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-07T20:09:21.000Z'
ingested_at: '2026-07-07T20:11:52.299Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: 10573dc88
ingested_via: put_page
commit_before: fabbd99a45afdf1c690d2b590a54040555be2622
superseded_by: null
evidence_level: tested
reviewer_agent: oracle-gpt-5.5-pro
validity_scope:
  repo: careviax
  files:
    - src/app/api/care-reports/route.ts
    - src/app/api/care-reports/route.test.ts
    - src/lib/utils/route-payload-budgets.ts
    - src/lib/utils/performance.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
  directories:
    - src/app/api/care-reports
    - src/lib/utils
tags:
  - care-report
  - careviax
  - payload-budget
  - performance
  - phi-boundary
---

## Finding

`GET /api/care-reports` list/search rows can become a payload and PHI boundary risk if they return raw child delivery records, stored file URLs, search helper fields, hidden report content, or content-derived billing metadata.

## Fix

Register `/api/care-reports` as a measured payload-budget route with family `care-reports-list-search` and a 250 KiB budget. Keep the list/search response on an explicit allow-list. Do not expose raw `delivery_records`, raw delivery recipient detail, `pdf_url`, `_searchable_report_text`, hidden report content, or content-derived billing context from normal list rows. `include_content=1` may expose `content_summary` only.

## Measurement contract

The performance wrapper depends on response `content-length`, so API routes that use `NextResponse.json()` without a measured body header will not be counted for payload budgets. For payload-budgeted JSON routes, use a measured success helper that sets `Content-Length` to the UTF-8 byte length of the serialized response body.

## Verification

- Route tests assert Prisma select minimization and response omission for file URLs, raw delivery fields, hidden content, search helper fields, and content-derived metadata.
- Performance unit tests assert query-string stripping and over-budget detection for `/api/care-reports?keyword=...`.
- Focused route/perf tests and typecheck passed in the implementation slice.

## Next time

When adding a payload budget for another route, verify both the route-budget registry and the measured response path. A registry entry alone is not sufficient if the route does not emit a `Content-Length` header.
