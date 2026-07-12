# Scan Log

## 2026-07-12 — API contract residual scan

- Scope: business-holidays API route, business-holidays admin consumer/tests, shifts consumer/tests, client-schema allowlist, package/CI/build configuration, current Git/Plans/STATE.
- Finding: two frontend list readers trusted compile-time casts; provider has inclusive date bounds and a bounded `limit` without count metadata.
- Classification: `CONTRACT_DRIFT` / `PARTIAL` under `API-CONTRACT-001`; no backend-only or frontend-only feature detected for this slice.
- Implemented: consumed runtime schema, org/date/site/order/identity/cap checks, bounded readers, allowlist ratchet, regression tests.
- Next scan: rescan remaining API-CONTRACT allowlist entries and the patients board cursor residual after this group lands.

## 2026-07-12 — API-CONTRACT-001FZJOBLISTSTRICT

- Scope: `/api/jobs` provider DTO, admin/jobs consumer/test, client-schema allowlist, Next package/build gates, current Git/Plans/STATE.
- Finding: one admin/jobs list reader trusted a compile-time cast despite a fixed 33-definition provider payload containing latest run/export records and redacted error summaries.
- Classification: `CONTRACT_DRIFT` under `API-CONTRACT-001`; provider already bounded/redacted and no backend-only gap was found.
- Implemented: consumed runtime schema with strict root, unique definitions, endpoint/job identity, latest-run/export relation, supported status, count/timestamp bounds, fixed error message, regression, and allowlist ratchet.
- Verification: focused 2 files / 16 tests, all relevant static/type/lint/diff gates, and serialized Next build passed.
- Next scan: after landing, rescan remaining API-CONTRACT allowlist entries and the patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZSTAFFMETRICSSTRICT selection

- Scope: client-schema allowlist, `src/app/(dashboard)/admin/staff/staff-kpi-panel.tsx`, `/api/admin/staff-metrics`,
  consumer/provider tests, and existing staff-metrics path helper.
- Candidate ranking: selected the one-reader admin staff KPI path as a disjoint, low-blast-radius administrative
  contract slice; deferred billing, patient/visit, inventory, and pharmacy-master candidates with broader controlled
  data impact.
- Finding: the provider returns `{ data: { month, summary, items } }`, while the consumer uses a compile-time cast and
  retains provider-only email/capacity fields in the inferred response type.
- Planned fix: expected-month strict envelope, summary/item identity and arithmetic checks, UI-consumed field projection,
  malformed/wrong-month regressions, and one allowlist ratchet removal. Provider/DB/auth/mutation behavior stays fixed.
- Landed: implementation commit `6e1454401` passed 2 files / 16 focused tests, all contract/type/lint/diff gates, and
  serialized Next build; client-schema inventory moved to 163 schema-backed / 210 allowlisted / 86 files. Next scan:
  remaining API-CONTRACT allowlist entries and patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZOPSINSIGHTSTRICT selection

- Scope: client-schema allowlist, `src/app/(dashboard)/admin/operations-insights/operations-insights-content.tsx`,
  `/api/admin/operations-insights`, analytics helper types/tests, and consumer tests.
- Candidate ranking: selected the one-reader aggregate operations path as a disjoint administrative slice; deferred
  billing, patient/visit, inventory, pharmacy-master, and audit candidates with broader controlled-data impact.
- Finding: the provider returns five-month visit buckets, process durations, and generated hints; the consumer uses a
  compile-time cast and derives trend/bottleneck state from bucket order and numeric values.
- Baseline: focused consumer/helper suites pass 2 files / 12 tests; client-schema is 163 schema-backed / 210 allowlisted
  / 86 files.
- Planned fix: strict envelope, chronological/unique bucket checks, process identity/duration bounds, hint bounds,
  malformed 2xx regressions, and one allowlist ratchet removal. Provider/DB/auth/UI behavior stays fixed.
- Landed: implementation commit `47fcaf80f` passed 2 files / 14 focused tests, all contract/type/lint/diff gates, and
  serialized Next build; client-schema inventory moved to 164 schema-backed / 209 allowlisted / 85 files. Next scan:
  remaining API-CONTRACT allowlist entries and patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZSITESELECTREADSTRICT selection

- Scope: client-schema allowlist, `src/app/(dashboard)/select-site/select-site-content.tsx`, `/api/me/sites`, and the
  select-site consumer test.
- Candidate ranking: selected the one-reader site list as a low-conflict navigation-data slice; the existing PUT switch
  acknowledgement and provider membership/auth semantics are already hardened and remain untouched.
