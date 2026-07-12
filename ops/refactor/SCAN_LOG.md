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

## 2026-07-12 — API-CONTRACT-001FZSERVICEAREASTRICT selection

- Rescan: `pnpm client-json-schema:check` passed with 176 schema-backed / 197 allowlisted schema-less calls across 76
  files and 0 new debt.
- Selection: admin/service-areas is the next bounded two-reader slice. Its pharmacy-site options and counted service-area
  list still use compile-time casts; the provider returns `{ data }` for sites and `{ data, meta }` for service areas.
- Baseline: focused consumer/provider command passed 2 files / 28 tests before implementation.
- Planned boundary: reuse the shared pharmacy-site option schema, add strict service-area item/meta invariants and
  provider-field stripping, remove only the two matching allowlist entries, and leave POST/PATCH/DELETE, provider/auth,
  tenant, audit, authorized detail, and visual semantics unchanged. No image generation is needed for this parser-only
  slice.

## 2026-07-12 — API-CONTRACT-001FZSERVICEAREASTRICT implementation checkpoint

- Implementation: added the service-area counted-list schema, reused shared pharmacy-site options, connected both GET
  readers, synchronized provider fixtures, and removed two allowlist entries.
- Regressions: provider-only site/area fields are stripped; duplicate site options, duplicate/mismatched area identity,
  count drift, legacy roots, and invalid successful payloads fail closed before editor/list state.
- Validation: focused consumer/provider suites pass 2 files / 32 tests; static gates, typecheck, no-unused typecheck,
  lint, diff-check, and confirmed Next build exit 0 pass. Client-schema is 178 schema-backed / 195 allowlisted / 75
  files. Build was Next 16.2.9 compile 83s, TypeScript 59s, 311/311 static pages, with final 13 GiB available.
- Landing: implementation commit `147a8be16` is pushed; closure ledger update remains in the next scoped commit. Unrelated
  harness-memory and personal artifacts remain excluded.

## 2026-07-12 — API-CONTRACT-001FZSERVICEAREASTRICT landed

- Commit: `147a8be16` pushed to `origin/agent/continuous-improvement-20260712`; local/upstream parity is `0 0`.
- Result: service-area site-option/count-list strict readers, provider fixtures, regressions, allowlist ratchet, and
  validation ledgers landed; unrelated harness-memory and personal artifacts remain excluded.
- Next scan: rerun `pnpm client-json-schema:check`, inspect remaining one-entry and multi-entry consumers plus the
  patients board cursor residual, and choose the next bounded disjoint slice.

## 2026-07-12 — API-CONTRACT-001FZMENTIONSTRICT selection

- Rescan: `pnpm client-json-schema:check` passed with 178 schema-backed / 195 allowlisted schema-less calls across 75
  files and 0 new debt.
- Selection: `MentionInput` is the next bounded one-reader slice. It consumes only staff id/name from `/api/pharmacists`
  but trusts a compile-time data-only cast while the provider returns counted `{ data, meta }` plus provider-only contact,
  account, capacity, and credential fields.
- Baseline: focused mention consumer/provider command passed 2 files / 32 tests before implementation.
- Planned boundary: strict minimal id/name response schema, counted metadata invariants, provider-only field stripping,
  legacy/duplicate/count-drift regressions, and one allowlist ratchet removal; comment mutation, mention IDs,
  provider/auth, tenant, PHI-safe recovery, and visual semantics remain unchanged. No image generation is needed.

## 2026-07-12 — API-CONTRACT-001FZMENTIONSTRICT implementation checkpoint

- Implementation: added the minimal pharmacist mention response schema, connected `MentionInput`, synchronized live
  `{ data, meta }` fixtures, and removed one allowlist entry.
- Regressions: provider-only contact/account/capacity/credential fields are stripped; legacy root, count drift, and
  repeated identity with conflicting names fail closed. Legitimate same-user repeated membership rows remain accepted.
- Validation: focused mention consumer/provider suites pass 2 files / 34 tests; static gates, typecheck, no-unused
  typecheck, lint, diff-check, and confirmed Next build exit 0 pass. Client-schema is 179 schema-backed / 194 allowlisted
  / 74 files. Build was Next 16.2.9 compile 2.1 minutes, TypeScript 53s, 311/311 static pages, with final 13 GiB available.
- Landing: implementation commit and closure ledger commit are pending; unrelated harness-memory and personal artifacts
  remain excluded.

## 2026-07-12 — API-CONTRACT-001FZCONFLICTPHARMACIST selection

