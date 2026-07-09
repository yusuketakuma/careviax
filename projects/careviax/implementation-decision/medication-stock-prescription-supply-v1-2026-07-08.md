---
type: ImplementationDecision
title: Medication Stock Prescription Supply V1 2026 07 08
confidence: high
evidence_level: tests
validity_scope: careviax main medication-stock prescription intake post-create hook
ingested_via: put_page
ingested_at: '2026-07-08T01:16:21.800Z'
source_kind: put_page
tags:
  - careviax
  - medication-stock
  - oracle-reviewed
  - prescription-supply
  - stock-ledger
---

# Medication Stock prescription supply v1 exact-only apply

Implemented STOCK-001-PRESCRIPTION v1 in CareViaX.

- Prescription creation post-hooks now best-effort apply supply lines to Medication Stock Ledger only when there is exact DrugMaster identity, exactly one existing active stock item, matching unit, and positive quantity.
- YJ/HOT/receipt/DrugMaster identity can auto-apply; GS1/GTIN/JAN/package-only, name-only, no candidate, ambiguous candidate, unsupported unit, unit mismatch, and invalid quantity create pharmacy.medication_stock_unlinked_prescription_supply review tasks instead.
- Review task metadata is PHI-minimized to ids, reason_code, candidate_count, and boolean evidence axes.
- Snapshot recalculation was extracted into shared stock-snapshot.ts.
- Oracle/GPT-5.5 Pro reviewed with GitHub context and recommended exact-only post-commit best-effort behavior, no auto item creation, and no raw drug/patient/dose text in metadata.
- Validation: focused medication-stock and prescription-intake Vitest passed, scoped ESLint/Prettier/diff check passed, full typecheck passed.

Residual work: manual retry API, DrugPackage/GS1 quantity conversion, review-task apply flow, route integration tests.
