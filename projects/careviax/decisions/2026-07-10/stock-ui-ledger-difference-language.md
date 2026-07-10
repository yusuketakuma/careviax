---
type: ImplementationDecision
title: Clarify visit stock ledger differences as non-measurement
task_id: STOCK-001-VISIT-UI
memory_id: projects/careviax/decisions/2026-07-10/stock-ui-ledger-difference-language
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 81f1ec532
superseded_by: null
evidence_level: gate_verified
reviewer_agent: stock-delta-verifier
validity_scope:
  repo: careviax
  files:
    - >-
      src/components/features/visits/visit-medication-stock-observation-panel.tsx
    - >-
      src/components/features/visits/visit-medication-stock-observation-panel.test.tsx
    - src/modules/pharmacy/medication-stock/application/stock-snapshot.test.ts
    - tools/tests/ui-route-mocked-smoke.spec.ts
  directories:
    - src/components/features/visits
    - src/modules/pharmacy/medication-stock/application
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-10T02:26:54.393Z'
source_kind: put_page
tags:
  - accepted
  - accessibility
  - patient-safety
  - pharmacy-stock
  - visit-ui
---

# Clarify visit stock ledger differences as non-measurement

## Problem

- summary: The read-only visit stock card called the prior recorded quantity a measurement and did not distinguish it from the ledger-calculated quantity or their difference.
- evidence: src/components/features/visits/visit-medication-stock-observation-panel.tsx; the stock snapshot keeps prior recorded quantity and a calculated current quantity.

## Decision

- adopted: Show prior recorded quantity, reference ledger-calculated quantity with JST calculation timestamp, and prior-record-to-ledger difference.
- reason: The source provenance does not prove a physical measurement. The difference is not usage, and may be positive after replenishment. Render finite values only; otherwise show unavailable. Use text labels for increase, decrease, and no change.

## Alternatives rejected

- Keep prior measurement wording and an unlabeled current estimate — rejected because it can overstate evidence and conceal the semantic difference.
- Add a new write flow or enable the feature gate — rejected because migration and live DB evidence remain human-gated.

## Migration

- from: previous measurement and current estimate labels → prior record, reference ledger calculation, and ledger difference labels.

## Verification

- Targeted Vitest: 6 files and 75 tests passed.
- Local Playwright with the release gate off: Chromium and mobile Chromium passed 2 of 2.
- Exact-path ESLint, Prettier, and git diff check passed.

## Review

- reviewer: stock_delta_mapper, stock_delta_safety, stock_delta_verifier · result: GO, conditional GO resolved, PASS 0.96.

## Future rule candidate

- Do not label stock ledger values as physical measurements without provenance; surface calculation time and unavailable state explicitly.

## Links

- canonical: [[file:src/components/features/visits/visit-medication-stock-observation-panel.tsx]]
- verification: [[projects/careviax/gates/2026-07-10/stock-001-visit-ui-gate-off]]
