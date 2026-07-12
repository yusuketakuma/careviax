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

## API-CONTRACT-001FZSTAFFMETRICSSTRICT

- Classification: Controlled administrative data read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety/privacy control: wrong-month, duplicate-identity, inconsistent-summary, invalid numeric, unsupported-role, or unknown-root success payloads fail closed; provider-only email/capacity metadata is removed from the client query state and no raw patient detail is added.
- Operational note: provider remains unchanged; a multi-membership duplicate staff identity is rejected rather than rendered as potentially overcounted KPI rows. Webpack cache emitted an ENOSPC warning because the filesystem was 95% full; build still exited 0 and no cleanup was performed.

## API-CONTRACT-001FZOPSINSIGHTSTRICT

- Classification: Controlled administrative aggregate read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety control: unknown root, reverse/duplicate month buckets, negative counts, duplicate process keys, invalid durations, and invalid/overlong hints fail closed before trend or bottleneck state is rendered.
- Operational note: provider aggregation and empty-state semantics remain unchanged; the build completed with existing CSS warnings and temporary filesystem pressure, without cleanup or destructive operations.

## API-CONTRACT-001FZSITESELECTREADSTRICT

- Classification: Controlled navigation/access-context read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety control: legacy root, missing pagination metadata, duplicate site identity, multiple current sites, negative visit count, or empty identity fails closed before site cards and switch navigation state.
- Operational note: existing PUT acknowledgement and provider membership authorization remain the source of truth; no client-side permission weakening was introduced.

## API-CONTRACT-001FZFACILITYUNITSSTRICT

- Classification: Controlled facility/occupancy operational read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety/privacy control: legacy root, duplicate unit identity, unsupported type, blank identity/text, negative patient/capacity/order value, or provider-only field is rejected or stripped before authorized facility-sheet state is used; patient-count aggregate remains in-app only.
- Operational note: facility/unit mutations, residence aggregation, GET authorization, no-store behavior, and provider semantics remain the source of truth; no occupancy data is logged or externalized by this slice.

## API-CONTRACT-001FZNOTIFICATIONSREADSTRICT

- Classification: Controlled PHI-adjacent operational notification read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, or production data mutation changed.
- Safety/privacy control: legacy root, duplicate identity, invalid content/date/read state, pagination drift, provider-only metadata, and unsafe external links are rejected or stripped before the authorized inbox state is used; persisted notification detail remains in-app only.
- Operational note: PATCH acknowledgement, SSE-safe redaction, org/user authorization, no-store behavior, and provider semantics remain the source of truth; no raw notification content is logged or sent to external systems by this slice.

## API-CONTRACT-001FZNOTIFICATIONBELLSTRICT

- Classification: Controlled PHI-adjacent notification badge/drawer read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, provider, PATCH, SSE, or production data mutation changed.
- Safety/privacy control: strict summary/list schemas reject legacy roots, negative/non-finite unread counts, malformed notification content/date/read state, duplicate identities, pagination drift, and unsafe external links; provider-only fields are stripped before in-app badge/drawer state.
- Operational note: in-app notification detail remains within the authorized surface; raw title/message/link are not passed to OS notification helpers, logged, or externalized by this slice.
