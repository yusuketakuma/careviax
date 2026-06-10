# Webhook Secret Backfill Runbook

This runbook covers the legacy `WebhookRegistration.secret` expand/backfill/contract path.
It must be treated as credential migration work.

## Current State

- New webhook registrations store `secret = NULL` and encrypted secret fields.
- Delivery and retry paths dual-read encrypted fields first and legacy plaintext only for existing rows.
- Existing plaintext rows must be backfilled before any plaintext wipe or contract migration.

## Preflight

Run the dry-run command first. It only reads aggregate counts and does not print secrets.

```bash
pnpm db:webhook-secrets:backfill --dry-run
```

For org-scoped maintenance roles under RLS, pass the org id:

```bash
pnpm db:webhook-secrets:backfill --dry-run --org-id org_xxx
```

The output must have:

- `ok: true`
- `applyReady: true`
- `partialEncryptedRows: 0`
- `unreadableRows: 0`
- `unsupportedAlgorithmRows: 0`

Confirm before write:

- The deployed app and job workers include dual-read support.
- `WEBHOOK_SECRET_ENCRYPTION_KEY` or `ENCRYPTION_KEY` is identical for app, job, and maintenance runtime.
- `WEBHOOK_SECRET_ENCRYPTION_KEY_ID` is fixed for the migration window.
- A backup/PITR restore point exists.
- No logs or artifacts will include plaintext secrets, ciphertext, IV, auth tag, or derived hashes.

## Backfill

Production `--apply` requires human approval. Keep writes bounded.

```bash
pnpm db:webhook-secrets:backfill --apply --max-rows 100 --batch-size 50
```

For org-scoped execution:

```bash
pnpm db:webhook-secrets:backfill --apply --org-id org_xxx --max-rows 100 --batch-size 50
```

The script:

- aborts unless `--max-rows` is provided with `--apply`
- encrypts row by row with AES-256-GCM
- verifies decrypt output inside the same transaction before commit
- keeps legacy `secret` populated during this phase for rollback safety
- avoids printing secret material

After each apply batch, run dry-run again and confirm remaining legacy rows decreased.

## Plaintext Wipe

Do not wipe plaintext in the same release as the first backfill. After a burn-in period proves
encrypted dispatch and retry behavior, run a separate approved migration or operator script to set
`secret = NULL` only for rows with complete encrypted fields.

After wipe, verify:

- plaintext remaining is zero
- encrypted fields are complete for every active registration
- webhook dispatch and retry smoke tests pass in staging

## Contract

In a later release:

- disable legacy plaintext fallback in code
- add validated DB constraints for encrypted-field completeness
- only then consider dropping the legacy `secret` column

## Do Not Do

- Do not run production `--apply` without approval.
- Do not rotate encryption keys during backfill.
- Do not roll back to pre-dual-read code after encrypted-only rows exist.
- Do not run `prisma db push`.
- Do not disable RLS, constraints, or webhook delivery foreign keys.
- Do not send real outbound webhook deliveries as migration validation.
