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