- Finding: provider returns `{ data, meta.limit, meta.has_more }`, while `fetchMySites` trusts a data-only compile-time
  cast and the UI derives current site, totals, and switch cards from the result.
- Baseline: focused select-site consumer suite passes 1 file / 4 tests; client-schema is 164 schema-backed / 209
  allowlisted / 85 files.
- Planned fix: strict `{ data, meta }` schema, unique/current site identity and count checks, pagination relation,
  malformed/legacy 2xx regressions, and one allowlist ratchet removal. Provider/PUT/auth/UI behavior stays fixed.
- Landed: implementation commit `053b48c74` passed 1 file / 6 focused tests, all contract/type/lint/diff gates, and
  serialized Next build; client-schema inventory moved to 165 schema-backed / 208 allowlisted / 84 files. Next scan:
  remaining API-CONTRACT allowlist entries and patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZNOTIFICATIONSREADSTRICT selection

- Scope: client-schema allowlist, `src/app/(dashboard)/notifications/notifications-content.tsx`,
  `/api/notifications`, notification stream types, and consumer/provider tests.
- Candidate ranking: selected the one-reader notification inbox as a disjoint bounded contract slice; deferred patient,
  billing, inventory, and multi-reader candidates with broader controlled-data impact.
- Finding: the provider returns `{ data, meta.limit, meta.has_more, meta.next_cursor }`, while the consumer uses a
  data-only compile-time cast and can route directly from persisted notification links.
- Baseline: focused notifications consumer/provider suites pass 2 files / 24 tests; client-schema is 165 schema-backed
  / 208 allowlisted / 84 files.
- Planned fix: strict list/meta schema, identity/type/content/date/read/link checks, provider-field stripping, cursor
  relation invariants, malformed/legacy/unsafe-link regressions, and one allowlist ratchet removal. PATCH, SSE-safe
  redaction, org authorization, provider query, and visual semantics stay fixed.
- Landed: implementation commit `64ccfd492` passed 2 files / 29 focused tests, all contract/type/lint/diff gates, and
  serialized Next build; client-schema inventory moved to 166 schema-backed / 207 allowlisted / 83 files. Next scan:
  remaining API-CONTRACT allowlist entries and patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZFACILITYUNITSSTRICT selection

- Scope: facilities consumer allowlist, `src/app/(dashboard)/admin/facilities/facilities-content.tsx`,
  `/api/admin/facilities/[id]/units`, and consumer/provider tests.
- Candidate ranking: selected the one-reader facility-unit list because the facility list already has a schema-backed
  reader and the provider projects eight unit fields; deferred billing, patient-detail, inventory, and mutation-heavy
  candidates with broader controlled-data impact.
- Finding: the unit provider returns `{ data }` with patient counts, while the facility editor trusts a data-only
  compile-time cast before rendering occupancy and editing state.
- Baseline: focused facilities consumer/unit-provider suites pass 2 files / 22 tests; client-schema is 166
  schema-backed / 207 allowlisted / 83 files.
- Planned fix: strict unit envelope, identity/type/text/numeric checks, unique IDs, malformed/legacy/duplicate
  regressions, and one allowlist ratchet removal. Facility/unit mutations, patient-count aggregation, authz, and visual
  semantics stay fixed.
- Landed: implementation commit `bde744e93` passed 2 files / 25 focused tests, all contract/type/lint/diff gates, and
  serialized Next build; client-schema inventory moved to 167 schema-backed / 206 allowlisted / 82 files. Next scan:
  remaining API-CONTRACT allowlist entries and patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZNOTIFICATIONBELLSTRICT selection

- Scope: notification-bell allowlist, `src/components/features/notifications/notification-bell.tsx`, shared notification
  response schemas, and notification-bell fetch tests.
- Candidate ranking: selected the one-file notification badge/drawer reader because the list schema is already landed and
  the summary endpoint is a bounded unread-count response; deferred medical, billing, external-share, and mutation-heavy
  readers with broader controlled-data impact.
- Finding: the bell summary and drawer refreshes use compile-time optional payload casts despite provider current shapes;
  malformed values can silently reset or populate badge/drawer state.
- Baseline: focused notification-bell suites pass 2 files / 9 tests; client-schema is 167 schema-backed / 206 allowlisted
  / 82 files.
- Planned fix: strict summary count schema, reuse strict notification list schema, malformed/legacy/negative/unsafe-link
  regressions, and one allowlist ratchet removal. PATCH, SSE-safe redaction, OS notification minimization, provider/auth,
  and visual semantics stay fixed.