- Rescan: live `pnpm client-json-schema:check` passes with 179 schema-backed / 194 allowlisted schema-less calls across
  74 files and 0 new debt.
- Selection: `src/app/(dashboard)/schedules/conflicts/conflict-resolution-content.tsx` has one remaining
  `stringFallback` reader for `/api/pharmacists`. It consumes only id/name for conflict candidate identity while the
  provider returns the same counted envelope already validated by `pharmacistMentionResponseSchema`.
- Safety boundary: reuse the existing minimal pharmacist schema, strip provider-only staff fields, and reject legacy,
  count-drifted, and conflicting-repeat payloads before conflict analysis. No provider/auth, schedule query, reorder,
  reconfirmation mutation, patient detail, or visual behavior change is planned.
- Baseline: focused schedule-conflict consumer/provider suites passed 2 files / 34 tests before implementation;
  unrelated harness-memory and personal artifacts remain excluded.

## 2026-07-12 — API-CONTRACT-001FZCONFLICTPHARMACIST implementation checkpoint

- Implementation: reused the existing pharmacist response schema, narrowed the conflict helper to id/name, synchronized
  the counted fixture, added provider-only field stripping and legacy/count-drift/conflicting-repeat regressions, and
  removed the single conflict allowlist entry.
- Validation: focused consumer/provider suites pass 2 files / 36 tests; static contract gates, typecheck, no-unused,
  lint, diff-check, and confirmed Next build pass. Client-schema is 180 schema-backed / 193 allowlisted schema-less
  calls across 73 files. Build is Next 16.2.9 compile 2.4 minutes, TypeScript 62 seconds, 311/311 static pages, two
  existing CSS optimizer warnings, and 12 GiB available after build.
- Landing: implementation commit and closure ledger commit are pending; no provider/auth/mutation/visual behavior was
  changed and unrelated harness-memory and personal artifacts remain excluded.

## 2026-07-12 — API-CONTRACT-001FZCONFLICTPHARMACIST landed locally

- Commit: `ba2831aea` (`fix(API-CONTRACT-001FZCONFLICTPHARMACIST): validate conflict pharmacist reader`) contains only
  the conflict consumer/test and allowlist removal; unrelated paths remain unstaged.
- Result: 180 schema-backed / 193 allowlisted schema-less calls across 73 files, focused 2 files / 36 tests, all static
  gates, type gates, lint, diff-check, and confirmed Next build pass.
- Push: not performed because no current user instruction requested remote publication; the branch is intentionally one
  local implementation commit ahead of `origin/agent/continuous-improvement-20260712`.
- Next scan: return to `API-CONTRACT-001-RESCAN`, inspect remaining allowlist entries and patients board cursor residual,
  and select the next bounded disjoint safe slice.

## 2026-07-12 — API-CONTRACT-001FZSAVEDVIEWSSTRICT selection

- Rescan: live `pnpm client-json-schema:check` passes with 180 schema-backed / 193 allowlisted schema-less calls across
  73 files and 0 new debt.
- Selection: `src/app/(dashboard)/views/saved-views-content.tsx` has three remaining `stringFallback` readers: the
  preferences GET/PATCH envelope and the scoped named saved-view GET. The page consumes only saved-view conditions and
  the six-field `schedules` view record projection; filters/sort remain intentionally opaque JSON.
- Safety boundary: add consumed strict response schemas, strip preference/provider-only fields before React Query state,
  enforce scoped saved-view identity/duplicate/date/count bounds, and reject malformed/legacy 2xx. No provider/auth,
  audit, saved-view mutation, opaque filter behavior, patient detail, external output, or visual change is planned.
- Baseline: focused saved-views/preferences consumer/provider suites passed 3 files / 37 tests before implementation;
  unrelated harness-memory and personal artifacts remain excluded.

## 2026-07-12 — API-CONTRACT-001FZSAVEDVIEWSSTRICT implementation checkpoint

- Implementation: added minimal preferences and schedules-scoped saved-view response schemas, connected both preference
  readers and the saved-view list reader, stripped provider-only fields, synchronized fixtures, added malformed/wrong-
  scope/duplicate/provider-field regressions, and removed three allowlist calls.
- Validation: focused consumer/provider suites pass 3 files / 39 tests; static contract gates, typecheck, no-unused,
  lint, diff-check, and confirmed Next build pass. Client-schema is 183 schema-backed / 190 allowlisted schema-less calls
  across 72 files. Build is Next 16.2.9 compile 7.1 minutes under transient 100% filesystem use, TypeScript 58 seconds,
  311/311 static pages, two existing CSS optimizer warnings, and 12 GiB available after build.
