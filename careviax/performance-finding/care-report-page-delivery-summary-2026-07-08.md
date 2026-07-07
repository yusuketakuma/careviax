---
type: concept
title: Care Report Page Delivery Summary 2026 07 08
ingested_via: put_page
ingested_at: '2026-07-07T19:11:43.518Z'
source_kind: put_page
---

type: PerformanceFinding
title: Care report list delivery summary is page-basis to avoid full-filter DeliveryRecord fan-out
context: PERF-DB-006C removes the extra DeliveryRecord count/groupBy/findMany fan-out from GET /api/care-reports regular list pages.
decision: Build deliverySummary from the already-selected page rows and return basis=page. Do not run full-filter DeliveryRecord aggregate queries for the list response. Keyword mode keeps a separate bounded_keyword_scan_result basis. Keep GET database reads inside withOrgContext and add org_id predicates to DeliveryRecord relation filters/selects.
evidence: src/app/api/care-reports/route.ts buildDeliverySummary(page.data); buildCareReportListSelect({ orgId }); delivery_records.some.org_id; src/app/api/care-reports/route.test.ts PERF-DB-006C and org_id relation-filter contracts
security: No additional PHI is exposed; summary is derived from delivery_records already present in the list row response. No raw recipient/failure detail is added to summary. Care report GET reads now use withOrgContext request metadata, and DeliveryRecord relation filters/selects include org_id.
validity_scope: careviax main as of 2026-07-08, GET /api/care-reports list response
confidence: high
tags: careviax,performance,db-read,care-reports,delivery-summary
