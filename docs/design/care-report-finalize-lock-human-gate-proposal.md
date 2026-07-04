# Care Report Finalize / Lock Human-Gate Decision Proposal

- Status: draft for Fable / human approval
- Scope: W3-B6a / RPT-007 decision package before any code, schema, or migration change
- Base design: `docs/design/care-report-finalize-lock-design.md`
- Non-goal: implementation, Prisma schema edit, migration file, endpoint change, permission change, Object Lock setup, delivery proof hard gate, retention resolver, monthly count logic

## Executive Recommendation

Approve an **Option B-first** rollout:

1. Add nullable finalize / lock / hash / revision metadata to the existing `CareReport` row.
2. Keep existing API response shape and `updated_at` / `expected_updated_at` optimistic locking.
3. Define finalized content immutability before adding any new write path.
4. Do not enable content-changing amendment until a separate immutable revision record strategy is approved.
5. Treat delivery proof, retention, Object Lock, and dynamic monthly building counts as follow-up slices B6b / B6c / B6d.

This preserves the current one-report-per-source contract while establishing the legal-record boundary. It avoids a high-risk table split as the first migration, but it does not pretend same-row overwrites are a valid revision history.

## Current Evidence

- `CareReport` currently has `status`, `content`, `template_id`, `pdf_url`, `created_by`, `created_at`, and `updated_at`, but no finalized / locked / revision / hash / finalizer credential / retention columns.
- `PATCH /api/care-reports/[id]` already requires `expected_updated_at`, rejects content/template edits after non-draft status, permits only `draft -> confirmed` in that route, and writes `care_report_confirmed` audit.
- `report-generator` already requires the current draft `updated_at` token before refreshing an existing draft.
- `send` currently updates `CareReport.content` by merging delivery targets after delivery, so hash boundaries must be settled before content hashing is enforced.
- `PharmacistCredential` has no `(id, org_id)` composite unique key, so same-org FK hardening for finalizer credential evidence requires an explicit migration decision.

## Decision 1: Option B vs Option C

### Recommendation

Choose **Option B-first** for the first approved migration:

- Keep the current `CareReport` row as the canonical current report record.
- Add nullable finalize / lock / hash / revision metadata directly to `CareReport`.
- Do not split reads/writes to a new legal-record table in the first slice.
- Preserve current serializers and route response shape.

### Rationale

- It is the least disruptive path for the existing report detail, generation, send, PDF, analytics, and sharing paths.
- It lets the first migration be additive and reversible in behavior.
- It preserves the existing partial unique index on `(org_id, visit_record_id, report_type)` and the partner-visit unique key without immediate redesign.
- It allows a dual-read / no-behavior-change slice before enforcing new finalize semantics.

### Rejected for the first slice

Do not choose full **Option C** as the first migration. A separate current-row / revision-row model is cleaner for legal history, but it forces broader serializer, join, write-path, and backfill changes before the core immutability contract is proven.

### Guardrail

Option B-first is not approval to overwrite finalized clinical content. It is approval to add metadata and enforce lock boundaries incrementally. True amendment history remains gated by Decision 2.

## Decision 2: Same-Row Amendment Metadata vs Revision Table

### Recommendation

Use **same-row metadata only for finalize / lock / void / unlock state**, and require a **separate immutable revision table before enabling content-changing amendments**.

Initial B6a migration may add fields such as:

- `report_revision Int @default(1)`
- `finalized_at`
- `finalized_by`
- `locked_at`
- `locked_by`
- `content_hash`
- `pdf_hash`
- `voided_at`
- `voided_by`
- `void_reason`
- `unlocked_at`
- `unlocked_by`
- `unlock_reason`

But content-changing amendment should remain disabled until a later slice adds an immutable revision record, for example:

- `CareReportRevision`
- `org_id`
- `report_id`
- `revision_no`
- `content_snapshot`
- `content_hash`
- `pdf_hash`
- `created_by`
- `created_at`
- `amend_reason`
- `supersedes_revision_no`

