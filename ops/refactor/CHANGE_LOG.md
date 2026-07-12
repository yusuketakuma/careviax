# Change Log

## API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT

- Commit Group: `API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT`
- Commit: `c4d0b015e`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: business-holidays list response schema and its business-holidays / shifts consumers.
- Implementation: validate organization, date window, optional site filter, ordering, duplicate IDs, site relation, and bounded-list completeness before query state; preserve only consumed fields; use the inclusive last day of the displayed month.
- FE/BE impact: provider route unchanged; both frontend readers now reject malformed success payloads before calendar or shift state changes.
- DB/auth/tenant/audit impact: no DB or provider change; client-side org scope is checked fail-closed in addition to backend authorization.
- UI impact: date-window correctness only; no visual redesign.
- Verification: focused 2 files / 39 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed.
- Rollback: revert the response schema, two reader adapters, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `0abd8a23a..c4d0b015e` fast-forward push succeeded.

## API-CONTRACT-001FZJOBLISTSTRICT

- Commit Group: `API-CONTRACT-001FZJOBLISTSTRICT`
- Commit: `1435465a2`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/jobs list response schema, consumer regression, and client-schema allowlist ratchet.
- Implementation: validate the fixed job definition envelope, endpoint/job identity, latest run/export relation, supported status, bounded counts/timestamps, and fixed redacted error summary; retain the existing query, polling, rerun mutation, provider, and UI behavior.
- FE/BE impact: provider route unchanged; the admin/jobs reader rejects malformed or cross-definition 2xx payloads before operational state is cached.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, or production-data change.
- Verification: focused 2 files / 16 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 162 schema-backed / 211 allowlisted / 87 files.
- Rollback: revert the jobs response schema, consumer adapter, regression, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `3215b2f02..1435465a2` fast-forward push succeeded; local and remote heads match.

## API-CONTRACT-001FZSTAFFMETRICSSTRICT

- Commit Group: `API-CONTRACT-001FZSTAFFMETRICSSTRICT`
- Commit: `6e1454401`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/staff KPI list response schema, consumer regressions, fixture alignment, and client-schema allowlist ratchet.
- Implementation: validate requested month, exact summary, unique staff identity, summary/item arithmetic, supported roles, bounded KPI values, and strip provider-only email/capacity metadata; preserve the existing provider, query, error state, and UI behavior.
- FE/BE impact: provider route remains unchanged; the admin/staff reader rejects wrong-month, duplicate, inconsistent, and invalid 2xx payloads before query state.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, or production-data change; raw patient detail is not introduced.
- Verification: focused 2 files / 16 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 163 schema-backed / 210 allowlisted / 86 files. Build emitted an ENOSPC pack-cache warning and existing CSS optimizer warnings but exited 0.
- Rollback: revert the staff metrics response schema, consumer adapter, fixture/regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `a4faa1677..6e1454401` fast-forward push succeeded; local and remote heads match.

## API-CONTRACT-001FZOPSINSIGHTSTRICT

- Commit Group: `API-CONTRACT-001FZOPSINSIGHTSTRICT`
- Commit: `47fcaf80f`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/operations-insights aggregate response schema, consumer regressions, and client-schema allowlist ratchet.
- Implementation: validate strict `{ data }` root, chronological unique month buckets, bounded counts, unique supported process keys, non-negative durations, and non-empty bounded hints; preserve provider aggregation, empty state, query error, and visual derivation behavior.
- FE/BE impact: provider route remains unchanged; the operations-insights reader rejects malformed or trend-distorting 2xx payloads before aggregate state is cached.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, or production-data change; no raw patient detail is added.
- Verification: focused 2 files / 14 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 164 schema-backed / 209 allowlisted / 85 files. Build emitted existing CSS optimizer warnings and exited 0; filesystem pressure was recorded in STATE.
- Rollback: revert the operations-insights response schema, consumer adapter, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `cec54a5d9..47fcaf80f` fast-forward push succeeded; local and remote heads match.

## API-CONTRACT-001FZSITESELECTREADSTRICT

- Commit Group: `API-CONTRACT-001FZSITESELECTREADSTRICT`
- Commit: `053b48c74`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: select-site list response schema, consumer regressions, current provider-shaped fixture, and client-schema allowlist ratchet.
- Implementation: validate strict `{ data, meta }`, unique site identities, at-most-one current site, non-negative visit counts, non-empty identity, and `limit/has_more` relation; preserve the existing PUT acknowledgement, membership filtering, and navigation behavior.
- FE/BE impact: provider route remains unchanged; `fetchMySites` rejects legacy or malformed 2xx payloads before site cards and switch navigation state.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, or production-data change.
- Verification: focused 1 file / 6 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 165 schema-backed / 208 allowlisted / 84 files. Build emitted existing CSS optimizer warnings and exited 0.
- Rollback: revert the sites response schema, consumer adapter, fixture/regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `47fcaf80f..053b48c74` fast-forward push succeeded; local and remote heads match.

