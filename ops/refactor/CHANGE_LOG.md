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