### Rationale

- Same-row amendment overwrites cannot prove RPT-007 history preservation.
- A revision table avoids fighting the existing one-current-report-per-source contract.
- Keeping `CareReport` as the current pointer avoids breaking existing UI/API paths.
- Deferring amendment writes avoids pretending audit logs alone are a clinical legal-record version store.

### Human-Gate Decision

Approve one of these:

- **Recommended**: finalize/lock metadata now; amendment endpoint remains unavailable until `CareReportRevision` exists.
- Alternative: add `CareReportRevision` in the first migration and accept the larger migration/review scope.

## Decision 3: Visit / Partner Report Revision Unique-Key Strategy

### Recommendation

Preserve existing `CareReport` uniqueness for the current row:

- visit source: one current `CareReport` per `(org_id, visit_record_id, report_type)`
- partner source: one current `CareReport` per `(org_id, partner_visit_record_id, report_type)`

Put revision uniqueness on the revision table:

- `@@unique([org_id, report_id, revision_no])`
- `@@index([org_id, report_id])`
- optional `@@unique([org_id, report_id, content_hash])` only if duplicate snapshot rejection is desired

### Rationale

- Adding `report_revision` to the existing source unique keys would permit multiple `CareReport` rows for the same report source and type, forcing every current consumer to choose "latest" correctly.
- Leaving existing unique keys intact prevents accidental duplicate current reports.
- Revision rows can model history without changing list/detail source lookup semantics.

### Human-Gate Decision

Approve that `CareReport` remains the current report row and historical revisions live under `CareReportRevision` before amendment is exposed.

## Decision 4: Content Hash Boundary

### Recommendation

Hash **clinical report content only**, excluding delivery metadata.

Define finalized content as:

- report body sections
- structured clinical fields
- source provenance snapshot
- billing context snapshot, if present at finalize time
- warnings present at finalize time, if clinically meaningful

Exclude from content hash:

- delivery attempts
- delivery target status
- send request IDs
- recipient acknowledgement state
- proof artifact metadata
- retry/failure metadata

Move delivery/proof state toward `DeliveryRecord`, `CareReportSendRequest`, or a future proof table instead of mutating `CareReport.content` after finalization.

### Rationale

- The current send route mutates `CareReport.content` with delivery target data. If the whole JSON blob is hashed, send would invalidate the finalization hash or force send to become part of finalization.
- Delivery proof is B6b and has a different lifecycle from clinical content.
- Hashing a clinical subset gives a stable legal-record boundary and keeps delivery operations server-managed.

### Human-Gate Decision

Approve one of these:

- **Recommended**: delivery metadata is excluded from the finalized content hash and migrated out of `content` over follow-up slices.
- Alternative: delivery metadata remains inside hash, but then finalize and send must be redesigned as one combined lifecycle.

## Decision 5: Finalizer Credential Source and FK / App-Layer Policy

### Recommendation

Use `PharmacistCredential` as the finalizer credential evidence source, with two-phase hardening:

1. First B6a schema proposal:
   - add nullable finalizer fields on `CareReport`
   - validate active credential in app-layer at finalize time
   - persist credential ID, credential type/number snapshot if approved, finalizer user ID, role snapshot, and checked timestamp
2. Same or follow-up migration:
   - add `@@unique([id, org_id])` to `PharmacistCredential`
   - add same-org FK from `CareReport(finalized_pharmacist_credential_id, org_id)` to `PharmacistCredential(id, org_id)` if Prisma/migration review confirms safety

### Rationale

- Finalization requires evidence that the actor was an authorized pharmacist at the time of finalization.
- `User.role` alone is not enough for RPT-007.
- Same-org FK hardening is desirable, but it requires an explicit migration because the current credential model does not expose `(id, org_id)` as a composite unique target.
- Snapshot fields protect against later credential drift.

### Human-Gate Decision

Approve:

- authoritative credential source
- what credential fields may be snapshotted
- whether first migration includes composite unique + FK or starts app-layer-only
- behavior when no active credential exists

