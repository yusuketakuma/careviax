# Refactor Plan

Snapshot: 2026-07-02 02:10 JST

## Active Objective

Continue the repo-wide behavior-preserving refactor loop. Keep each slice small,
tested, and reversible. Do not shrink the objective to the latest green slice.

## Completed Current Theme

- Shared logger raw-error hardening.
- Dashboard monthly-stats logger convergence.
- Patient self reports logger convergence.
- Inquiry records logger convergence.
- Medication issues logger convergence.
- Medication profiles logger convergence.
- Residual medications logger convergence.
- First-visit documents logger convergence.
- Dispense verify-barcode logger convergence.
- Drug masters logger convergence.
- Drug-master imports logger convergence.
- Consent records logger convergence.
- Communication request responses logger convergence.
- Comments logger convergence.
- Billing evidence analytics/stats/check logger convergence.
- Staff-workload logger convergence.
- Tracing-reports collection logger convergence.
- Tracing-reports detail logger convergence.
- CDS check logger convergence.
- Medication-cycle history logger convergence.
- Pharmacy stock usage-mismatch logger convergence.
- Pharmacy stock bulk logger convergence.
- Set-batches detail logger convergence.
- Set-batches collection logger convergence.
- Set-plans collection logger convergence.
- Set-plans detail logger convergence.
- Set-plans generate-batches logger convergence.
- Set-audits logger convergence.
- Dispense-audits logger convergence.
- Dispense-results logger convergence.
- Care-reports logger convergence.
- Visit-billing-candidates summary logger convergence.
- Visit-records logger convergence.
- Patient prescription logger convergence.
- Dashboard workflow/cockpit/medication-deadlines logger convergence.
- Workflow dashboard route snapshot contract sync with the current
  workflow-dashboard section href builders.
- Dashboard medication-deadlines exact search-param helper convergence.
- Interventions strict optional query-param helper convergence.
- Medication-issues strict optional query-param helper convergence.
- Residual-medications and first-visit-documents strict optional query-param
  helper convergence.
- Medication-cycles strict optional query-param helper convergence.
- Dispense-tasks strict optional query-param helper convergence.
- Redis realtime subscription race fix.
- Medication-history bulk-export background drain warning fix.
- Notification realtime broadcast warning fix.
- Voice memo manual transcript local-save warning fix.
- Presence realtime broadcast warning fix.
- External-access fallback-audit rollback warning fix.
- Patient MCS failed-state persistence warning and identity-conflict
  `last_sync_error` privacy fix.
- Visit schedule proposal detail pharmacist enrichment warning fix.
- Presence heartbeat client failure warning fix.
- Collaboration room-token client transient failure warning fix.

Each completed code slice had focused Vitest coverage, scoped formatting/lint
checks, full type/lint/format/diff gates, and production build evidence.

## Next Candidate Queue

1. Continue bug-hunt for boolean-return persistence helpers, empty catch,
   unhandled rejection, stale listener, persisted-error privacy leaks, or query
   inefficiency evidence.
   - Category: bug fix / correctness / observability.
   - Target: current production code paths with focused tests available.
   - Reason: the latest bug-fix slices found real issues in async failure
     handling where failure was represented as an empty catch, rejected
     fire-and-forget promise, boolean `false` result, or persisted failure
     message with unnecessary sensitive text.
   - Risk: medium because UI-visible warning behavior must not be confused with
     broader workflow or route-contract changes.

2. Continue exact query-param helper convergence only where semantics match.
   - Category: inconsistency / duplicate helper removal.
   - Target: route-local strict optional single-param readers and exact
     integer parsers.
   - Reason: `dashboard/medication-deadlines` proved the reusable helper shape
     while preserving duplicate-param, empty, padded, and range validation;
     `interventions`, `medication-issues`, `residual-medications`, and
     `first-visit-documents` extended it to blank/padded/max-length
     field-error semantics, and `medication-cycles` now preserves the same
     behavior before its status enum validation. `dispense-tasks` now preserves
     the same behavior for status/cycle/assignee filters before its status enum
     validation.
   - Risk: medium because several routes intentionally differ on trimming,
     blank handling, and error messages.

## Later Loops

- Re-audit for dead exports, unused dependencies, and duplicate helper patterns
  after logger convergence no longer yields high-value candidates.
- Re-audit backend query paths for obvious N+1/unbounded query issues with
  tests or measurements before changes.
- Run at least two zero-actionable re-audits before claiming objective
  completion.
