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

## API-CONTRACT-001FZSITESELECTREADSTRICT

| Area                        | Evidence / status                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Select-site screen at `/select-site`; `/api/me/sites` and existing `/api/me/site` remain behind current auth/org context.                                      |
| Frontend state / clients    | `fetchMySites` in `select-site-content.tsx`; strict `{ data, meta }` schema runs before cards, summary, or switch navigation state.                            |
| Request / response contract | Provider returns `{ data, meta: { limit, has_more } }`; consumer validates identity, current flag, counts, and pagination relation.                            |
| Backend / DB                | Existing membership-scoped site query, bounded `take`, visit counts, default-site resolution, and provider route are unchanged.                                |
| Auth / tenant / audit       | Existing membership/authz and PUT audit semantics unchanged; malformed site list cannot influence the switch request before the existing server authorization. |
| Errors / loading / empty    | Existing loading, error/retry, empty, summary, and card rendering remain; malformed/legacy 2xx becomes query error rather than false site state.               |
| Tests                       | Select-site focused suite: 1 file / 6 tests; static contract gates, typechecks, lint, diff-check, and build passed.                                            |
| Alignment                   | ALIGNED for this read slice; PUT acknowledgement, provider membership filtering, and visual/navigation semantics intentionally unchanged.                      |

## API-CONTRACT-001FZFACILITYUNITSSTRICT

| Area                        | Evidence / status                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Admin facilities editor at `/admin/facilities`; `/api/admin/facilities/[id]/units` remains under existing facility reference/auth context and unit mutation permissions.  |
| Frontend state / clients    | Unit query in `facilities-content.tsx`; strict `{ data }` schema runs before occupancy counts or unit-edit state enters the facility sheet.                               |
| Request / response contract | Provider returns projected `{ data }` unit rows; consumer validates identity, type, text, capacity, patient count, display order, and duplicate IDs.                      |
| Backend / DB                | Existing org-scoped facility/unit lookup, residence count aggregation, ordering, no-store behavior, persistence, and provider route are unchanged.                        |
| Auth / tenant / audit       | Existing `canVisit` GET authorization and unit mutation/audit semantics remain; authorized occupancy aggregate is not sent to public/external boundaries by this slice.   |
| Errors / loading / empty    | Existing facility-sheet loading, unit error, empty, edit, and mutation behavior remains; malformed/legacy 2xx becomes unit query error rather than false occupancy state. |
| Tests                       | Facilities consumer/unit-provider suite: 2 files / 25 tests; static contract gates, typechecks, lint, diff-check, and build passed.                                       |
| Alignment                   | ALIGNED for this read slice; provider aggregation, unit mutations, facility editor visuals, and authorization semantics intentionally unchanged.                          |

## API-CONTRACT-001FZNOTIFICATIONSREADSTRICT

| Area                        | Evidence / status                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Notifications inbox at `/notifications`; `/api/notifications` remains under existing authenticated org/user scope, while PATCH and SSE routes remain unchanged.                              |
| Frontend state / clients    | `NotificationsContent` uses `readApiJson` with the strict list schema before inbox cards, unread ordering, or link navigation state; realtime updates preserve the response envelope.        |
| Request / response contract | Provider returns `{ data, meta: { limit, has_more, next_cursor } }`; consumer validates notification identity/type/content/date/read state, internal links, uniqueness, and cursor relation. |
| Backend / DB                | Existing org/user predicates, bounded cursor query, ordering, no-store handling, notification persistence, and provider route are unchanged.                                                 |
| Auth / tenant / audit       | Existing authorization and org/user isolation remain; provider-only metadata is stripped from query state and authorized in-app notification detail is not blanket-redacted.                 |
| Errors / loading / empty    | Existing loading, error/retry, empty, category, unread, and navigation behavior remains; malformed 2xx becomes query error rather than false inbox state.                                    |
| Tests                       | Notifications consumer/provider suite: 2 files / 29 tests; static contract gates, typechecks, lint, diff-check, and build passed.                                                            |
| Alignment                   | ALIGNED for this read slice; PATCH acknowledgement, SSE-safe content policy, provider semantics, and visual behavior intentionally unchanged.                                                |

## API-CONTRACT-001FZNOTIFICATIONBELLSTRICT

| Area                        | Evidence / status                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized dashboard users see the header notification bell and `/notifications`; summary/list requests use the existing `/api/notifications` org/user scope.                                                 |
| Frontend state / clients    | `notification-bell.tsx` validates summary and list refresh JSON before badge/drawer state; the list schema strips provider-only fields and keeps OS/SSE privacy helpers separate.                             |
| Request / response contract | Provider shapes remain `{ data: { unreadCount } }` and `{ data, meta: { limit, has_more, next_cursor } }`; schemas reject legacy roots, invalid counts/items, duplicates, pagination drift, and unsafe links. |
| Backend / DB                | Existing notification provider query, bounded list behavior, ordering, no-store handling, persistence, and PATCH route are unchanged.                                                                         |
| Auth / tenant / audit       | Existing org/user authorization and notification audit semantics remain; authorized detail stays in-app, and raw title/message/link are not passed to OS notification helpers.                                |
| Errors / loading / empty    | Existing refresh failure, drawer, badge, empty, merge, and retry behavior remains; invalid successful JSON is treated as a failed refresh before state changes.                                               |
| Tests                       | Notification-bell focused suite: 2 files / 12 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                                   |
| Alignment                   | ALIGNED for this read slice; PATCH acknowledgement, SSE-safe redaction, provider/auth semantics, and visual behavior intentionally unchanged.                                                                 |
