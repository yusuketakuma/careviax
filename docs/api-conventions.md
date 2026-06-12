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

## Tenant Boundary

- Every read must include an application-layer `org_id: ctx.orgId` constraint where the model is tenant scoped.
- Every write must run inside `withOrgContext(ctx.orgId, async (tx) => { ... })` unless the route is deliberately system scoped.
- Keep audit writes in the same transaction as the mutation they describe.

## Audit Logs

- Use `createAuditLogEntry(tx, ctx, { action, targetType, targetId, changes })` from `src/lib/audit/audit-entry.ts` for new and touched `withAuthContext` routes.
- Keep `changes` small and structured. Do not put patient names, addresses, free-text clinical notes, message bodies, transcripts, or other PHI content into `changes`.
- Use snake_case actions and Prisma model names for `targetType`.

## Responses

- Preserve existing response shapes. Do not change an existing route from raw JSON to `{ data }`, or the reverse, as part of a refactor.
- List endpoints should normally return `{ data, total?, cursor? }`.
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
