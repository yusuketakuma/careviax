# Architecture Docs

Architecture docs record cross-cutting system decisions that are broader than a
single runbook or implementation plan.

- [`aws-phos-deployment-stages.md`](./aws-phos-deployment-stages.md): AWS pilot,
  production-minimum, scale-out, tenant boundary, support-session, and
  freelance assignment deployment decision record.
- [`module-boundary.md`](./module-boundary.md): Modular-monolith dependency
  direction, forbidden imports, registry role, and PR debt rule.
- [`module-registry.md`](./module-registry.md): Metadata-only feature module
  registry and active pharmacy module composition root.
- [`fhir-first-prescription-platform.md`](./fhir-first-prescription-platform.md):
  FHIR Native v0.5 complete-replacement contract for the three planes,
  authoritative resource ownership, read-only replicas, validation, security,
  deterministic conversion, and human-gated hard cutover.
