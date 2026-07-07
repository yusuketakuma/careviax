---
type: PerformanceFinding
title: Inbound Queue Source Gating 2026 07 08
confidence: high
evidence_level: tests-and-typecheck
validity_scope: careviax main as of 2026-07-08
ingested_via: put_page
ingested_at: '2026-07-07T16:43:21.336Z'
source_kind: put_page
tags:
  - careviax
  - communication-queue
  - db-performance
  - inbound-communication
---

# Inbound queue source gating

`listCommunicationQueue()` used to fetch every queue/timeline source before filtering `queueTypes`, so `/api/communications/inbound` with `queueTypes: ['inbound_communication']` still read self reports, callbacks, requests, delivery records, external shares, care reports, tracing reports, emergency draft patient lookup, and medication issues.

Decision: keep default behavior compatible, but add `sourceScope: 'requested'` for callers that explicitly want only the requested queue types. `/api/communications/inbound` now passes `sourceScope: 'requested'` and fetches only inbound events, inbound signals, related task state, and needed patient names.

Related improvement: `/api/care-reports/today-workspace` no longer calls the full communication queue for action-rail inbound evidence. It uses a direct `InboundCommunicationEvent.count` by `org_id` and source channel (`phone`, `fax`, `email`, `mcs`).

Evidence:

- `src/server/services/communication-queue.ts`
- `src/server/services/communication-queue.test.ts`
- `src/app/api/communications/inbound/route.ts`
- `src/app/api/communications/inbound/route.test.ts`
- `src/app/api/care-reports/today-workspace/route.ts`
- `src/app/api/care-reports/today-workspace/route.test.ts`
- Focused Vitest suites passed; scoped ESLint/Prettier/diff-check/full typecheck passed.

Do not use this pattern for callers that need whole communication timeline context or emergency drafts; omit `sourceScope` there to preserve all-source behavior.
