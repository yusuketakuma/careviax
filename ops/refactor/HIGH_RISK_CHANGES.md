# High-risk Changes

## API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT

- Classification: Not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety control: malformed, cross-organization, out-of-window, inconsistent, duplicate, or possibly truncated successful responses fail closed before calendar/shift state is used.
- Human review: no external human gate required for this local contract slice; later staging/live migration work remains governed by the existing Plans human-gate entries.

## API-CONTRACT-001FZJOBLISTSTRICT

- Classification: Not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety control: malformed, duplicate, unsafe-endpoint, cross-definition, unsupported-status, invalid-count/timestamp, or non-redacted error metadata in a successful response fails closed before jobs state is used.
- Human review: no external human gate required for this local read-contract slice; provider and mutation semantics remain unchanged.
