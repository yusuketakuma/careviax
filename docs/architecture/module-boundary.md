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

Composition roots are allowed to assemble active modules. They are edge wiring
points, not places for domain rules:

- `src/modules/active-modules.ts` assembles module metadata.
- `src/server/collaboration/active-access-registry.ts` assembles collaboration
  access providers for server-side authorization checks.

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

## Allowlist Ratchet

`pnpm boundaries:check` is the module-boundary ratchet and runs in CI. Existing
debt is tracked in `tools/module-boundary-allowlist.json` at file scope. Each
entry must include:

- `path`: file that still contains an allowlisted boundary-crossing import.
- `expectedCount`: exact number of boundary-crossing imports in that file.
- `owner`: `Plans.md` task or module slice responsible for paying it down.
- `debtId`: technical debt identifier when available.
- `reason`: why the dependency is still present.
- `plannedAction`: concrete removal direction.
- `targets`: current forbidden import targets.

The check fails when a new unlisted violation appears or when an allowlisted
file's actual count no longer matches `expectedCount`. A lower actual count is
also a stale entry: reduce the allowlist in the same PR that removes the import.
