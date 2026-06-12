# Medical UI Safety Release Runbook

This runbook closes the release and operations checks that cannot be proven by
unit tests alone.

## Release Gate

Prepare the dedicated local E2E database, then run the production-style gate
before requesting release approval:

```bash
pnpm --config.verify-deps-before-run=false db:e2e:prepare
pnpm --config.verify-deps-before-run=false medical-ui:e2e:gate:prod
```

The gate must prove:

- Next.js production build completes.
- The app starts on `localhost:3012`.
- `DATABASE_URL` and `DIRECT_URL` point to local `ph_os_e2e`.
- Required package scripts and Playwright specs exist.
- The local E2E CareReport duplicate precheck returns `duplicate_groups:0`.
- The local E2E visit route_order conflict precheck returns `conflict_groups:0`.
- The local E2E migration precondition verifier returns no `severity:"error"`
  issues.
- Targeted Playwright/axe medical UI tests pass.

Use `db:e2e:check-care-report-duplicates` only for local E2E release
evidence. Use the generic `db:check-care-report-duplicates` command in the
target database migration precheck below.

Use `db:e2e:check-visit-route-order-conflicts` only for local E2E route-order
release evidence. Use the generic `db:check-visit-route-order-conflicts`
command in the target database route-order precheck below.

Use `db:e2e:verify-migration-preconditions` only for local E2E migration
precondition evidence. Use the generic `db:verify-migration-preconditions`
command in the target database migration preconditions below.

## Target Database Migration Precheck

Before applying the CareReport unique-index migration to any non-local
environment, run the environment-following duplicate precheck against that
target database:

```bash
DATABASE_URL='<target database url>' \
DIRECT_URL='<target direct database url>' \
pnpm --config.verify-deps-before-run=false db:check-care-report-duplicates
```

Stop the migration if the command exits non-zero for duplicate groups. Resolve
the duplicate CareReport rows first, then rerun the precheck.

The precheck intentionally prints only organization IDs, visit record IDs,
report type, counts, and report IDs. It must not be changed to print patient
names or report content.

## Target Database Route-Order Precheck

Before enforcing route-order invariants in any non-local environment, audit
active visit schedules and open visit schedule proposals for route-cell
conflicts:

```bash
DATABASE_URL='<target database url>' \
DIRECT_URL='<target direct database url>' \
pnpm --config.verify-deps-before-run=false db:check-visit-route-order-conflicts
```

Stop the rollout if the command exits non-zero for conflict groups. Resolve the
conflicting visit schedule/proposal route_order rows first, then rerun the
precheck.

## Target Database Migration Preconditions

Before applying pending hardening migrations to any non-local environment, run
the read-only migration precondition verifier against that target database:

```bash
DATABASE_URL='<target database url>' \
DIRECT_URL='<target direct database url>' \
pnpm --config.verify-deps-before-run=false db:verify-migration-preconditions
```

Stop the rollout if any `severity:"error"` issue is reported. Warnings, such
as a missing extension that the migration role is explicitly allowed to create,
must still be reviewed before applying migrations.

## PH-OS Audit Migration Verification

After PH-OS audit trigger/RLS migrations are applied in an approved database
environment, run the audit verifier. This command performs transaction-scoped
DML proof and rolls it back:

```bash
DATABASE_URL='<target database url>' \
DIRECT_URL='<target direct database url>' \
pnpm --config.verify-deps-before-run=false db:verify-ph-os-audit-migration
```

Stop the rollout if audit trigger contracts, no-op update behavior, audit
metadata, or RLS isolation checks fail.

## External Access Case-Boundary Precheck

Before releasing assignment-scoped external sharing, audit active legacy
`ExternalAccessGrant` rows that have case-backed scopes but do not yet store
`allowed_case_ids`:

```bash
DATABASE_URL='<target database url>' \
pnpm --config.verify-deps-before-run=false db:external-access-case-boundary-audit
```

If the dry run reports only `backfillable_grants`, review the reported row
count, choose an explicit upper bound, then rerun with `--apply --max-rows N`
to attach the single active case ID to each grant:

```bash
DATABASE_URL='<target database url>' \
pnpm --config.verify-deps-before-run=false db:external-access-case-boundary-audit -- --apply --max-rows 100
```

Stop release if the command reports blockers. `multiple_active_cases` requires
an owner/clinical decision about which case the issued link may cover, while
`no_active_case` and `unsupported_self_report_history_only` should be revoked
or allowed to expire with audit notes. Do not broaden legacy grants to all
patient cases to preserve compatibility.

## Medication-Safety Master Updates

Use the manual clinical import endpoint for safety-display overrides that do
not come from public drug master sources yet.

Payload shape:

```json
{
  "drug_safety_overrides": [
    {
      "yj_code": "2119401A1020",
      "tall_man_name": "DOBUTamine注100mg",
      "lasa_group_key": "dobutamine_dopamine",
      "is_lasa_risk": true,
      "is_high_risk": true
    }
  ]
}
```

Expected UI/API effects:

- `/admin/drug-masters` can filter high-risk and LASA records.
- Drug master list/detail shows Tall Man, LASA, and high-risk indicators.
- Prescription history and CDS alerts use the Tall Man display name when
  available.
- CDS emits a warning for LASA/high-risk drug master flags.

## Human-Factors Operations Review

The following items require facility owner or clinical lead sign-off before
production rollout:

- CDS outage procedure when prescription safety checks are unavailable.
- Whether report sending requires two-person verification for specific
  facilities or recipient types.
- Whether LASA/Tall Man overrides are maintained centrally or per site.
- Audit-log retention period and who may review report-send and status-change
  audit records.
- Training note for pharmacists: verify patient, drug name, dose, route,
  recipient, and channel before completing high-risk actions.

Record sign-off in the release ticket. Do not treat automated tests as proof of
regulatory or facility-policy acceptance.
