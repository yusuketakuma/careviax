# PH-OS Backend Module Boundary

PH-OS remains a modular monolith. The current product scope is pharmacy home
care. Future home-medical, home-nursing, and network-ops modules are reserved
extension points, not active feature implementations.

## Dependency Direction

```text
platform -> core -> modules/pharmacy -> app/api
```

Allowed:

- `modules/*` may import `core` and `platform`.
- `app/api` may import `core` and active feature modules.

Forbidden:

- `core` must not import `modules/pharmacy` or future feature modules.
- Feature modules must not import sibling feature modules.
- Future `home_medical` or `home_nursing` modules must not import pharmacy
  implementations.

Composition roots are allowed to assemble active modules. Today that root is
`src/modules/active-modules.ts`.

## Registry Role

The module registry is metadata-only. It does not replace the existing sources
of truth:

- Risk semantics stay in the RiskFinding contract and Case Risk Cockpit work.
- Task type, dedupe, stale, and resolve semantics stay in
  `src/lib/tasks/task-registry.ts`.
- Durable event payload and retry semantics stay in `DB-EVENT-001`.
- Tenant enforcement stays in RLS, route guards, and `DB-TENANT-001` /
  `TENANT-*`.
- Public API shape stays behind DTO/presenter work in `API-DTO-001`.

## PR Rule

Each module-boundary PR must also pay down at least one listed technical debt or
keep the allowlist count flat while adding a stronger gate. Increasing the
allowlist requires an architecture review and a paired reduction plan.
