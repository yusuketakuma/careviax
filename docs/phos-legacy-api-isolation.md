# PH-OS Legacy API Isolation

PH-OS v1.1 business APIs are owned by the API Gateway + Lambda manifest in
`src/phos/infra/api-gateway-routes.ts`. They are intentionally not implemented
as Next.js Route Handlers under `src/app/api`. Frontend-facing examples may use
the `/api/phos/*` prefix, but that prefix is an API Gateway/custom-domain base
path, not a Next.js API subtree.

`PHOS_API_BASE_URL` and `createPhosApiClient` must use an absolute API Gateway
origin. Root/stage paths such as `https://api.example.com/prod` are canonical.
An absolute custom-domain mapping such as `https://gateway.example.com/api/phos`
is also valid. Relative same-origin values like `/api/phos` and non-PH-OS
Next.js paths such as `/api/files/*` are not valid PH-OS business API bases.

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
- `/api/files/{id}/download`
- `/api/files/{id}/presigned-download`
- `/api/prescription-intakes`
- `/api/prescription-intakes/{id}`
- `/api/set-plans`
- `/api/set-audits`
- `/api/dispense-tasks`
- `/api/dispense-queue`
- `/api/dashboard/workflow`

## No-Go Rule

Do not add `src/app/api` routes whose App Router path equals or shadows any
canonical PH-OS manifest path, `/phos/*` path, or public `/api/phos/*` path. If
a legacy dashboard route is migrated into PH-OS, add the Lambda route to
`PHOS_API_ROUTES`, remove the obsolete Next route or keep it only as an
explicitly documented non-PH-OS compatibility endpoint, and update the PR-15
no-go gate.

## Legacy File API Production Boundary

The legacy file routes under `/api/files/*` predate PH-OS v1.1. They use the
legacy dashboard S3 object-key layout and are compatibility endpoints only. The
canonical PH-OS evidence upload path is API Gateway + Lambda
`POST /evidence/presign-upload`.

PH-OS production must set `PHOS_DISABLE_LEGACY_FILE_API=1`. The shared boundary
also fails closed whenever `NODE_ENV=production` and no explicit
`PHOS_ENABLE_LEGACY_FILE_API=1` compatibility override is present, so a missing
disable variable does not reopen these routes in a PH-OS production deployment.
With the disable setting or the production default, the legacy routes return
`PHOS_LEGACY_FILE_API_DISABLED` before auth, database lookups, or S3 presign
work:

- `/api/files/presigned-upload`
- `/api/files/complete`
- `/api/files/{id}/download`
- `/api/files/{id}/presigned-download`

`PHOS_ENABLE_LEGACY_FILE_API=1` is reserved for non-PH-OS compatibility
deployments while the old dashboard file workflow is still being retired. It
must not be set for PH-OS production.

No `src/phos` UI, app code, Lambda handler, or contract test may call these
legacy endpoints. If a remaining dashboard workflow needs PH-OS evidence
semantics, migrate the workflow to `POST /evidence/presign-upload` or add a new
Lambda-owned route to `PHOS_API_ROUTES`; do not extend the legacy Next Route
Handlers.