## API-CONTRACT-001FZNOTIFICATIONSREADSTRICT

- Commit Group: `API-CONTRACT-001FZNOTIFICATIONSREADSTRICT`
- Commit: `64ccfd492`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: notifications GET response schema, inbox consumer/realtime envelope, provider-shaped fixtures, regressions, and client-schema allowlist ratchet.
- Implementation: validate strict `{ data, meta }`, notification identity/type/content/date/read state, internal links, unique identities, cursor relation, and bounded page size; strip provider-only fields while preserving PATCH acknowledgement, SSE-safe redaction, and org/user authorization.
- FE/BE impact: provider route remains unchanged; `NotificationsContent` rejects malformed, legacy, duplicate, or unsafe-link 2xx payloads before inbox state and navigation are used.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, or production-data change; authorized notification message content remains available only in the in-app operational surface.
- Verification: focused 2 files / 29 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 166 schema-backed / 207 allowlisted / 83 files. Build emitted existing CSS optimizer warnings and exited 0.
- Rollback: revert the notifications response schema, consumer/realtime type adapter, fixtures/regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `e39ede0ff..64ccfd492` fast-forward push succeeded; local and remote heads match.

## API-CONTRACT-001FZFACILITYUNITSSTRICT

- Commit Group: `API-CONTRACT-001FZFACILITYUNITSSTRICT`
- Commit: `bde744e93`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin facilities unit-list response schema, facility editor consumer regressions, and client-schema allowlist ratchet.
- Implementation: validate strict `{ data }`, unique unit identities, supported unit type, non-empty bounded identity/text, non-negative patient/capacity/order values, and strip provider-only fields; preserve facility/unit mutations, patient-count aggregation, authorization, and editor behavior.
- FE/BE impact: `/api/admin/facilities/[id]/units` remains unchanged; the facility editor rejects malformed or legacy 2xx payloads before occupancy and unit-edit state.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, or production-data change; authorized patient-count aggregate remains in the operational facility surface only.
- Verification: focused 2 files / 25 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 167 schema-backed / 206 allowlisted / 82 files. Build emitted existing CSS optimizer warnings and exited 0.
- Rollback: revert the unit response schema, consumer adapter, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `b70da7085..bde744e93` fast-forward push succeeded; local and remote heads match.

## API-CONTRACT-001FZNOTIFICATIONBELLSTRICT

- Commit Group: `API-CONTRACT-001FZNOTIFICATIONBELLSTRICT`
- Commit: `8a9956f0d`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: notification-bell summary/list response schemas, consumer regressions, shared notification-list reuse, and client-schema allowlist ratchet.
- Implementation: validate strict `{ data: { unreadCount } }` summary and `{ data, meta }` list envelopes, non-negative counts, notification identity/content/date/read state, duplicate identities, pagination relation, and internal links; strip provider-only list fields before badge/drawer state.
- FE/BE impact: `/notifications` and the header bell now fail closed on malformed/legacy/negative/unsafe 2xx payloads; `/api/notifications`, PATCH acknowledgement, SSE-safe redaction, OS notification minimization, provider, and auth/authz remain unchanged.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, production-data, or external-output change.
- Verification: focused 2 files / 12 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 168 schema-backed / 205 allowlisted / 81 files. Build emitted only the existing two CSS optimizer warnings and no ENOSPC warning.
- Rollback: revert the summary schema, bell reader adapter, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `bde744e93..8a9956f0d` fast-forward push succeeded; local and remote heads match (`0 0`).

## API-CONTRACT-001FZINSTITUTIONSSTRICT

- Commit Group: `API-CONTRACT-001FZINSTITUTIONSSTRICT`
- Commit: `f906abede`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/institutions GET response schema, consumer regressions, provider-shaped filtered/unfiltered fixtures, and client-schema allowlist ratchet.
- Implementation: validate exact unfiltered `{ data }` and filtered `{ data, meta }` roots, institution identity/contact/usage/date fields, unique identities, non-negative counts, pagination relation, and strip provider-only fields; preserve POST/PATCH/DELETE, provider query, authorization, and visual behavior.
- FE/BE impact: `/admin/institutions` now fails closed on malformed/legacy/duplicate/negative/invalid-date/pagination-drift 2xx payloads before table/edit state; `/api/prescriber-institutions` and mutation paths remain unchanged.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, production-data, or external-output change.
- Verification: focused 2 files / 43 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 169 schema-backed / 204 allowlisted / 80 files. Build emitted only the existing two CSS optimizer warnings and no ENOSPC warning.
- Rollback: revert the institution response schema, consumer adapter, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `8a9956f0d..f906abede` fast-forward push succeeded; local and remote heads match (`0 0`).