- Landed: `notificationSummaryResponseSchema` and the shared `notificationsResponseSchema` now guard both refresh
  readers; focused suites pass 2 files / 12 tests; static/type/no-unused/lint/diff/build gates pass; client-schema
  inventory moved to 168 schema-backed / 205 allowlisted / 81 files. Commit `8a9956f0d` is pushed. Next scan: remaining
  API-CONTRACT allowlist entries and patients board cursor residual.

## 2026-07-12 — API-CONTRACT-001FZINSTITUTIONSSTRICT selection

- Scope: `src/app/(dashboard)/admin/institutions/institutions-content.tsx`, prescriber-institutions response schema,
  institutions consumer/provider tests, and the one matching client-schema allowlist entry.
- Candidate ranking: selected the bounded one-entry admin master-data reader after the notification-bell landing; deferred
  billing analytics, document-delivery/external communication, medical patient detail, and mutation-heavy readers with
  broader controlled-data or outbound side effects.
- Finding: the provider returns `{ data }` for an unfiltered full list and `{ data, meta: { limit, has_more } }` for a
  bounded `q` search, while the consumer trusts a compile-time `{ data: Institution[] }` cast and retains provider-only
  fields. Invalid identity/contact/usage/date state or pagination drift can affect authorized table/edit state.
- Baseline: focused institutions consumer/provider suites pass 2 files / 38 tests; client-schema is 168 schema-backed /
  205 allowlisted / 81 files.
- Planned fix: strict institution item schema, union root for unfiltered/filtered provider shapes, duplicate/count/date/page
  invariants, provider-field stripping, malformed/legacy/duplicate/negative/invalid-date regressions, and one allowlist
  ratchet removal. POST/PATCH/DELETE, provider/auth, and visual semantics stay fixed.

- Landed: shared institution item/root schemas now guard both provider list shapes; focused suites pass 2 files / 43 tests;
  static/type/no-unused/lint/diff/build gates pass; client-schema inventory moved to 169 schema-backed / 204 allowlisted /
  80 files. Commit `f906abede` is pushed. Next scan: remaining API-CONTRACT allowlist entries and patients board cursor
  residual.

## 2026-07-12 — API-CONTRACT-001FZMASTERHUBSTRICT selection

- Scope: `src/app/(dashboard)/admin/master-hub-content.tsx`, master-hub response schema, master-hub consumer/provider tests,
  and the one matching client-schema allowlist entry.
- Candidate ranking: selected the single admin aggregate reader after the packaging-method landing; deferred billing,
  audit, contact/external/document delivery, inventory/medication, patient/visit, and shared-token readers with broader
  PHI, audit, or outbound-data impact.
- Finding: the provider returns 11 master cards plus a right rail under `{ data }`, while the consumer trusts a compile-time
  `MasterHubResponse` cast. Legacy roots, missing/duplicate keys, invalid status/count/action/date state, unsafe hrefs, and
  malformed blocked reasons can affect authorized freshness/action state.
- Baseline: focused master-hub consumer/provider suites pass 2 files / 15 tests; client-schema is 170 schema-backed /
  203 allowlisted / 79 files.
- Planned fix: strict exact card/rail schemas, key completeness/status-count/number/href invariants, provider-field
  stripping, malformed/legacy/duplicate/negative/unsafe/incomplete regressions, and one allowlist ratchet removal.
  Aggregate provider/auth, authorized disclosure, and visual semantics stay fixed.

## 2026-07-12 — API-CONTRACT-001FZMASTERHUBSTRICT implementation checkpoint

- Implementation: added `src/lib/master-hub/response-schema.ts`, connected `master-hub-content.tsx` to a strict `{ data }`
  envelope, and removed the single master-hub client JSON schema allowlist entry.
- Safety contract: exact 11-card key set, duplicate/completeness checks, bounded non-negative card/rail values, valid
  timestamps, status-count relation, internal action hrefs, bounded text, and provider-only nested-field stripping now
  guard freshness/action state. Existing aggregate provider, auth, authorized in-app detail, and visual behavior are unchanged.
- Tests: focused master-hub consumer/provider suites pass 2 files / 20 tests; regressions cover provider-only fields,
  legacy root, duplicate/incomplete keys, negative count/status drift, unsafe href, and negative rail age.
- Validation: static gates, typecheck, no-unused typecheck, lint, diff-check, and Next build pass; inventory is 171
  schema-backed / 202 allowlisted / 78 files. Implementation commit is pending scoped landing.

