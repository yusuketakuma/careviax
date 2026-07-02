# FE/BE Alignment

Snapshot: 2026-07-02 02:10 JST

## Current Status

- Status: active audit artifact.
- Latest code slice:
  `RR-BUG-20260702-0210-room-token-client-warning`.
- Latest slice impact:
  - Collaboration room-token transient failures now emit throttled safe
    structured warnings when fetch rejects, `/api/collaboration/room-token`
    returns 429/5xx, or the token payload is malformed/expired.
  - No endpoint path, HTTP method, request body, response envelope/status code,
    pagination shape, nullable/optional contract, enum values, date format,
    frontend caller behavior, auth/RLS behavior, external send behavior, or
    no-store boundary was changed.

## Verified In Latest Slice

- `fetchCollaborationRoomToken()` still returns `transient-error` for rejected
  fetches, 429/5xx responses, malformed payloads, and expired payloads.
- It still returns `access-denied` for non-transient non-ok responses.
- The warning regressions prove transient failure is observable and warning
  context excludes entity id, raw patient, and room-token sentinels.
- Collaborative form hook tests still pass with the existing retry,
  `Retry-After`, access-denied, and provider lifecycle behavior.

## Open Alignment Audit Queue

- Re-audit frontend callers for query-param names and enum/status assumptions
  before any FE/BE contract change.
- Treat response envelope, status-code, pagination, nullable/optional, and date
  format changes as proposal-only unless focused frontend/backend tests prove
  compatibility.
- Do not alter DB, auth/authz, tenant, audit, billing, medical workflow, or
  external send semantics from this artifact without explicit approval.

## Latest Classification

- A/B implemented: none in this artifact-only update beyond the already
  validated route observability fix.
- C/D/E proposal-only: no new FE/BE contract change is proposed by the latest
  slice.
