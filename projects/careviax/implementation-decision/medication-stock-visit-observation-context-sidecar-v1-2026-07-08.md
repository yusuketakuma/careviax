---
type: ImplementationDecision
title: Medication Stock Visit Observation Context Sidecar V1 2026 07 08
confidence: high
source_kind: put_page
ingested_via: put_page
evidence_level: tests
validity_scope: careviax main medication-stock visit observation persistence contract
ingested_at: '2026-07-08T02:32:40.800Z'
tags:
  - careviax
  - medication-stock
  - oracle-reviewed
  - rls
  - stock-ledger
  - visit-observation
---

# Medication Stock visit observation context uses a sidecar table

Implemented the STOCK-001-VISIT-CONTEXT persistence contract as a migration candidate, not a live migration.

Decision:
- Keep MedicationStockEvent as the append-only canonical stock ledger event.
- Store visit-only non-quantity context in a 1:1 MedicationStockObservationContext sidecar keyed by stock_event_id.
- Do not add last_used_at, unobserved_reason_code, or visit_record_id directly to MedicationStockEvent.
- The sidecar stores controlled fields only: observed_date_key_jst, last_used_at, last_used_date_key_jst, last_used_precision, unobserved_reason_code, source_confidence, source_context_code, and confirmation_level.
- The sidecar is tenant scoped, display-id ready, unique on org_id+stock_event_id and org_id+idempotency_key_hash, append-only via update/delete rejection triggers, and protected by FORCE RLS.

Why:
- event_at must remain the observation event timestamp for snapshot folding and must not be reused as last-used time.
- A sidecar preserves ledger canonicality while avoiding JSON/free-text context and keeping visit-specific facts auditable.
- Oracle/GPT-5.5 Pro reviewed with GitHub context and recommended the sidecar approach over direct MedicationStockEvent visit-only columns.

Validation:
- pnpm exec prisma validate --schema=prisma/schema passed.
- Medication Stock DB contract Vitest passed.
- Scoped ESLint, Prettier checks for Plans/STATE/test, and git diff whitespace check passed.

Residual work:
- Do not apply the migration without human migration gate.
- Implement POST /api/visit-records/:id/medication-stock-observations after accepting this contract.
- Add forecast, UI, and downstream risk/task/brief/schedule/report integration later.
