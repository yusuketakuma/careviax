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
