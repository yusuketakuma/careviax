# Inconsistency Findings

Snapshot: 2026-07-02 02:10 JST

## Primary Active Finding

### `INC-LOG-001`: Route-local `safeErrorName` copies remained after shared logger canonicalization

- Severity: medium for PHI/logging boundaries.
- Evidence command:
  `rg -n "SAFE_ERROR_NAMES|safeErrorName" src/app/api src/lib --glob '*.ts'`
- Canonical implementation:
  - `src/lib/utils/logger.ts`
- Completed convergence examples:
  - `src/app/api/comments/route.ts`
  - `src/app/api/communication-requests/[id]/responses/route.ts`
  - `src/app/api/consent-records/route.ts`
  - `src/app/api/billing-evidence/analytics/route.ts`
  - `src/app/api/billing-evidence/stats/route.ts`
  - `src/app/api/billing-evidence/check/route.ts`
  - `src/app/api/staff-workload/route.ts`
  - `src/app/api/tracing-reports/route.ts`
  - `src/app/api/tracing-reports/[id]/route.ts`
  - `src/app/api/cds/check/route.ts`
  - `src/app/api/medication-cycles/[id]/history/route.ts`
  - `src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts`
  - `src/app/api/pharmacy-drug-stocks/bulk/route.ts`
  - `src/app/api/set-batches/[id]/route.ts`
  - `src/app/api/set-batches/route.ts`
  - `src/app/api/set-plans/route.ts`
  - `src/app/api/set-plans/[id]/route.ts`
  - `src/app/api/set-plans/[id]/generate-batches/route.ts`
  - `src/app/api/set-audits/route.ts`
  - `src/app/api/dispense-audits/route.ts`
  - `src/app/api/dispense-results/route.ts`
  - `src/app/api/care-reports/route.ts`
  - `src/app/api/visit-billing-candidates/summary/route.ts`
  - `src/app/api/visit-records/route.ts`
  - `src/app/api/patients/[id]/prescriptions/route.ts`
  - `src/app/api/patients/[id]/prescriptions/e-prescription/route.ts`
  - `src/app/api/dashboard/workflow/route.ts`
  - `src/app/api/dashboard/cockpit/route.ts`
  - `src/app/api/dashboard/medication-deadlines/route.ts`
  - `src/app/api/drug-master-imports/**/route.ts`
  - `src/app/api/drug-masters/**/route.ts`
  - `src/app/api/first-visit-documents/**/route.ts`
  - `src/app/api/inquiry-records/**/route.ts`
  - `src/app/api/medication-issues/route.ts`
  - `src/app/api/medication-profiles/route.ts`
  - `src/app/api/patient-self-reports/route.ts`
  - `src/app/api/residual-medications/route.ts`
- Remaining candidates from current grep:
  - None outside `src/lib/utils/logger.ts`, the canonical shared logger
    implementation.
- Fix direction:
  - For each route family, inspect behavior and tests first.
  - Replace string-overload logging with
    `logger.error({ event, route, method, status }, err)`.
  - Remove route-local `SAFE_ERROR_NAMES` / `safeErrorName`.
  - Preserve auth, DB query, response shape, no-store behavior, audit,
    realtime, notification, and external side effects.
  - Add/adjust sanitized 500 tests and run focused protected-route matrix tests
    when entries exist.

## Other Inconsistency Candidates

- `INC-PATIENT-MEDS-ALLERGY-PROP-NULL-001`: `MedicationsContent` currently
  allows `allergyInfo: null` in its prop type, while the live production
  medications page passes only `patientId` and lets the patient summary query
  supply allergy data. Slice `RR-FE-20260702-A-allergy-false-negative` fixed
  the live false-empty query-error path for `allergyInfo === undefined`, but an
  explicit-null future caller would still bypass the query-error guard and
  render as no allergy data. No such caller exists today. Candidate follow-up:
  confirm the intended component contract, then remove `| null` from the prop
  type or add a targeted explicit-null guard with tests.
- `INC-OBS-001`: cleanup/rollback failure paths should not use empty catches
  when the original API response is intentionally preserved. The
  external-access fallback-audit rollback path is now fixed with the shared
  safe logger warning contract and regression coverage. Patient MCS
  failed-state persistence failures are now fixed with the same contract while
  preserving the original `PatientMcsSyncError`. Visit schedule proposal
  optional pharmacist enrichment failures now use the same safe warning pattern
  while preserving the existing successful detail response and null enrichment
  fallback. Presence heartbeat client delivery failures now use a throttled
  safe warning while preserving best-effort client behavior. Collaboration
  room-token transient failures now use the same safe warning pattern while
  preserving retry/access-denied classification.
- `INC-PRIV-001`: persisted failure messages that flow back through authorized
  patient APIs should not contain unnecessary patient-name-bearing text.
  Patient MCS identity conflict `last_sync_error` now uses fixed
  operator-safe text and focused service coverage proves local/remote
  patient-name sentinels are not persisted.
- `INC-DASHBOARD-SNAPSHOT-001`: workflow route snapshot lagged the current
  workflow-dashboard section href contract. Fixed in the dashboard routes
  logger convergence slice and verified with both the route snapshot test and
  `src/server/services/workflow-dashboard-sections.test.ts`.
- `INC-QP-001`: route-local strict search-param readers duplicate behavior
  around duplicate param rejection, blank handling, padding rejection,
  max-length checks, and field-specific messages.
  `dashboard/medication-deadlines`, `/api/interventions`,
  `/api/medication-issues`, `/api/residual-medications`, and
  `/api/first-visit-documents`, `/api/medication-cycles`,
  `/api/dispense-tasks`, `/api/medication-profiles`,
  `/api/communication-events`, `/api/tasks`, and
  `/api/billing-candidates` now use
  `src/lib/api/search-params.ts`; continue only where exact omitted, blank,
  padded, too-long, duplicate, and field-message semantics match and focused
  tests lock the response. Remaining verified candidates from the current
  scoped grep: none.
- Response helper/no-store convergence remains a periodic scan target, but no
  new unverified candidate is being edited in this artifact-sync slice.
- API path/header helper convergence should continue only where exact URL shape
  and failure behavior can be preserved under tests.
