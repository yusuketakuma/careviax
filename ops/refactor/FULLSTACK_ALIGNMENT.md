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

## API-CONTRACT-001FZINSTITUTIONSSTRICT

| Area                        | Evidence / status                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized admin users access `/admin/institutions`; `/api/prescriber-institutions` remains under existing `canReport` GET scope and admin-only mutation permissions.                         |
| Frontend state / clients    | `institutions-content.tsx` selects an exact unfiltered or filtered schema from the trimmed query before table/edit state; provider-only fields are stripped from cached items.                |
| Request / response contract | Provider returns `{ data }` without search and `{ data, meta: { limit, has_more } }` for `q`; consumer validates identity/contact/usage/date, duplicate IDs, count bounds, and page relation. |
| Backend / DB                | Existing org-scoped institution query, usage count/latest prescribed date projection, ordering, no-store behavior, persistence, and provider routes are unchanged.                            |
| Auth / tenant / audit       | Existing `canReport` GET and admin mutation authorization remain; authorized institution contact/usage data stays in the in-app admin surface and is not sent to external output.             |
| Errors / loading / empty    | Existing loading, error/retry, empty, search debounce, edit, and mutation behavior remains; malformed 2xx becomes query error rather than false table/edit state.                             |
| Tests                       | Institutions consumer/provider suite: 2 files / 43 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                              |
| Alignment                   | ALIGNED for this read slice; POST/PATCH/DELETE, provider/auth semantics, authorized contact/usage display, and visual behavior intentionally unchanged.                                       |

## API-CONTRACT-001FZPACKAGINGSTRICT

| Area                        | Evidence / status                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User roles / routes         | Authorized users access `/admin/packaging-methods`; `/api/packaging-methods` remains under existing `canVisit` GET scope and admin-only mutation permissions.                        |
| Frontend state / clients    | `packaging-methods-content.tsx` validates the counted response before list/form state; provider-only timestamps and organization fields are stripped from cached rows.               |
| Request / response contract | Provider returns `{ data, meta }` with `count_basis=packaging_methods`, empty filters, bounded `limit`, and counted-list metadata; consumer validates row and arithmetic invariants. |
| Backend / DB                | Existing org-scoped method query, ordering, bounded take, no-store/provider behavior, persistence, and audit-backed POST/PATCH paths are unchanged.                                  |
| Auth / tenant / audit       | Existing `canVisit` GET and admin mutation/audit authorization remain; authorized packaging configuration stays in-app and is not sent to external output.                           |
| Errors / loading / empty    | Existing loading, error/retry, empty, truncation notice, edit, and mutation behavior remains; malformed 2xx becomes query error rather than false list/form state.                   |
| Tests                       | Packaging-method consumer/provider suite: 2 files / 26 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                 |
| Alignment                   | ALIGNED for this read slice; POST/PATCH/audit, provider/auth semantics, authorized configuration display, and visual behavior intentionally unchanged.                               |

## API-CONTRACT-001FZMASTERHUBSTRICT

| Area                        | Evidence / status                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized admin users access `/admin/master-hub`; `/api/admin/master-hub` remains under its existing `canAdmin` authorization and no route boundary changed.                                                   |
| Frontend state / clients    | `master-hub-content.tsx` validates the aggregate envelope before card freshness, summary, and right-rail action state; provider-only nested fields are stripped from cached state.                              |
| Request / response contract | Provider returns `{ data }` with exactly 11 master cards and a shared right rail; consumer validates key completeness, card fields, rail identity/severity/age/href, status-count relation, and internal links. |
| Backend / DB                | Existing org-scoped aggregate queries, date-boundary calculation, no-store handling, right-rail service, persistence, and provider route are unchanged.                                                         |
| Auth / tenant / audit       | Existing `canAdmin` authorization, org context, audit-count aggregation, and in-app authorized disclosure remain; no provider metadata is externalized.                                                         |
| Errors / loading / empty    | Existing loading, error/retry, summary, card, and right-rail behavior remains; malformed 2xx becomes query error rather than false freshness/action state.                                                      |
| Tests                       | Master-hub consumer/provider suite: 2 files / 20 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                                  |
| Alignment                   | ALIGNED for this read slice; aggregate provider/auth semantics, authorized detail display, and visual behavior intentionally unchanged.                                                                         |

## API-CONTRACT-001FZVEHICLESTRICT

