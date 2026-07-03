# P0 Proposal

Snapshot: 2026-07-02 02:10 JST

## Proposal-Only Boundary

The following areas remain proposal-only unless explicitly approved:

- DB schema, migrations, backfills, and indexes.
- RLS policies and tenant-selection semantics.
- Auth/authz behavior and permission meaning.
- Audit-log semantics and retention behavior.
- Billing, medical workflow, medication identity, prescription, patient data,
  and external send semantics.
- Production config, secrets, deployment, and dependency upgrades.

## Latest Slice

- Change ID: `RR-BUG-20260702-0210-room-token-client-warning`.
- P0 change made: none.
- P0 proposal created: none.
- Reason:
  - The latest code slice changed safe client-side operational logging for
    existing collaboration room-token transient failure paths.
  - No DB schema/data, migration, RLS, auth/authz, audit semantics, billing,
    external send semantics, production config, secret, dependency behavior, or
    destructive operation was changed.

## Open Proposal Queue

- Move any future finding here when fixing it would require DB, RLS, auth/authz,
  audit, billing, medical workflow, external contract, production, secret, or
  dependency changes.
- Do not implement proposal-only items from this file without explicit current
  approval.
