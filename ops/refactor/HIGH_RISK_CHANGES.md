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

## API-CONTRACT-001FZINSTITUTIONSSTRICT

- Classification: Controlled medical-master/contact operational read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, provider, POST/PATCH/DELETE, or production data mutation changed.
- Safety/privacy control: legacy root, duplicate identity, blank identity, negative prescription count, invalid prescribed date, pagination drift, and overlong contact/text fields fail closed; provider-only organization/timestamp/relation fields are stripped before authorized table/edit state.
- Operational note: authorized institution contact and prescription-usage aggregate remain in-app only; no raw patient record, provider relation, or external output is introduced by this slice.

## API-CONTRACT-001FZPACKAGINGSTRICT

- Classification: Controlled packaging-configuration operational read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets, deployment, provider, POST/PATCH/audit, or production data mutation changed.
- Safety/privacy control: legacy root, duplicate identity, blank/overlong text, negative sort/count, wrong count basis, empty-filter drift, limit overflow, and inconsistent counted metadata fail closed; provider-only timestamps/org fields are stripped before authorized list/form state.
- Operational note: authorized packaging configuration remains in-app only; no patient detail, provider metadata, or external output is introduced by this slice.

## API-CONTRACT-001FZMASTERHUBSTRICT

- Classification: Controlled admin aggregate freshness/action read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets,
  deployment, provider, mutation, or production data change.
- Safety control: strict root and exact 11-card set, duplicate/completeness detection, valid timestamps, bounded
  non-negative counts/ages, status-count relation, internal hrefs, and malformed/legacy/unsafe/incomplete fail-closed
  regressions protect authorized freshness/action state; provider-only nested fields are stripped before query state.
- Operational note: authorized master detail and shared right-rail content remain in-app only; no raw patient detail,
  provider metadata, or external output is introduced by this slice.

## API-CONTRACT-001FZVEHICLESTRICT

- Classification: Controlled vehicle/configuration operational read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets,
  deployment, provider, mutation, or production data change.
- Safety control: strict counted vehicle list and site-option schemas reject legacy roots, duplicate identities, invalid
  site/travel/operation/date fields, negative or inconsistent counts, and provider-only state before authorized vehicle
  editor state; nested provider metadata is stripped.
- Operational note: authorized vehicle configuration remains in-app only; no patient detail, provider metadata, or external
  output is introduced by this slice.

## API-CONTRACT-001FZOPERATINGHOURSSTRICT

- Classification: Controlled operating-day/settings operational read/write response boundary, but not a high-risk
  controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets,
  deployment, provider, mutation implementation, or production data change.
- Safety control: strict site-option and operating-hours GET/PUT schemas reject legacy roots, duplicate/mismatched site or
  weekday identity, malformed time/source/configuration state, invalid resolved calendar rows, and provider-only metadata
  before authorized settings/editor state; stale-version conflict and audit behavior remain unchanged.
- Operational note: authorized operating-day configuration remains in-app only; no patient detail, provider metadata, or
  external output is introduced by this slice.

## API-CONTRACT-001FZSERVICEAREASTRICT

- Classification: Controlled admin master-data read, but not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets,
  deployment, provider, mutation, or production data change.
- Safety control: strict site-option and counted service-area schemas reject legacy roots, duplicate or blank identities,
  mismatched nested sites, invalid area type/geo object, count arithmetic drift, and provider-only metadata before
  authorized editor/list state; mutation acknowledgement behavior remains unchanged.
- Operational note: authorized service-area configuration remains in-app only; no patient detail, provider metadata, or
  external output is introduced by this slice. No cleanup was performed despite transient build filesystem pressure.

## API-CONTRACT-001FZMENTIONSTRICT

- Classification: Low-risk authorized staff-identity lookup read, not a high-risk controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets,
  deployment, provider, comment mutation, or production data change.
- Safety control: strict minimal id/name schema and counted metadata reject legacy roots, blank/invalid identities, count
  drift, and conflicting repeated names; provider-only staff contact/account/capacity/credential metadata is stripped
  before the mention cache.
- Operational note: staff mention candidates remain authorized in-app identity data only; comment mention IDs and PHI-safe
  recovery behavior are unchanged. No external output or cleanup was performed.

## API-CONTRACT-001FZCONFLICTPHARMACIST

- Classification: Low-risk authorized staff-identity lookup read reused in a schedule-conflict surface; not a high-risk
  controlled change.
- Scope decision: no DB schema/migration, auth/authz implementation, tenant query, audit semantics, billing, secrets,
  deployment, provider, schedule mutation, production-data, or external-send operation changed.
- Safety control: strict minimal id/name schema and counted metadata reject legacy roots, blank/invalid identities, count
  drift, and conflicting repeated names; provider-only staff contact/account/capacity/credential metadata is stripped
  before conflict analysis and Plan A candidate state.
- Operational note: authorized pharmacist identity candidates remain in-app only; schedule reorder/reconfirmation,
  patient detail, and PHI/audit behavior are unchanged. No external output or cleanup was performed.