- Landing: implementation commit and closure ledger commit are pending; provider/auth/audit/mutation/opaque-filter and
  visual behavior were not changed and unrelated harness-memory and personal artifacts remain excluded.

## 2026-07-12 — API-CONTRACT-001FZSAVEDVIEWSSTRICT landed locally

- Commit: `696518892` (`fix(API-CONTRACT-001FZSAVEDVIEWSSTRICT): validate saved-view readers`) contains only the saved-
  view schema, consumer/test, and allowlist removal; unrelated paths remain unstaged.
- Result: 183 schema-backed / 190 allowlisted schema-less calls across 72 files, focused 3 files / 39 tests, all static
  gates, type gates, lint, diff-check, and confirmed Next build pass.
- Push: not performed because no current user instruction requested remote publication; the branch is intentionally two
  local implementation commits ahead of `origin/agent/continuous-improvement-20260712` (including `ba2831aea`).
- Next scan: return to `API-CONTRACT-001-RESCAN`, inspect remaining allowlist entries and patients board cursor residual,
  and select the next bounded disjoint safe slice.

## 2026-07-12 — API-CONTRACT-001FZOPERATINGHOURSSTRICT selection

- Scope: `src/app/(dashboard)/admin/operating-hours/operating-hours-content.tsx`, shared pharmacy-site option schema,
  operating-hours response schemas, operating-hours consumer/provider tests, vehicle import adjustment, and the three
  matching client-schema allowlist entries.
- Candidate ranking: selected bounded org/site settings after the vehicle landing; deferred billing analytics, audit logs,
  contact/external/document delivery, inventory/medication, patient/visit, notification, and shared-token readers with
  broader billing, PHI, audit, or outbound-data impact.
- Finding: the consumer trusts compile-time site-option and operating-hours response casts for a weekly seven-row editor,
  optional resolved calendar, and PUT success envelope; legacy roots, duplicate/mismatched site or weekday, malformed
  time/source state, invalid calendar rows, and provider-only site metadata can affect authorized settings state.
- Baseline: focused operating-hours consumer/provider suites pass 2 files / 21 tests; client-schema is 173 schema-backed /
  200 allowlisted / 77 files. The patients-board cursor item remains a separate declared-vs-implemented DB query-take
  follow-up, not a client JSON schema gap.
- Planned fix: extract shared site-option item/root schema, add exact operating-hours GET/PUT schemas with weekly/site/
  time/source/calendar invariants and provider-field stripping, add malformed/legacy/duplicate/invalid regressions, and
  remove the three operating-hours allowlist entries. Provider/auth/mutation/audit/visual semantics stay fixed; no image
  generation is needed for this non-visual settings parser slice.

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

## 2026-07-12 — API-CONTRACT-001FZVEHICLESTRICT landed

- Commit: `575696825` pushed to `origin/agent/continuous-improvement-20260712`; parity is `0 0`.
- Result: vehicle-resource counted-list and pharmacy-site option strict readers, regressions, allowlist ratchet, and
  validation ledgers landed; unrelated harness-memory and personal untracked artifacts remain excluded.
- Next scan: rerun `pnpm client-json-schema:check`, inspect remaining one-entry and multi-entry consumers plus the
  patients board cursor residual, and choose the next bounded disjoint slice.

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

## 2026-07-12 — API-CONTRACT-001FZOPERATINGHOURSSTRICT implementation checkpoint

- Implementation: extracted the shared pharmacy-site option schema for vehicle and operating-hours consumers, added exact
  operating-hours GET/PUT response schemas, connected all three readers, added regressions for provider-only fields,
  duplicate/mismatched weekly rows, duplicate site options, and malformed PUT success, and removed three allowlist entries.
- Safety contract: site identity, weekly 0-6 completeness/site relation/source/configured/time invariants, optional
  holiday/resolved-day validation, and provider-only field stripping now guard settings/editor/calendar state. Existing
  providers, auth, mutation/audit, and visual semantics are unchanged.
- Tests: operating-hours plus vehicle consumer/provider suites pass 4 files / 58 tests.
- Validation: static gates, typecheck, no-unused typecheck, lint, diff-check, and Next build pass; inventory is 176
  schema-backed / 197 allowlisted / 76 files. Implementation commit is pending scoped landing.

## 2026-07-12 — API-CONTRACT-001FZOPERATINGHOURSSTRICT landed

