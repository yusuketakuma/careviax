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

---

## 2026-07-03 A1 FE/BE Alignment Scan (investigation-only, no source edits)

Scope: 5 domains (patients / visit-records / prescriptions+intakes /
billing-candidates / care-reports). Compared FE `fetch`/`useQuery`/
`useMutation` call sites and their local response types against the actual
`success(...)`/zod shapes returned by the corresponding API routes. Ledger-only
per task discipline; no source files touched.

### Finding 1 — `visit_geo_log` dead field on visit record detail (confirmed, live regression)

- **Where**: `src/app/api/visit-records/[id]/route.ts` (GET, `authenticatedGET`)
  vs `src/app/(dashboard)/visits/[id]/visit-record-detail.tsx`.
- **What**: Commit `da9c2c28` ("fix(api): harden visit record detail reads",
  2026-06-26) added an explicit
  `delete (publicRecord as { visit_geo_log?: unknown }).visit_geo_log;` before
  the response is built, and `route.test.ts` now asserts
  `expect(body).not.toHaveProperty('visit_geo_log')`. So the GET response
  **never** includes `visit_geo_log`, by design (looks like a deliberate
  redaction of raw lat/lng alongside `patient_state_snapshot`).
- **FE still expects it**: `VisitRecordFull` type declares
  `visit_geo_log: VisitGeoLog | null` (line 174), and the component:
  - reads `record.visit_geo_log?.start`/`.end` to decide whether to show an
    attachments/geo summary row (line 763),
  - gates an entire "訪問位置情報" (visit geolocation) card block on
    `record.visit_geo_log?.enabled` and renders start/end `GeoLocationCard`s
    and the permission state string (lines 1197-1211).
  - Net effect: `record.visit_geo_log` is always `undefined` on the client, so
    this whole UI section is now permanently dead — it silently never renders,
    even when geo tracking data exists and `visit_geo_log.enabled` would be
    true server-side.
- **Confirmed not stale**: FE file was touched again in later, unrelated
  refactor commits (`f576fd75`, `d5b5bfb3`, `f55d7089`, all 2026-07-03,
  well after the `da9c2c28` hardening commit) without anyone noticing/fixing
  the now-dead geo card, i.e. this is a persisting regression, not something
  already queued for cleanup.
- **Classification**:
  - **A (safe, immediate)**: remove the dead `visit_geo_log` FE branch/type
    field in `visit-record-detail.tsx` (behavior-neutral — the block never
    renders today, so deleting it changes nothing observable, only removes
    dead code + a misleading type field).
  - **C (flag, contract change)**: alternatively, restore a *sanitized*
    `visit_geo_log` (e.g. `enabled`/coarse fields only, no raw
    lat/lng if that was the redaction's intent) to the API response so the
    geolocation card can render again for pharmacists doing home-visit
    compliance checks. This needs an explicit decision on what part of geo
    data is safe to re-expose post-hardening — not something to auto-implement.
  - No DB/auth/tenant/billing/audit/PHI-meaning change either way (P0 does not
    apply), but re-exposing location data is a judgment call → flagged, not
    proposed as auto-implementable.

### Finding 2 — `care_reports/[id]` `content` is conditionally omitted but FE type + call sites assume it's always present (weak, no observed crash)

- **Where**: `src/app/api/care-reports/[id]/route.ts` GET —
  `...(canLoadEditableContent ? { content: report.content } : {})` where
  `canLoadEditableContent = permissions.can_edit || permissions.can_send`.
  For a viewer with neither permission, `content` is entirely absent from the
  JSON body.
- **FE**: `src/app/(dashboard)/reports/[id]/page.tsx` types `content` as
  non-optional (`content: PhysicianReportContent | CareManagerReportContent |
  AudienceReportContent`) and calls `isPhysicianReportContent(report.content)`,
  `readReportContentObject(report.content)`, `readReportBillingContext`,
  `readReportWarnings`, `deriveReportComplianceChecks` unconditionally,
  independent of `permissions.can_edit`/`can_send`.
- **Why it's not flagged as a live crash**: the FE type-guard/reader helpers
  all accept `unknown` and fail closed (return `false`/`null`) on `undefined`,
  so no runtime throw — but any view-only role that can reach this page without
  edit/send rights would silently see empty content/compliance/billing-context
  sections with no explicit "権限がありません" messaging, which may or may not
  be the intended UX.
  Impact scope depends on whether such a view-only-but-not-edit/send role
  actually reaches `/reports/[id]` in practice (not verified in this pass).
- **Classification**: **B** (would need a small FE/BE test pair to lock the
  optional-content contract, e.g. `content?: ... | undefined` on the FE type,
  before "fixing" the type — not urgent, no confirmed user-facing crash today).

### Not re-flagged (already consumed / out of scope for this pass)

- `search-params` strict-optional convergence (RR-QP-A/B + billing-candidates)
  and false-empty (`isError` unhandled) patterns — per task briefing, these
  are already consumed by prior waves; none re-observed as regressed in the
  sampled files.
- `/api/prescription-intakes` list route deliberately omits `lines`,
  `original_document_url`, `prescriber_institution_ref` (test-locked); checked
  FE and confirmed the only callers reading those fields
  (`prescription-inline-detail.tsx`, `prescriptions/[id]/prescription-detail-content.tsx`)
  fetch the **detail** endpoint (`/api/prescription-intakes/:id`) separately,
  not the list — no mismatch.
- `billing-candidates` list response `billing_month` is a `Date` field
  serialized to ISO datetime by Prisma/JSON, while the FE type declares
  `billing_month: string`; checked all FE usages and found no code path that
  renders/parses `candidate.billing_month` from the list response (only used
  as a query-string builder input elsewhere) — technically loose typing, not
  a live bug, not re-flagged as a finding.
- `prescription-intakes` create payload (`source_type`, `prescription_category`,
  `emergency_category`, etc.) cross-checked against
  `createPrescriptionIntakeSchema` in `src/lib/validations/prescription.ts` —
  enum values match exactly (`SOURCE_CONFIG` vs zod `.enum([...])`); no drift.
- Core `patients` create/update path uses the same shared zod schemas
  (`src/lib/validations/patient.ts`) as both FE form validation and BE route
  parsing — single source of truth, low mismatch risk by construction; not
  deep-dived further this pass given time budget.

### Audit coverage note

This pass sampled representative FE callers per domain rather than
exhaustively diffing every sub-resource route (patients has ~50+ sub-routes
under `/api/patients/[id]/*`). Recommend a follow-up pass specifically on
`patients/[id]/{labs,mcs,structured-care,packaging,readiness}` sub-resources,
which were not opened this round.
