# API conventions

This document records the current PH-OS API conventions for new and modified Route Handlers.

## Authentication

- Prefer `withAuthContext(handler, options)` from `src/lib/auth/context.ts` for new and modified Route Handlers.
- Treat `withAuth(handler, options)` from `src/lib/auth/middleware.ts` as legacy compatibility outside `src/app/api`. Do not add new API Route Handler usage.
- Use `permission` keys from `src/lib/auth/permissions.ts` for role-gated operations. For "me" routes, omit broad permissions only when every query and mutation is constrained to `ctx.userId`.

## Request Validation

- Read JSON bodies through `readJsonObjectRequestBody`.
- Validate external input with zod and return `validationError` on `safeParse` failure.
- Normalize route params with the shared route-param helpers before database access.
- Register new mutation-heavy API paths in `src/lib/api/rate-limit.ts` when the endpoint can be abused or called repeatedly.

## Operational Catalog

- Register new or materially changed high-risk, clinical output, export, public token, admin, and operations API paths in `src/lib/api/route-catalog.ts` when they should appear in `/api/meta/route-catalog`.
- Update route-catalog tests when adding or changing cataloged paths, methods, permissions, or areas. The catalog is curated, not exhaustive, so do not add low-risk internal endpoints solely to mirror `src/app/api/**/route.ts`.
- Keep route placeholder names consistent across `src/lib/api/route-catalog.ts`, `src/lib/api/rate-limit.ts`, and route tests when the placeholder has domain meaning, such as `:token` for external-access public links.

## Tenant Boundary

- Every read must include an application-layer `org_id: ctx.orgId` constraint where the model is tenant scoped.
- Every write must run inside `withOrgContext(ctx.orgId, async (tx) => { ... })` unless the route is deliberately system scoped.
- Keep audit writes in the same transaction as the mutation they describe.

## Audit Logs

- Use `createAuditLogEntry(tx, ctx, { action, targetType, targetId, changes })` from `src/lib/audit/audit-entry.ts` for new and touched `withAuthContext` routes.
- Keep `changes` small and structured. Do not put patient names, addresses, free-text clinical notes, message bodies, transcripts, or other PHI content into `changes`.
- Use snake_case actions and Prisma model names for `targetType`.

## Clinical Output And Export Routes

- Gate care-report PDF, print, file download, and communication export surfaces with the same report-send boundary (`canSendCareReport`) unless the existing route has a narrower documented permission.
- Record successful clinical output and CSV/PDF exports with `recordDataExportAudit` before returning the export body, download URL, or printable success state.
- Fail closed when export audit fails. Do not return the PDF/CSV/file/print success response if the compliance audit write did not complete.
- Mark printable/export responses `Cache-Control: no-store` when they contain PHI or acknowledge a PHI export/print action.
- Keep export audit metadata structured and identifier-based. Use stable IDs, counts, hashes, truncation flags, and report/document version timestamps; do not write clinical free text, patient names, addresses, recipient message bodies, or raw CSV cell content into audit metadata.
- Neutralize CSV cells that begin with spreadsheet formulas or control characters before serializing export rows.
- Communication request CSV export defaults to the external redaction profile. Internal exports require report-output permission plus a narrowing `status` or `request_type` filter, must enforce the synchronous row cap before patient enrichment, audit, or CSV output, and must preserve `no-store` responses.

## Mutation Freshness And Idempotency

- Clinical, communication, and report mutations that operate from a previously rendered record must accept and validate the current version token, usually `expected_updated_at`.
- Reject stale version tokens with a 409 conflict before delivery, export, audit, task, response, or other mutation side effects. Route tests should assert no downstream side effects on stale input.
- When a mutation depends on multiple clinical sources, validate each relevant token. Visit-to-report generation requires `expected_visit_record_updated_at`; refreshing an existing report draft also requires the matching report version token for that report type.
- Delivery or replayable mutation routes should use `Idempotency-Key` with a request fingerprint that includes the freshness token and normalized action payload. Same-key same-body completed requests may replay the stored result; same-key different-body requests must conflict.
- Persist only stable hashes, fingerprints, counts, IDs, timestamps, and status values for idempotency/audit evidence. Do not persist raw OTPs, bearer tokens, clinical note bodies, message bodies, or CSV cell content in idempotency or audit metadata.

## Responses

- Preserve existing response shapes. Do not change an existing route from raw JSON to `{ data }`, or the reverse, as part of a refactor.
- Cursor-paginated list endpoints should normally return `{ data, hasMore, nextCursor?, totalCount? }`, matching `src/lib/api/pagination.ts` and `src/lib/api/cursor-pagination-client.ts`.
- List endpoints may include domain metadata such as `summary`, `counts`, or `generated_at` when existing consumers already expect it.
- Aggregate BFF endpoints may return a raw view model when existing consumers already expect that shape.
- Use helpers from `src/lib/api/response.ts` instead of direct `NextResponse.json` for new route code.

## Logging

- `console.error` and `console.warn` are operational logs, not audit logs.
- Do not pass PHI to console logs. Use stable IDs, enum-like reason codes, counts, provider names, status codes, and error objects.
- If a failure needs compliance evidence, write an `AuditLog` entry in the same transaction instead of relying on console output.
- Phase 3 review on 2026-06-12 checked current `src/app/api` and `src/server` console error/warn calls and found no direct patient names, addresses, clinical free text, or message bodies in console arguments.

## Fire And Forget

- Intentional fire-and-forget work must include a short `// intentional: <reason>` comment near the call site.
- Do not bulk-convert fire-and-forget work to `await`; some paths are deliberately best effort or must not block UI/API responses.

## Client Type Boundary

- Client components should import shared contract types from `src/types`.
- Do not import type-only contracts from `src/server/services` into client files for new code.
- Existing exceptions should be migrated by moving the contract type to `src/types` and re-exporting from the server module for compatibility.

## Component Placement

- Single-screen components belong next to the page that owns them.
- Components reused by two or more screens belong under `src/components/features/<domain>/`.
- Pure functions, constants, and type-only helpers belong in `*.shared.ts`, `*.helpers.ts`, `src/lib`, or `src/types` depending on ownership.
- File names stay kebab-case. `src/phos/` is the historical exception boundary.