## 2026-07-12 — API-CONTRACT-001FZMASTERHUBSTRICT landed

- Commit: `20d75daeb` pushed to `origin/agent/continuous-improvement-20260712`; parity is `0 0`.
- Result: master-hub strict aggregate reader, regressions, allowlist ratchet, and validation ledgers landed; unrelated
  harness-memory and personal untracked artifacts remain excluded.
- Next scan: rerun `pnpm client-json-schema:check`, inspect remaining one-entry and multi-entry consumers plus the
  patients board cursor residual, and choose the next bounded disjoint slice.

## 2026-07-12 — API-CONTRACT-001FZVEHICLESTRICT selection

- Scope: `src/app/(dashboard)/admin/vehicles/vehicles-content.tsx`, vehicle response schema, vehicle consumer/provider
  tests, and the two matching client-schema allowlist entries.
- Candidate ranking: selected the org-scoped vehicle master after the master-hub landing; deferred billing analytics,
  audit logs, contact/external/document delivery, inventory/medication, patient/visit, and shared-token readers with
  broader billing, PHI, audit, or outbound-data impact.
- Finding: the consumer trusts compile-time `VisitVehicleResourcesResponse` and `PharmacySitesResponse` casts for a
  counted vehicle-resource list and site option list. Duplicate/blank identity, invalid travel/operation/date state,
  counted metadata drift, legacy roots, or provider-only site fields can affect authorized vehicle editor state.
- Baseline: focused vehicle consumer/provider suites pass 2 files / 28 tests; client-schema is 171 schema-backed / 202
  allowlisted / 78 files. The patients-board cursor item remains a separate declared-vs-implemented DB query-take
  follow-up, not a client JSON schema gap.
- Planned fix: strict vehicle item/count-meta and site-option schemas, duplicate/count/date/field-bound regressions,
  provider-field stripping, and two allowlist ratchet removals. Vehicle/site providers, auth, mutations, and visual
  semantics stay fixed; no image generation is needed for this non-visual parser slice.

## 2026-07-12 — API-CONTRACT-001FZVEHICLESTRICT implementation checkpoint

- Implementation: added shared vehicle-resource counted-list and pharmacy-site option schemas, connected both vehicle
  GET readers, added regressions for provider-only fields, negative/invalid values, duplicate/count drift, and legacy
  site roots, and removed the two matching allowlist entries.
- Safety contract: vehicle identity/site relation/travel/operation/date fields, counted metadata arithmetic, site option
  identity, and provider-only field stripping now guard authorized list/editor/create state. Vehicle/site providers,
  auth, mutations, and visual semantics are unchanged.
- Tests: focused vehicle consumer/provider suites pass 2 files / 33 tests.
- Validation: static gates, typecheck, no-unused typecheck, lint, diff-check, and Next build pass; inventory is 173
  schema-backed / 200 allowlisted / 77 files. Implementation commit is pending scoped landing.

## 2026-07-12 — API-CONTRACT-001FZPACKAGINGSTRICT selection

- Scope: `src/app/(dashboard)/admin/packaging-methods/packaging-methods-content.tsx`, packaging-method response schema,
  packaging-method consumer/provider tests, and the one matching client-schema allowlist entry.
- Candidate ranking: selected the bounded one-entry master-data reader after the institutions landing; deferred billing,
  external/document delivery, patient/visit detail, and mutation-heavy readers with broader controlled-data or outbound
  side effects.
- Finding: the provider returns a counted `{ data, meta }` envelope while the consumer trusts a compile-time response
  cast; duplicate/blank/negative rows, count arithmetic drift, incorrect count basis, or provider-only timestamps can
  affect the authorized packaging-method list/form state.
- Baseline: focused packaging-method consumer/provider suites pass 2 files / 20 tests; client-schema is 169
  schema-backed / 204 allowlisted / 80 files.
- Planned fix: strict item/meta schema, unique IDs, counted-list invariants, provider-field stripping,
  malformed/legacy/duplicate/negative/inconsistent regressions, and one allowlist ratchet removal. POST/PATCH/audit,
  provider/auth, and visual semantics stay fixed.

- Landed: shared packaging-method item/meta schema now guards the counted provider envelope; focused suites pass 2 files /
  26 tests; static/type/no-unused/lint/diff/build gates pass; client-schema inventory moved to 170 schema-backed / 203
  allowlisted / 79 files. Commit `aee2ca6d4` is pushed. Next scan: remaining API-CONTRACT allowlist entries and patients
  board cursor residual.