| Area                        | Evidence / status                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User roles / routes         | Authorized vehicle administrators access `/admin/vehicles`; vehicle-resource and pharmacy-site option GET routes retain their existing `canVisit` scope and no route boundary changed.                                   |
| Frontend state / clients    | `vehicles-content.tsx` validates the counted vehicle list and site option envelope before list, editor, and create-form state; provider-only timestamps/site metadata are stripped.                                      |
| Request / response contract | Vehicle provider returns `{ data, meta }` with counted-list fields and nested site summary; site options return `{ data }`; consumer validates identity/site relation/travel/operation/date/count fields and duplicates. |
| Backend / DB                | Existing org-scoped vehicle/site queries, ordering, bounded vehicle limit, no-store handling, persistence, and provider routes are unchanged.                                                                            |
| Auth / tenant / audit       | Existing `canVisit` reads, `canAdmin` mutations, org context, and vehicle audit behavior remain; provider metadata is not externalized.                                                                                  |
| Errors / loading / empty    | Existing loading, error/retry, empty, editor, and mutation behavior remains; malformed 2xx becomes query error rather than false vehicle/editor state.                                                                   |
| Tests                       | Vehicle consumer/provider suite: 2 files / 33 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                                              |
| Alignment                   | ALIGNED for this read slice; providers, authorization, mutation acknowledgements, and visual behavior intentionally unchanged.                                                                                           |

## API-CONTRACT-001FZOPERATINGHOURSSTRICT

| Area                        | Evidence / status                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized admins access `/admin/operating-hours`; site options and operating-hours GET/PUT retain existing `canAdmin` authorization and no route boundary changed.                                                  |
| Frontend state / clients    | `operating-hours-content.tsx` validates shared site options, weekly GET/calendar payloads, and PUT success payloads before site/editor/calendar state; provider-only site/row fields are stripped.                   |
| Request / response contract | Site options return `{ data }`; operating-hours GET returns weekly rows plus optional holidays/resolved days; PUT returns weekly rows; schemas validate site/weekday/time/source/configured and calendar invariants. |
| Backend / DB                | Existing org-scoped site/operating-hours queries, date-boundary resolution, bounded 7-row weekly and 366-day calendar behavior, no-store handling, persistence, and provider routes are unchanged.                   |
| Auth / tenant / audit       | Existing admin authorization, org context, optimistic version/conflict behavior, audit entry, and in-app settings display remain; no provider metadata is externalized.                                              |
| Errors / loading / empty    | Existing loading, error/retry, calendar, editor, conflict, and save behavior remains; malformed 2xx becomes query/mutation error rather than false settings/calendar state.                                          |
| Tests                       | Operating-hours and vehicle consumer/provider suites: 4 files / 58 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                     |
| Alignment                   | ALIGNED for this read slice; providers, authorization, mutation/audit semantics, and visual behavior intentionally unchanged.                                                                                        |

## API-CONTRACT-001FZSERVICEAREASTRICT

| Area                        | Evidence / status                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized admin users access `/admin/service-areas`; pharmacy-site and service-area GETs retain existing `canVisit` authorization and no route boundary changed.                                     |
| Frontend state / clients    | `service-areas/page.tsx` validates shared site options and counted service-area data before site selector, editor, or list state; provider-only fields are stripped from cache.                       |
| Request / response contract | Site options return `{ data }`; service areas return `{ data, meta }`; schemas validate non-empty identity, nested site relation, area type/geo object, duplicate IDs, filters, and count arithmetic. |
| Backend / DB                | Existing org-scoped service-area query, ordering, bounded limit/count, site include, no-store behavior, persistence, and provider routes are unchanged.                                               |
| Auth / tenant / audit       | Existing `canVisit` reads, `canAdmin` mutations, org context, reference validation, and audit behavior remain; provider metadata is not externalized.                                                 |
| Errors / loading / empty    | Existing loading, error/retry, empty, editor, and mutation behavior remains; malformed 2xx becomes query error rather than false site/list state.                                                     |
| Tests                       | Service-area consumer/provider suite: 2 files / 32 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                      |
| Alignment                   | ALIGNED for this read slice; providers, authorization, mutations, tenant/audit semantics, authorized detail, and visual behavior intentionally unchanged.                                             |

## API-CONTRACT-001FZMENTIONSTRICT

| Area                        | Evidence / status                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized in-app comment users receive staff mention candidates through `/api/pharmacists`; existing `canVisit` authorization and no route boundary changed.                             |
| Frontend state / clients    | `MentionInput` validates the pharmacist envelope before candidate filtering/mention UI state; only provider id/name fields enter the React Query cache.                                   |
| Request / response contract | `/api/pharmacists` returns `{ data, meta }`; schema validates id/name, membership or unique-user count basis, filters, limit, visible/hidden arithmetic, and repeated-name identity.      |
| Backend / DB                | Existing org-scoped membership/visit-count query, bounded limit, role/site filters, no-store handling, and pharmacist provider route are unchanged.                                       |
| Auth / tenant / audit       | Existing `canVisit` read, org context, membership visibility, comment mention IDs, comment audit/mutations, and PHI-safe recovery remain unchanged; provider fields are not externalized. |
| Errors / loading / empty    | Existing loading, error/retry, empty candidate, keyboard, and mention insertion behavior remains; malformed 2xx becomes query error rather than false candidate state.                    |
| Tests                       | Mention consumer/pharmacist provider suite: 2 files / 34 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                    |
| Alignment                   | ALIGNED for this read slice; provider/auth, comment mutation, mention-id, patient/PHI, and visual behavior intentionally unchanged.                                                       |