## API-CONTRACT-001FZPACKAGINGSTRICT

- Commit Group: `API-CONTRACT-001FZPACKAGINGSTRICT`
- Commit: `aee2ca6d4`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/packaging-methods counted GET response schema, consumer regressions, provider-shaped fixtures, and client-schema allowlist ratchet.
- Implementation: validate strict `{ data, meta }`, method identity/text/order/active fields, unique IDs, total/visible/hidden/truncated arithmetic, count basis, bounded limit, and empty filters; strip provider-only timestamps/org fields; preserve POST/PATCH/audit, provider query, authorization, and visual behavior.
- FE/BE impact: `/admin/packaging-methods` now fails closed on malformed/legacy/duplicate/negative/inconsistent 2xx payloads before list/form state; `/api/packaging-methods` and mutation/audit paths remain unchanged.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, production-data, or external-output change.
- Verification: focused 2 files / 26 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 170 schema-backed / 203 allowlisted / 79 files. Build emitted only the existing two CSS optimizer warnings and no ENOSPC warning.
- Rollback: revert the packaging-method response schema, consumer adapter, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `f906abede..aee2ca6d4` fast-forward push succeeded; local and remote heads match (`0 0`).

## API-CONTRACT-001FZMASTERHUBSTRICT

- Commit Group: `API-CONTRACT-001FZMASTERHUBSTRICT`
- Commit: `20d75daeb`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/master-hub aggregate response schema, consumer regressions, client-schema allowlist ratchet, and required ledgers.
- Implementation: validate strict `{ data }`, exact 11 master keys, card count/status/action/date fields, right-rail next/blocked identity/severity/age/href, duplicate/completeness and status-count invariants, internal links, bounded non-negative values, and provider-only nested-field stripping; preserve aggregate provider, authorization, authorized in-app detail, and visual semantics.
- FE/BE impact: `/admin/master-hub` now fails closed on malformed, legacy, duplicate, negative, unsafe, or incomplete 2xx payloads before freshness/action state; `/api/admin/master-hub` remains unchanged.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, production-data, or external-output change.
- Verification: focused 2 files / 20 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed; client-schema inventory is 171 schema-backed / 202 allowlisted / 78 files. Build emitted only the existing two CSS optimizer warnings and no ENOSPC warning; filesystem availability was 14 GiB before and 13 GiB after the build.
- Rollback: revert the master-hub response schema, consumer adapter, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `cd707e2dd..20d75daeb` fast-forward push succeeded; local and remote heads match (`0 0`).

## API-CONTRACT-001FZVEHICLESTRICT

- Commit Group: `API-CONTRACT-001FZVEHICLESTRICT`
- Commit: pending scoped implementation landing
- Push Status: PENDING
- Branch: `agent/continuous-improvement-20260712`
- Scope: admin/vehicles counted vehicle-resource GET schema, pharmacy-site option GET schema, consumer regressions,
  client-schema allowlist ratchet, and required ledgers.
- Implementation: validate strict counted vehicle list metadata, vehicle identity/site/travel/operation/date fields,
  duplicate/site relation invariants, strict site option identity, and provider-only field stripping; preserve vehicle/site
  providers, authorization, mutation acknowledgement, and visual semantics.
- FE/BE impact: `/admin/vehicles` now fails closed on malformed, legacy, duplicate, negative, invalid, or inconsistent
  2xx payloads before vehicle list/editor state; `/api/visit-vehicle-resources` and `/api/pharmacy-sites` remain unchanged.
- DB/auth/tenant/audit impact: no DB, migration, provider, auth/authz, tenant, audit, mutation, production-data, or
  external-output change.
- Verification: focused 2 files / 33 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check,
  and Next build passed; client-schema inventory is 173 schema-backed / 200 allowlisted / 77 files. Build emitted only
  the existing two CSS optimizer warnings and no ENOSPC warning; filesystem availability was 15 GiB before and 13 GiB
  after the build.
- Rollback: revert the vehicle response schema, consumer adapters, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`; push evidence will be recorded after the scoped landing.
