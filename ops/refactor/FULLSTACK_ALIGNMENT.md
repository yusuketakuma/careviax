# Full-stack Alignment

## API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT

| Area                        | Evidence / status                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Admin business-holidays and admin shifts screens; backend route is `/api/business-holidays` with `canAdmin` authorization.                                       |
| Frontend state / clients    | React Query readers in `business-holidays-content.tsx` and `shifts-content.tsx`; schema-backed before cache/state.                                               |
| Request / response contract | Provider returns `{ data }`; consumer enforces org, date range, optional site, sorted dates, unique IDs, relation consistency, and non-truncated bounded result. |
| Backend / DB                | Existing authenticated route, Prisma `BusinessHoliday`, org predicate, inclusive date filter, order, and `take` unchanged.                                       |
| Auth / tenant / audit       | Backend auth/org scope and audit mutation behavior unchanged; client rejects cross-org success payloads before render.                                           |
| Errors / loading / empty    | Existing React Query loading, error/retry, and empty states remain; malformed 2xx becomes query error rather than false empty.                                   |
| Tests                       | Consumer regressions plus focused suites: 2 files / 39 tests; aggregate and no-unused typechecks; static contract gates; build.                                  |
| Alignment                   | ALIGNED for this read slice; mutation and provider semantics intentionally unchanged.                                                                            |

## API-CONTRACT-001FZJOBLISTSTRICT

| Area                        | Evidence / status                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Admin jobs screen at `/admin/jobs`; backend route `/api/jobs` remains protected by existing `canAdmin` authorization.                                             |
| Frontend state / clients    | React Query reader in `jobs-dashboard-content.tsx`; schema-backed before jobs definitions or latest run state enters cache/render.                                |
| Request / response contract | Provider returns fixed `{ data }` definitions with redacted run/export DTOs; consumer verifies strict envelope, uniqueness, endpoint identity, and run relations. |
| Backend / DB                | Existing authenticated route, organization/global job selection, bounded latest-run reads, and Prisma semantics unchanged.                                        |
| Auth / tenant / audit       | Backend auth/org scope and audit/mutation behavior unchanged; client rejects cross-definition and unsupported success payloads.                                   |
| Errors / loading / empty    | Existing React Query loading, error/retry, polling, rerun, and empty states remain; malformed 2xx becomes query error rather than false operational state.        |
| Tests                       | Consumer/provider focused suite: 2 files / 16 tests; static contract gates, typechecks, lint, diff-check, and build passed.                                       |
| Alignment                   | ALIGNED for this read slice; provider, mutation, and visual semantics intentionally unchanged.                                                                    |

## API-CONTRACT-001FZSTAFFMETRICSSTRICT

| Area                        | Evidence / status                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Admin staff KPI screen at `/admin/staff`; backend route `/api/admin/staff-metrics` remains protected by existing `canAdmin` authorization.                             |
| Frontend state / clients    | React Query reader in `staff-kpi-panel.tsx`; expected-month schema runs before KPI summary or staff rows enter query state.                                            |
| Request / response contract | Provider returns `{ data: { month, summary, items } }`; consumer validates exact root, month identity, roles, numeric ranges, unique IDs, and summary/item arithmetic. |
| Backend / DB                | Existing membership, visit-record, care-report, and pharmacist-shift organization-scoped queries and JST/UTC month boundaries are unchanged.                           |
| Auth / tenant / audit       | Existing backend authorization, org predicates, and audit behavior unchanged; provider-only email/capacity fields are stripped from the client cache.                  |
| Errors / loading / empty    | Existing React Query loading, error/retry, empty, and false-zero protection remain; malformed 2xx becomes query error rather than KPI state.                           |
| Tests                       | Consumer/provider focused suite: 2 files / 16 tests; static contract gates, typechecks, lint, diff-check, and build passed.                                            |
| Alignment                   | ALIGNED for this read slice; provider, mutation, month calculation, and visual semantics intentionally unchanged.                                                      |

## API-CONTRACT-001FZOPSINSIGHTSTRICT

| Area                        | Evidence / status                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User roles / routes         | Admin operations-insights screen at `/admin/operations-insights`; backend route `/api/admin/operations-insights` remains protected by existing `canAdmin` authorization. |
| Frontend state / clients    | React Query reader in `operations-insights-content.tsx`; strict schema runs before trend, duration, or hint state enters the query cache.                                |
| Request / response contract | Provider returns `{ data: { monthly_visits, processes, hints } }`; consumer validates root, month order/identity, numeric bounds, process keys, and hint bounds.         |
| Backend / DB                | Existing organization-scoped visit/prescription/audit/set/report reads and aggregate helper behavior are unchanged.                                                      |
| Auth / tenant / audit       | Existing backend authorization and org predicates remain; no patient detail or external output boundary changes.                                                         |
| Errors / loading / empty    | Existing loading, error/retry, truthful empty, trend, and bottleneck rendering remain; malformed 2xx becomes query error.                                                |
| Tests                       | Consumer/helper focused suite: 2 files / 14 tests; static contract gates, typechecks, lint, diff-check, and build passed.                                                |
| Alignment                   | ALIGNED for this read slice; provider aggregation, empty-state semantics, and visual derivation intentionally unchanged.                                                 |
