# Dead And Excess Code Findings

Snapshot: 2026-07-02 02:10 JST

## Confirmed And Reduced

The latest room-token client warning slice did not remove material dead code.
It replaced silent transient client failure handling with tested safe logging.

### `DEAD-LOG-001`: Duplicated route-local error-name helper code

- Type: duplicate code / redundant local helper.
- Evidence:
  - Route-local `SAFE_ERROR_NAMES` and `safeErrorName` copies repeated the
    shared logger's safe error-name normalization.
  - Current inventory command:
    `rg -n "SAFE_ERROR_NAMES|safeErrorName" src/app/api src/lib --glob '*.ts'`
- Deleted in recent slices:
  - Comments, communication request responses, consent records,
    drug-master imports, drug masters, first-visit documents, inquiry records,
    medication issues, medication profiles, patient self reports,
    residual medications, dispense verify-barcode, dashboard monthly stats,
    billing-evidence analytics/stats/check, staff-workload, and
    tracing-reports collection/detail, CDS check, medication-cycle history, and
    pharmacy stock usage-mismatch/bulk, set-batches detail/collection, and
    set-plans collection/detail/generate-batches, set-audits,
    dispense-audits, dispense-results, care-reports, and
    visit-billing-candidates summary, visit-records, patient prescription
    routes, and dashboard workflow/cockpit/medication-deadlines routes.
- Remaining:
  - None for this specific route-local `SAFE_ERROR_NAMES` / `safeErrorName`
    pattern outside the canonical shared logger implementation.

### `DEAD-QP-001`: Duplicated medication-deadlines query parsing helpers

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/dashboard/medication-deadlines/route.ts`
- Deleted in latest slice:
  - Route-local `parseSingleSearchParam`.
  - Route-local `parseExactIntegerParam`.
- Replacement:
  - `src/lib/api/search-params.ts` with focused unit coverage.

### `DEAD-QP-002`: Duplicated interventions strict optional filter reader

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/interventions/route.ts`
- Deleted in latest slice:
  - Route-local `readStrictOptionalInterventionFilter`.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts` with
    focused unit coverage and existing interventions route coverage for
    duplicate, blank, padded, and max-length rejection.

### `DEAD-QP-003`: Duplicated medication-issues strict optional filter reader

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/medication-issues/route.ts`
- Deleted in latest slice:
  - Route-local `readStrictOptionalMedicationIssueFilter`.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts`, with
    medication-issues route coverage for duplicate, blank, padded,
    max-length, and unsupported status rejection.

### `DEAD-QP-004`: Duplicated residual-medications and first-visit query filter readers

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/residual-medications/route.ts`
  - `src/app/api/first-visit-documents/route.ts`
- Deleted in latest slice:
  - Route-local `readStrictOptionalIdFilter`.
  - Route-local `readOptionalFirstVisitDocumentFilter`.
  - Unused first-visit filter name alias after helper removal.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts`, with
    first-visit route coverage for duplicate, blank, padded, and max-length
    rejection and residual route coverage expanded to max-length rejection.

### `DEAD-QP-005`: Duplicated medication-cycles strict optional filter reader

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/medication-cycles/route.ts`
- Deleted in latest slice:
  - Route-local `MedicationCycleQueryName`.
  - Route-local `readStrictOptionalMedicationCycleFilter`.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts`, with
    medication-cycles route coverage for duplicate, blank, padded, max-length,
    and unsupported status rejection.

### `DEAD-QP-006`: Duplicated dispense-tasks strict optional filter reader

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/dispense-tasks/route.ts`
- Deleted in latest slice:
  - Route-local `DispenseTaskQueryName`.
  - Route-local `readStrictOptionalDispenseTaskFilter`.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts`, with
    dispense-tasks route coverage for duplicate, blank, padded, max-length, and
    unsupported status rejection.

### `DEAD-QP-007`: Duplicated medication-profiles strict optional patient filter reader

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/medication-profiles/route.ts`
- Deleted in latest slice:
  - Route-local `readStrictOptionalPatientFilter`.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts`, with
    medication-profiles route coverage for omitted, duplicate, blank, padded,
    and max-length rejection. Route-local `is_current` parsing remains because
    it has boolean-specific semantics.

### `DEAD-QP-008`: Duplicated communication-events strict optional filter reader

- Type: duplicate code / redundant local helper.
- Evidence:
  - `src/app/api/communication-events/route.ts`
- Deleted in latest slice:
  - Route-local `readStrictOptionalCommunicationEventFilter`.
- Replacement:
  - `readStrictOptionalSearchParam` in `src/lib/api/search-params.ts`, with
    communication-events route coverage for omitted, duplicate, blank, padded,
    and max-length rejection for `patient_id` / `event_type`.

## Deletion Rules

Before deleting any code outside this duplicated-helper pattern:

- confirm static references with `rg`;
- check dynamic import/config/route/script references;
- check tests, docs, and public API exposure;
- preserve generated code and future-intent code unless clearly obsolete;
- record evidence and validation in `REFACTOR_LOG.md`.

## Flagged / Not Yet Proven

- No unrelated dead export, dependency, or public API removal is proven in this
  artifact-sync slice.
- Full dead-code scanning remains a later loop after the logger convergence
  inventory is exhausted or no longer high value.