## API-CONTRACT-001FZCONFLICTPHARMACIST

| Area                        | Evidence / status                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized schedule operators access the existing conflict page; `/api/pharmacists` retains its existing organization-scoped `canVisit` read boundary.                                                   |
| Frontend state / clients    | `conflict-resolution-content.tsx` validates the counted pharmacist envelope before conflict naming, candidate selection, and Plan A state; only id/name enter the consumed helper state.                 |
| Request / response contract | Provider returns `{ data, meta }`; the shared schema validates identity, count basis/filter metadata, visible/hidden arithmetic, limit, and repeated-name identity while stripping provider-only fields. |
| Backend / DB                | Existing pharmacist membership query, schedule-window query, reorder/reconfirmation endpoints, persistence, and provider routes are unchanged.                                                           |
| Auth / tenant / audit       | Existing org context, pharmacist visibility, schedule mutation authorization, audit behavior, and in-app patient detail remain unchanged; no provider metadata is externalized.                          |
| Errors / loading / empty    | Existing loading, lookup error/retry, conflict, no-conflict, and mutation recovery behavior remains; malformed 2xx becomes a query error rather than false candidate/conflict state.                     |
| Tests                       | Conflict consumer/provider suite: 2 files / 36 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                             |
| Alignment                   | ALIGNED for this read slice; schedule providers, authorization, mutations, patient/PHI behavior, audit semantics, and visual behavior intentionally unchanged.                                           |

## API-CONTRACT-001FZSAVEDVIEWSSTRICT

| Area                        | Evidence / status                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User roles / routes         | Authorized users access `/views`; `/api/me/preferences` and scoped `/api/saved-views` retain their existing authenticated org/user boundaries.                                                                           |
| Frontend state / clients    | `saved-views-content.tsx` validates preferences GET/PATCH and the schedules-scoped list before condition-chip or named-view state; provider-only fields are stripped from cache.                                         |
| Request / response contract | Preferences return `{ data }` with optional saved conditions; scoped saved views return `{ data }`; schemas validate condition/value, schedules scope, identity/date/order fields, duplicate IDs, and bounded list size. |
| Backend / DB                | Existing preference merge, saved-view list/create/update/delete queries, opaque filters/sort normalization, persistence, and route handlers are unchanged.                                                               |
| Auth / tenant / audit       | Existing authenticated user/org visibility, shared-view ownership flags, audit events, and in-app detail remain unchanged; no provider metadata is externalized.                                                         |
| Errors / loading / empty    | Existing loading, empty, stale, error/retry, and mutation recovery behavior remains; malformed 2xx becomes a query error rather than false default/view state.                                                           |
| Tests                       | Saved-views/preferences consumer/provider suite: 3 files / 39 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                              |
| Alignment                   | ALIGNED for this read slice; provider/auth/audit/mutation semantics, opaque filters/sort, patient detail, external output, and visual behavior intentionally unchanged.                                                  |

## API-CONTRACT-001FZNOTIFICATIONSETTINGSTRICT

| Area                        | Evidence / status                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles / routes         | Authorized admins continue to access the existing `/admin/notification-settings` surface; `/api/notification-rules` retains its existing `canAdmin` and org-scoped GET boundary.                                     |
| Frontend state / clients    | `notification-settings-content.tsx` validates the event-rule GET before rule/channel state; only the consumed rule projection enters state and provider-only fields are stripped.                                    |
| Request / response contract | Provider `{ data, meta }` is validated for rule id/event/channel/enabled/recipient/date fields, fixed count basis/filter metadata, duplicate IDs, list bound, and visible/hidden/truncated arithmetic.               |
| Backend / DB                | Existing notification-rule query, bounded `take`, ordering, no-store response, persistence, and provider route are unchanged; escalation readers/mutations are outside this slice.                                   |
| Auth / tenant / audit       | Existing `canAdmin`, organization scope, audit/mutation semantics, browser preference, and in-app event settings remain unchanged; provider-only org/conditions/update metadata is not externalized to client state. |
| Errors / loading / empty    | Existing loading, error/retry, empty, and toggle behavior remains; malformed or legacy 2xx becomes a settings-load error rather than false event-rule state.                                                         |
| Tests                       | Notification-settings consumer/provider suite: 2 files / 26 tests; static contract gates, typechecks, lint, diff-check, and serialized Next build passed.                                                            |
| Alignment                   | ALIGNED for this bounded read slice; escalation GET, mutation response contracts, patient/PHI data, outbound delivery, and visual behavior intentionally unchanged.                                                  |
