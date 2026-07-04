# Care Report Amend / Void / Unlock Proposal

- Status: draft for Claude / Fable / human compliance review
- Scope: W3-B6a Slice4 design only. No code, schema, migration, endpoint, or permission change is approved by this document.
- Grounding documents:
  - `docs/design/care-report-finalize-lock-human-gate-proposal.md`
  - `docs/visit-report-collab-spec.md`
  - `docs/design/care-report-finalize-lock-design.md`

## Executive Decision

Do not implement generic unlock in v1.

The safe v1 posture is:

1. Keep finalized reports immutable.
2. Treat void as a governance-only exclusion marker, not a delete or edit.
3. Treat amend as a new revision-chain operation that supersedes the finalized original without mutating or deleting it.
4. Require explicit human/compliance sign-off before any void, unlock, or amend endpoint is implemented.

This follows the human-gate proposal's Decision 6: generic unlock is not exposed, void needs a governance role and reason, and amend is the normal correction path only after immutable revision support exists. It also follows `docs/visit-report-collab-spec.md` RPT-007 / ARCH-10: finalized records must preserve creator/finalizer/time/change history, prevent post-finalize alteration, and keep corrections as reasoned new versions.

## Traceability

- Generic unlock out of v1 scope: `docs/design/care-report-finalize-lock-human-gate-proposal.md` Decision 6 recommends "unlock: not available in v1" and says unlock can weaken the legal-record boundary.
- Void as governance-only exclusion: `docs/design/care-report-finalize-lock-human-gate-proposal.md` Decision 6 says void is allowed only for an admin-level clinical governance role or equivalent explicit permission, with reason and audit metadata.
- Amend as revision-chain correction: `docs/design/care-report-finalize-lock-human-gate-proposal.md` Decision 2 requires a separate immutable revision table before content-changing amendments, and Decision 3 keeps `CareReport` as the current row while historical revisions live under `CareReportRevision`.
- Immutable original guarantee: `docs/visit-report-collab-spec.md` RPT-007 / ARCH-10 requires finalized content to be locked against tampering and post-finalize corrections/addenda to remain as reasoned new versions.
- Test and implementation sequencing: `docs/design/care-report-finalize-lock-design.md` section 13 lists amendment draft creation as `report_revision + 1` with old versions immutable, and section 15 places amendment/revision chain after finalize endpoint and lock guards.

## Generic Unlock

Generic unlock is out of scope for v1.

Rationale:

- The human-gate proposal explicitly recommends `unlock: not available in v1`.
- The same document says unlock can weaken the legal-record boundary and should be avoided in favor of amendment.
- The visit-report collaboration spec allows un-lock only as a restricted, audited operation, not as a normal correction mechanism.

Allowed v1 behavior:

- No generic `unlock` endpoint.
- No UI affordance that implies a finalized report can simply become editable again.
- No clearing of `locked_at` / `locked_by` for clinical content correction.

Future unlock, if ever approved, requires a separate human/compliance decision covering:

- break-glass permission name
- reason code taxonomy
- mandatory free-text reason
- whether two-person approval is required
- audit visibility and retention
- exact field effects on `unlocked_at`, `unlocked_by`, `unlock_reason`, `locked_at`, and `content_hash`

## Void

Void is not an edit path. It marks a finalized report as excluded from active use while preserving the immutable original and its revision snapshot.

Recommended v1 policy:

- Permission: new explicit governance permission, for example `canVoidCareReport`, held only by an admin-level clinical governance role.
- Required input:
  - `expected_updated_at`
  - `void_reason_code`
  - `void_reason`
- Preconditions:
  - report belongs to the actor's organization
  - actor can access the report source
  - report is finalized and locked
  - report is not already voided
  - optimistic claim succeeds on `updated_at`
- Disallowed:
  - changing `content`
  - changing `template_id`
  - deleting the report
  - deleting any `CareReportRevision`
  - clearing `finalized_at`, `finalized_by`, `locked_at`, `locked_by`, or `content_hash`

Field effects:

