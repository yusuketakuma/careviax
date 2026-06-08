# PH-OS Legacy API Isolation

PH-OS v1.1 business APIs are owned by the API Gateway + Lambda manifest in
`src/phos/infra/api-gateway-routes.ts`. They are intentionally not implemented
as Next.js Route Handlers under `src/app/api`.

## Canonical PH-OS API Gateway Surface

- `/cards`
- `/cards/{card_id}`
- `/cards/{card_id}/actions`
- `/capacity`
- `/claim-candidates`
- `/claim-candidates/{candidate_id}/exclude`
- `/fee-rules`
- `/visit-packets/{packet_id}/visit-mode`
- `/visit-packets/{packet_id}/visit-steps/{step}`
- `/evidence/presign-upload`
- `/handoffs`
- `/handoffs/{handoff_id}/open`
- `/handoffs/{handoff_id}/resolve`
- `/handoffs/{handoff_id}/return`
- `/report-deliveries`
- `/report-deliveries/{delivery_id}/reply`
- `/report-deliveries/{delivery_id}/action-done`

## Current Legacy Next API Debt

These routes are legacy dashboard or operational APIs. They may support older
workflows that overlap PH-OS product concepts, but they are not the canonical
PH-OS v1.1 API boundary and must not be called from `src/phos` UI/app code.

- `/api/handoff-board`
- `/api/handoff-board/items`
- `/api/handoff-board/items/{id}/read`
- `/api/visit-records`
- `/api/visit-records/{id}`
- `/api/visit-records/{id}/handoff`
- `/api/visit-records/{id}/handoff/extract`
- `/api/visit-preparations/{scheduleId}`
- `/api/visit-schedules`
- `/api/visit-routes`
- `/api/facility-visit-batches`
- `/api/care-reports`
- `/api/care-reports/{id}`
- `/api/care-reports/{id}/send`
- `/api/care-reports/{id}/pdf`
- `/api/care-reports/generate-from-visit`
- `/api/tracing-reports`
- `/api/billing-candidates`
- `/api/billing-candidates/{id}`
- `/api/billing-candidates/close`
- `/api/billing-rules`
- `/api/billing-rules/{id}`
- `/api/billing-evidence/analytics`
- `/api/billing-evidence/stats`
- `/api/files/presigned-upload`
- `/api/files/complete`
- `/api/prescription-intakes`
- `/api/prescription-intakes/{id}`
- `/api/set-plans`
- `/api/set-audits`
- `/api/dispense-tasks`
- `/api/dispense-queue`
- `/api/dashboard/workflow`

## No-Go Rule

Do not add `src/app/api` routes whose App Router path equals or shadows any
canonical PH-OS manifest path. If a legacy dashboard route is migrated into
PH-OS, add the Lambda route to `PHOS_API_ROUTES`, remove the obsolete Next route
or keep it only as an explicitly documented non-PH-OS compatibility endpoint,
and update the PR-15 no-go gate.
