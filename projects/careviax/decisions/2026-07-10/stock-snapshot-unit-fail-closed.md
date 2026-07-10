---
type: ImplementationDecision
title: Fail closed on mismatched visit stock snapshot units
task_id: STOCK-001-VISIT-UI
memory_id: projects/careviax/decisions/2026-07-10/stock-snapshot-unit-fail-closed
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: cad4b8fc2
superseded_by: null
evidence_level: gate_verified
reviewer_agent: snapshot-unit-verifier
validity_scope:
  repo: careviax
  files:
    - >-
      src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.ts
    - >-
      src/components/features/visits/visit-medication-stock-observation-panel.tsx
    - src/types/medication-stock.ts
  directories:
    - src/modules/pharmacy/medication-stock/application
    - src/components/features/visits
    - src/types
    - tools/tests
ingested_via: put_page
ingested_at: '2026-07-10T02:45:25.048Z'
source_kind: put_page
tags:
  - accepted
  - api-contract
  - data-integrity
  - patient-safety
  - pharmacy-stock
---

# Fail closed on mismatched visit stock snapshot units

## Problem

- summary: The visit medication-stock summary selected snapshot unit but emitted its quantities and risks using the stock item unit without validating equality.
- evidence: src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.ts and src/components/features/visits/visit-medication-stock-observation-panel.tsx.

## Decision

- adopted: Preserve the stock item, but classify its snapshot as available, missing, or unit mismatch. A mismatch emits snapshot null and exposes no snapshot quantity, date, risk, reason, or raw unit.
- reason: Unit conversion or normalization cannot be assumed for legacy or corrupt data. The visit UI shows a pharmacist verification message and defensively ignores a hostile mismatched response even if it includes a snapshot.

## Alternatives rejected

- Re-label snapshot values with the item unit — rejected because it can misstate clinical stock quantities.
- Omit the whole item or fail the whole response — rejected because it would hide valid neighboring data and create false empty states.
- Convert units automatically — rejected because no approved conversion policy is available.

## Migration

- from: unchecked snapshot unit → exact per-item unit equality plus fail-closed snapshot status.

## Verification

- Focused Vitest: 7 files and 79 tests passed.
- Local gate-off Playwright: Chromium and mobile Chromium passed 4 of 4.
- Exact-path ESLint, Prettier, and git diff check passed.
- Typecheck generated route types and showed only the pre-existing unrelated inbound TS2322 after the fixture type correction.

## Review

- reviewer: snapshot_unit_mapper, snapshot_unit_safety, snapshot_unit_verifier · result: conditional GO resolved for visit summary and panel; dashboard raw reader remains separately tracked.

## Future rule candidate

- When a stored quantity carries a unit, compare it with the display item unit before emitting or aggregating values; do not infer conversion.

## Links

- canonical: [[file:src/modules/pharmacy/medication-stock/application/patient-medication-stock-summary.ts]]
- related_dashboard_reader: [[careviax/implementation-decision/dashboard-stock-snapshot-risk-reader-2026-07-07]]