Recommended behavior when no active credential exists: reject finalize with 403/409-style domain error and no report mutation.

## Decision 6: Unlock / Void Role, Reason, and Audit Rules

### Recommendation

Do not expose generic unlock. Use narrow break-glass style controls:

- `void`: allowed only for admin-level clinical governance role or equivalent explicit permission
- `unlock`: avoided for clinical content; prefer amendment flow. If present, require break-glass permission, reason code, free-text reason, and audit record.
- `amend`: normal correction path, but only after revision table support exists

Required fields:

- reason code
- reason text
- actor ID
- actor role snapshot
- timestamp
- target report ID
- previous status / lock state
- affected revision number

Audit:

- write structured `AuditLog` entries inside the same transaction
- do not store raw clinical body text in `AuditLog.changes`
- include hashes / revision IDs / reason metadata rather than full content

### Rationale

- Unlock can silently weaken the legal-record boundary.
- Void preserves the original immutable record while excluding it from active use.
- Amendment with revision history is safer than unlock-and-edit.
- Audit must prove who did what without duplicating PHI-heavy content.

### Human-Gate Decision

Approve exact roles/permissions and reason taxonomy before implementation.

Recommended initial policy:

- finalize: pharmacist with active credential and `canAuthorReport`
- void: admin/governance role with explicit reason
- unlock: not available in v1
- amend: unavailable until revision table exists

## Additive-First Implementation Sequence

### Slice 1: Additive Migration / Dry Run

- Add nullable metadata fields.
- Optional: add `PharmacistCredential @@unique([id, org_id])`.
- Optional: add same-org FK only if approved.
- No route behavior change.
- Run migration status, Prisma validate/generate, schema-focused tests.

### Slice 2: Dual Read / No Behavior Change

- Include new fields in internal selects only where needed.
- Do not expose new response fields unless explicitly approved.
- Keep current UI/API behavior unchanged.
- Add tests proving existing draft edit, confirm, send, and generate paths still behave as before.

### Slice 3: Finalize Endpoint and Mutation Guard

- Add explicit finalize action or endpoint.
- Require `expected_updated_at`.
- Validate finalizer credential.
- Compute content hash.
- Set finalized/locked metadata.
- Reject finalized content/template mutation.
- Ensure report-generator does not refresh finalized reports.

### Slice 4: Amendment Flow

- Add revision table or approved amendment storage.
- Require reason.
- Preserve old revision snapshot.
- Create new draft amendment or current-row pointer update only after snapshot exists.

### Slice 5: B6b Delivery Proof

- Move proof semantics to `DeliveryRecord` / proof table.
- Require accepted proof for claimable hard gate.
- Avoid storing raw PHI-heavy proof metadata in audit logs.

### Slice 6: B6c Retention / Object Lock

- Add retention resolver.
- Compute retain-until.
- Apply Object Lock only after retention rule approval.

### Slice 7: B6d Monthly Count

- Add dynamic monthly count service.
- Store count snapshot/provenance at finalize or claim-record correction boundary.
- Do not mutate finalized clinical content after count correction.

## Required Approval Checklist

- [ ] Option B-first vs full Option C approved
- [ ] Amendment storage strategy approved
- [ ] Current-row vs revision-row unique-key strategy approved
- [ ] Content hash boundary approved
- [ ] Delivery metadata migration boundary approved
- [ ] Finalizer credential source approved
- [ ] Credential FK/app-layer policy approved
- [ ] Unlock / void / amend permission policy approved
- [ ] Audit payload redaction policy approved
- [ ] Implementation sequence approved

## Recommended PR Split

1. Design/human-gate approval document only.
2. Additive schema migration + Prisma generate + no behavior change tests.
3. Internal dual-read / serializer compatibility.
4. Finalize endpoint + lock guard + generator exclusion.
5. Revision/amendment flow.
6. Delivery proof hard gate.
7. Retention/Object Lock.
8. Dynamic monthly count connection.
