---
type: ImplementationDecision
title: Medication Stock Visit Observation API V1 2026 07 08
date: '2026-07-08T00:00:00.000Z'
confidence: high
evidence_level: tested
validity_scope: careviax main after visit stock observation API slice
ingested_via: put_page
ingested_at: '2026-07-08T03:13:17.024Z'
source_kind: put_page
tags:
  - api-contract
  - careviax
  - idempotency
  - medication-stock
  - tenant-safety
  - visit-record
---

# Medication Stock Visit Observation API V1

## Decision

Implement `POST /api/visit-records/:id/medication-stock-observations` as the v1 visit-record write path for pharmacist-entered external/topical/PRN stock observations.

The API uses:

- `withAuthContext(..., { permission: 'canVisit' })` at the route boundary.
- A service-level pharmacist write role gate: `owner | admin | pharmacist`; trainee roles fail closed for stock ledger writes.
- `withOrgContext(..., { isolationLevel: Serializable, requestContext })` for tenant-scoped DB writes.
- `canWriteVisitRecordForSchedule` against the visit record's schedule/case assignment.
- Append-only `MedicationStockEvent(event_type='visit_observation')` plus `MedicationStockObservationContext` sidecar rows.
- `Idempotency-Key` plus `client_observation_id` scoped idempotency hashes. `stock_item_id` stays in the clinical request fingerprint so retries with a changed item conflict instead of creating another observation.
- Controlled `MedicationStockVisitObservationKind`, including `refill_request`, to avoid collapsing refill requests into generic no-quantity events.
- Public module entrypoint imports from `@/modules/pharmacy` for app/api routes; no module-boundary allowlist was added.

## Verification

- `pnpm exec prisma validate --schema=prisma/schema/`: passed.
- Focused Vitest pack covering service, route, DB contract, route catalog, rate limit, protected POST matrix, display_id, existing inbound/medication-stock routes: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`: passed.
- `pnpm boundaries:check`: passed with 0 allowlisted debt imports.
- `pnpm route-auth-wrapper:check`: passed.
- `pnpm api-response-shape:check`: passed with allowlist reduced to 241 violations.
- `git diff --check`: passed.

## Notes

Oracle browser consultation was attempted for this high-risk auth/tenant/PHI/idempotency slice, but the browser engine session failed with `setTypeOfService EINVAL` and produced no advisory response. Implementation proceeded conservatively with local inspection, GPT-5.5 subagent reviews, and focused validation.

Migration application remains human-gated. This decision describes source/schema/migration candidate implementation only.
