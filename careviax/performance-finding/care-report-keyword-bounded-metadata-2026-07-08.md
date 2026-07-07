---
type: concept
title: Care Report Keyword Bounded Metadata 2026 07 08
ingested_via: put_page
ingested_at: '2026-07-07T19:04:46.230Z'
source_kind: put_page
---

type: PerformanceFinding
title: Care report keyword body search uses plus-one bounded scan metadata
context: /api/care-reports keyword search must not pretend full-text search is complete while it only scans an application-side window.
decision: Keep CARE_REPORT_KEYWORD_SCAN_LIMIT at 500, read limit+1 rows to detect overflow, process only the first 500 rows, reject keyword cursor pagination, omit nextCursor for keyword responses, and return search metadata with count_basis=bounded_keyword_scan, keyword_scan_limit, keyword_scan_truncated, and result_window_truncated.
evidence: src/app/api/care-reports/route.ts; src/app/api/care-reports/route.test.ts PERF-DB-006B test
security: No raw report content is added to list responses. Metadata is count/window-only and does not expose PHI.
validity_scope: careviax main as of 2026-07-08, /api/care-reports GET keyword mode
confidence: high
tags: careviax,performance,db-read,care-reports,keyword-search