- Set `voided_at = now`.
- Set `voided_by = actor user id`.
- Set `void_reason = normalized reason code plus short reason text, or split fields if a later migration adds `void_reason_code`.
- Keep `finalized_at` unchanged.
- Keep `locked_at` unchanged.
- Keep `report_revision` unchanged.
- Keep `content_hash` unchanged.
- Keep existing `CareReportRevision` rows unchanged.

Audit shape:

- Action: `care_report_voided`.
- Target: `care_report`.
- Include:
  - `report_id`
  - `revision_no`
  - `content_hash`
  - `void_reason_code`
  - redacted `void_reason` summary or normalized reason text
  - actor role snapshot
  - `voided_at`
- Exclude:
  - full report content
  - raw clinical body text
  - credential number
  - delivery proof payloads

Gate:

Void requires explicit human/compliance sign-off before implementation. It changes the active legal status of a finalized medical record, even though it does not mutate the original content.

## Amend

Amend is the normal correction path, but it must be revision-chain based.

Amend must not mean "unlock and edit the finalized record." The finalized original remains immutable and hash-verifiable. A correction creates a superseding revision path.

Recommended v1 semantics:

- Permission: pharmacist/report authoring permission plus any compliance-approved amendment permission. `canAuthorReport` alone may be sufficient only if human/compliance explicitly approves.
- Required input:
  - `expected_updated_at`
  - `amend_reason`
  - optionally `base_revision_no`
- Preconditions:
  - report belongs to the actor's organization
  - actor can access the report source
  - report is finalized and locked
  - report is not voided
  - current finalized revision exists in `CareReportRevision`
  - optimistic claim succeeds on `updated_at`

Revision-chain guarantee:

- The finalized original is never overwritten or deleted.
- The existing `CareReportRevision` row for `revision_no = n` remains immutable.
- The current `CareReport` row can remain the canonical "current report" pointer, but any edit must be represented as revision `n + 1`.
- The new amended draft starts from a copy of the finalized clinical content, not by mutating the finalized revision row.
- When the amended draft is finalized, a new `CareReportRevision` row is created with:
  - `revision_no = n + 1`
  - `content_snapshot` for the new finalized content
  - `content_hash` for the new finalized content
  - `amend_reason`
  - `supersedes_revision_no = n`
  - `created_by`
  - `created_at`

Recommended field effects at "amend started":

- Set `report_revision = n + 1`.
- Set `status = draft` only if the compatibility model continues to use `CareReport` as the current editable pointer.
- Clear `finalized_at`, `finalized_by`, `locked_at`, `locked_by`, `content_hash`, `finalized_pharmacist_credential_id`, `finalized_credential_type`, `finalized_credential_number`, `finalized_credential_role_snapshot`, and `finalized_credential_checked_at` on the current pointer only after human/compliance confirms this pointer model.
- Keep prior immutable `CareReportRevision(revision_no = n)` unchanged.
- Do not create a new `CareReportRevision` for `n + 1` until the amended draft is finalized, unless a draft-revision table is separately approved.
- Do not set `voided_at` on amendment start.

Recommended field effects at "amended draft finalized":

- Set `finalized_at = now`.
- Set `finalized_by = actor user id`.
- Set `locked_at = now`.
- Set `locked_by = actor user id`.
- Set `content_hash = hash(new finalized clinical content)`.
- Keep `report_revision = n + 1`.
- Insert `CareReportRevision(revision_no = n + 1, amend_reason, supersedes_revision_no = n)`.

Audit shape:

- Amendment started:
  - Action: `care_report_amendment_started`.
  - Include old/new revision numbers, old content hash, amend reason metadata, actor role snapshot, and timestamp.
  - Exclude full content.
- Amended draft finalized:
  - Reuse finalization audit shape and include `supersedes_revision_no` and `amend_reason`.

Gate:

Amend requires explicit human/compliance sign-off before implementation because it reopens a finalized medical record path. It is safer than unlock, but still changes the current clinical record pointer.

## Field Behavior Matrix

| Path                    | `finalized_at` / `finalized_by`                 | `locked_at` / `locked_by`                       | `voided_at` / `voided_by`         | `report_revision`    | `content_hash`                      | Revision chain                           |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------- | --------------------------------- | -------------------- | ----------------------------------- | ---------------------------------------- |
| Unlock                  | Not available in v1                             | Not available in v1                             | Not applicable                    | No change            | No change                           | No new revision                          |
| Void                    | No change                                       | No change                                       | Set on successful governance void | No change            | No change                           | Existing revisions remain immutable      |
| Amend started           | Clear only if current-pointer model is approved | Clear only if current-pointer model is approved | No change                         | Increment to `n + 1` | Clear until amended draft finalizes | Prior revision `n` remains immutable     |
| Amended draft finalized | Set to new finalizer/time                       | Set to new finalizer/time                       | No change                         | Keep `n + 1`         | Set to new finalized content hash   | Insert revision `n + 1`, superseding `n` |

## Human / Compliance Sign-Off Required

Required before any implementation:

- generic unlock: human/compliance must explicitly approve whether it exists at all. Current recommendation is no v1 unlock.
- void: approve governance permission, reason taxonomy, audit payload, and whether two-person approval is required.
- amend: approve current-pointer behavior, whether `canAuthorReport` is enough, reason requirements, revision-chain semantics, and response/UI behavior.
- all paths: approve audit redaction rules and whether credential snapshots may appear in response or audit metadata.

Implementation must not begin until these decisions are recorded in a human-gated design update or equivalent approval artifact.

## Implementation Order After Approval

1. Add tests proving finalized originals and existing revision rows are never mutated or deleted.
2. Add void only if governance policy is approved.
3. Add amend-start only if current-pointer behavior is approved.
4. Add amended-finalize revision tests proving `supersedes_revision_no` and `amend_reason`.
5. Keep unlock absent unless a separate break-glass approval is recorded.
