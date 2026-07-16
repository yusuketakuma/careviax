---
type: ImplementationDecision
title: Require exact DrugPackage identity for prescription supply conversion
task_id: STOCK-001-PRESCRIPTION-FOLLOWUP-001B
memory_id: projects/careviax/decisions/2026-07-17/exact-drug-package-supply-conversion
confidence: high
created_by: codex-lead
dedupe_key: careviax-implementationdecision-exact-drug-package-prescription-supply
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 7617915af
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - >-
      src/modules/pharmacy/medication-stock/application/apply-prescription-supply.ts
  directories:
    - src/modules/pharmacy/medication-stock/application
ingested_via: put_page
ingested_at: '2026-07-16T20:42:23.710Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - drug-package
  - gs1
  - gtin
  - idempotency
  - pharmacy-stock
---

# Require exact DrugPackage identity for prescription supply conversion

## Problem

- summary: Package-only GTIN or JAN prescription lines could not replenish medication stock, while inferring across packaging levels would risk applying the wrong quantity.
- evidence: src/modules/pharmacy/medication-stock/application/apply-prescription-supply.ts, Plans.md STOCK-001-PRESCRIPTION-FOLLOWUP.

## Decision

- adopted: Resolve all package codes in one active and effective DrugPackage query, require one sales-level row, convert explicit sales-package counts with package_quantity, and require the stock item to carry the same drug_package_id.
- reason: GS1 assigns distinct identities to packaging levels; exact package linkage preserves quantity and idempotency boundaries.

## Alternatives rejected

- Resolve only DrugMaster from GTIN or JAN and apply to any stock item for that drug — rejected because packaging quantity and hierarchy would be ambiguous.
- Round converted quantities to four decimals — rejected because silent rounding would mutate clinical stock data.

## Migration

- from: Package-only identity always created a review task.
- to: Exact sales-package evidence auto-applies; ambiguous, missing, invalid, unsupported, or package-mismatched evidence remains review-only.

## Verification

- `pnpm vitest run` related 3 files / 111 tests, `pnpm typecheck`, targeted ESLint and Prettier passed.

## Review

- reviewer: codex-lead; result: focused diff and regression self-review passed, independent seat review remains available at integration boundary.

## Future rule candidate

- Never infer medication package quantity across GTIN packaging levels; require an exact package row and package-linked stock item.

## Links

- canonical: [[file:src/modules/pharmacy/medication-stock/application/apply-prescription-supply.ts]]