- Commit: `725b480e4` pushed to `origin/agent/continuous-improvement-20260712`; parity is `0 0`.
- Result: shared pharmacy-site option schema, operating-hours GET/PUT strict readers, regressions, vehicle import
  adjustment, allowlist ratchet, and validation ledgers landed; unrelated harness-memory and personal untracked
  artifacts remain excluded.
- Next scan: rerun `pnpm client-json-schema:check`, inspect remaining one-entry and multi-entry consumers plus the
  patients board cursor residual, and choose the next bounded disjoint slice.

## 2026-07-12 — API-CONTRACT-001FZMENTIONSTRICT landed

- Commit: `55ffe485a` pushed to `origin/agent/continuous-improvement-20260712`; local/upstream parity is `0 0`.
- Result: MentionInput minimal pharmacist schema, provider-only field stripping, live fixtures, regressions, allowlist
  ratchet, and validation ledgers landed; unrelated harness-memory and personal artifacts remain excluded.
- Next scan: rerun `pnpm client-json-schema:check`, inspect remaining one-entry and multi-entry consumers plus the
  patients board cursor residual, and choose the next bounded disjoint slice.

## 2026-07-12 — API-CONTRACT-001FZNOTIFICATIONSETTINGSTRICT selection

- Scope: `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`, a new notification-rule
  response schema, the focused consumer/provider tests, and one matching client-schema allowlist count.
- Candidate ranking: selected the event notification-rule GET as a bounded authorized configuration read after saved views;
  deferred escalation readers/mutations, billing, audit, contact/external/document delivery, inventory/medication, patient/
  visit, shared-token, and the patients-board DB query-take residual because they have broader controlled-data, outbound,
  or performance/PHI impact.
- Finding: the provider returns a bounded counted `{ data, meta }` list, but the consumer trusts a compile-time cast and
  can admit provider-only fields, legacy roots, malformed rules, duplicate identities, or count arithmetic drift into the
  event-rule state. Only event-rule GET is in scope; no escalation or mutation reader is changed.
- Baseline: focused notification-settings consumer/provider suites pass 2 files / 21 tests; client-schema is 183
  schema-backed / 190 allowlisted schema-less calls across 72 files. Relevant product paths are clean; inherited
  harness-memory and personal artifacts remain excluded.
- Planned fix: strict minimal rule/date/recipient/count schema, provider-field stripping, live fixture synchronization,
  malformed/legacy/duplicate/count-drift regressions, and one allowlist-count decrement. No visual reconstruction or
  `gpt-image-2` is needed for this non-visual parser/cache boundary.

## 2026-07-12 — API-CONTRACT-001FZNOTIFICATIONSETTINGSTRICT implementation checkpoint

- Implementation: added `src/lib/notification-rules/response-schema.ts`, connected the event notification-rule GET reader,
  stripped provider-only org/display/conditions/update fields, synchronized provider-shaped fixtures, removed one
  allowlist count, and added provider-field, legacy-root, malformed-recipient, duplicate-identity, and count-drift
  regressions.
- Safety contract: the counted `{ data, meta }` envelope now validates rule identity/channel/enabled/recipient/date fields,
  fixed count basis/filter metadata, visible/hidden/truncated arithmetic, and requested-list bound before event-rule state;
  escalation GET, all mutations, provider/auth/tenant/audit behavior, and visual semantics remain unchanged.
- Tests: focused notification-settings consumer/provider suites pass 2 files / 26 tests.
- Validation: static contract gates, typecheck, no-unused typecheck, lint, diff-check, and serialized Next build pass;
  inventory is 184 schema-backed / 189 allowlisted schema-less calls across 72 files. Next 16.2.9 compiled in 3.0 minutes,
  TypeScript finished in 59 seconds, and 311/311 static pages generated with the two existing CSS optimizer warnings.
  No browser/E2E or image generation was needed for this non-visual parser slice.

## 2026-07-12 — API-CONTRACT-001FZNOTIFICATIONSETTINGSTRICT landed locally

- Commit: `a2b24709a` (`fix(API-CONTRACT-001FZNOTIFICATIONSETTINGSTRICT): validate notification rule reader`) is local;
  push was not requested. The implementation commit contains only the schema, notification-settings consumer/test, and
  client-schema allowlist paths; unrelated harness-memory and personal artifacts remain excluded.
- Next scan: return to `API-CONTRACT-001-RESCAN`, rerun `pnpm client-json-schema:check`, inspect remaining candidates and
  the patients-board DB query-take residual, and choose the next bounded disjoint slice.
