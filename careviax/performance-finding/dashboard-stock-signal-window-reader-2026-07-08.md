---
type: PerformanceFinding
title: Dashboard Stock Signal Window Reader 2026 07 08
confidence: high
captured_at: '2026-07-07T16:55:08.512Z'
ingested_at: '2026-07-07T16:55:09.811Z'
source_kind: put_page
captured_via: capture-cli
ingested_via: put_page
evidence_level: tests
validity_scope: careviax main as of 2026-07-08
tags:
  - careviax
  - dashboard
  - db-performance
  - medication-stock
---

# Dashboard stock signal window reader

`/api/dashboard/cockpit/stock-risks` previously read inbound medication-stock signals with one
`findMany()` plus six separate `count()` calls for total, urgent, shortage, usage, equivalence,
and linked-to-stock counts.

Decision: keep the existing `withOrgContext` and app-layer assignment scope, but move the signal
stock-risk read to `readDashboardMedicationStockSignalRisks()`. The reader uses a single bounded
`tx.$queryRaw` window aggregate query, joins `InboundCommunicationSignal` to
`InboundCommunicationEvent`, and returns the visible rows plus count metadata.

Safety constraints:

- Scope remains on `signal.patient_id` / `signal.case_id`; do not broaden to event fallback in this
  performance slice.
- Empty restricted assignment scope returns zeros without querying.
- The query selects only dashboard-safe signal fields and event summary metadata.
- Do not select or pass through inbound raw text, sender contact/name, external URLs, attachment data,
  storage keys, or structured payloads.

Evidence:

- `src/modules/pharmacy/medication-stock/application/dashboard-stock-risk-reader.ts`
- `src/modules/pharmacy/medication-stock/application/dashboard-stock-risk-reader.test.ts`
- `src/server/services/dashboard-cockpit.ts`
- `src/app/api/dashboard/cockpit/route.test.ts`
- Focused Vitest for the stock risk reader and dashboard cockpit route passed.

Do not use this helper for the dashboard details urgent queue. That path intentionally still reads
reviewed actionable medication-stock apply waits and has separate `DashboardUrgentItem` behavior.
