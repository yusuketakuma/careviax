# PH-OS Pharmacy

PH-OS Pharmacy is a home-care pharmacy operations system for managing patients,
prescriptions, dispensing work, home visits, reports, billing evidence, tasks,
notifications, files, and audit trails in one Next.js and PostgreSQL application.

The current product scope is pharmacy home care. The codebase already reserves
module boundaries for future home medical, home nursing, and regional network
operations, but those future modules are not the active product today. The
active module is:

```text
activeModules = [pharmacyModule]
```

## What This System Is

PH-OS helps a pharmacy team answer three operational questions for every home
care patient:

1. What is blocking this patient or case right now?
2. Who owns the next action?
3. What evidence, report, task, or audit trail proves the work was done?

It is not intended to replace a receipt computer, electronic medication history
system, full inventory platform, or EHR. Its role is to connect the operational
work around home-visit pharmacy care: prescription intake, dispensing, audit,
set preparation, visit readiness, visit records, external collaboration, report
delivery, billing review, and risk/task follow-up.

## Product At A Glance

| Area                        | What PH-OS handles                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Patient and case operations | Patient board, patient detail tabs, Case Risk Cockpit, foundation data, consent, management plans, care team, timeline                  |
| Prescription intake         | QR/JAHIS-oriented intake, prescription cycles, medication lines, medication master reconciliation, inquiry and issue tracking           |
| Dispensing workflow         | Dispense, audit, set, set-audit workbenches, holds, representative tasks, high-risk flags, workflow state                               |
| Visit workflow              | Schedule proposals, patient contact, confirmed visits, visit preparation, visit brief, mobile visit record, offline drafts, attachments |
| Reports and sharing         | Care reports, report draft generation, delivery records, print/PDF/export policies, external access links, comments                     |
| Billing evidence            | Billing candidates, billing rules, visit billing guards, monthly close review, blockers, operational task escalation                    |
| Operations                  | Dashboard cockpit, task health, notifications, audit logs, admin tools, performance metrics, pilot readiness                            |
| Platform boundary           | Organization tenancy, role permissions, audit logging, PHI-safe responses, S3 file handling, AWS deployment checks                      |

## Primary Users

- Pharmacists managing home-care medication work, visits, reports, and clinical
  follow-up.
- Clerks coordinating calls, document flow, external partners, billing
  preparation, and operational queues.
- Pharmacy managers reviewing risk, workload, SLA, reports, billing blockers,
  staff operations, and audit logs.
- PH-OS operators and future freelance pharmacists, through bounded support or
  assignment-based access rather than unrestricted tenant-wide access.

## Main Workflows

```text
Prescription intake
  -> Medication cycle
  -> Dispense
  -> Audit
  -> Set / set-audit
  -> Visit preparation
  -> Home visit record
  -> Care report
  -> Billing evidence
  -> Task, notification, and audit follow-up
```

Cross-cutting services connect that flow:

- **Risk Finding** turns blockers and warnings into consistent case-level
  findings.
- **Operational Task** escalates urgent or blocking work into deduplicated tasks.
- **Patient / Case Command Center** brings next actions, blockers, recent
  activity, risk, and task sync into the patient detail experience.
- **External Share** and file policies keep shared patient information scoped,
  no-store, audited, and minimized.
- **Performance and readiness checks** track route speed, payload budget,
  deployment readiness, backup readiness, and release gates.

## Main Screens

Most authenticated screens live under `src/app/(dashboard)`.

| Area                        | Routes                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Dashboard and work overview | `/dashboard`, `/my-day`, `/workflow`                                                   |
| Patients                    | `/patients`, `/patients/[id]`, `/patients/new`, `/patients/compare`                    |
| Prescriptions               | `/prescriptions`, `/prescriptions/intake`, `/prescriptions/qr-drafts`, `/qr-scan`      |
| Dispensing                  | `/dispense`, `/audit`, `/set`, `/set-audit`                                            |
| Scheduling and visits       | `/schedules`, `/schedules/proposals`, `/visits`, `/visits/[id]`, `/offline-sync`       |
| Reports and billing         | `/reports`, `/reports/[id]`, `/billing`, `/billing/candidates`                         |
| Collaboration               | `/communications`, `/conferences`, `/handoff`, `/external`, `/notifications`, `/tasks` |
| Administration              | `/admin/*`, `/settings`, `/statistics`, `/audit`                                       |

Other important surfaces:

- Authentication: `src/app/(auth)`
- Public shared viewer: `src/app/shared/[token]`
- API route handlers: `src/app/api`
- Legal pages: `src/app/(legal)`

## Architecture

PH-OS is a modular monolith. The code is structured so the pharmacy product can
ship now while future service lines can add providers without rewriting the
common core.

```text
Next.js App Router
  -> Route Handlers / BFF endpoints
  -> server services, presenters, and module adapters
  -> Prisma / PostgreSQL
  -> AWS-ready operational integrations
```

Dependency direction:

```text
platform
  -> core
  -> modules/pharmacy
  -> app/api and app UI
```

Key implementation points:

- `src/core` contains module-independent contracts and registries.
- `src/modules/pharmacy` contains pharmacy-specific adapters and providers.
- `src/server` contains server-only orchestration, BFF services, jobs, and
  integration logic.
- `src/lib` contains shared runtime utilities, auth helpers, API helpers,
  validation, task registry, billing helpers, and UI-safe constants.
- `src/types` contains cross-boundary DTO and response contracts.

See:

- [Module boundary](docs/architecture/module-boundary.md)
- [Module registry](docs/architecture/module-registry.md)
- [AWS deployment stages](docs/architecture/aws-phos-deployment-stages.md)

## Technology Stack

- Next.js 16 App Router, React 19, React Compiler, standalone output
- TypeScript 6, Zod, React Hook Form, TanStack Query, TanStack Table, Zustand
- Prisma 7 and PostgreSQL
- NextAuth with Cognito-oriented authentication flows
- Serwist service worker, offline draft storage, and sync support
- S3-oriented file storage, SES, DynamoDB rate limiting, CloudWatch metrics,
  ECS / Lightsail planning assets
- Vitest, Testing Library, Playwright, ESLint, Prettier, module-boundary checks

## Repository Layout

```text
.
├── docs/       # Architecture, compliance, operations, testing, and UI docs
├── prisma/     # Split Prisma schema, migrations, and seed
├── public/     # Static assets and generated service worker output
├── src/        # App Router, API routes, server services, core/modules/lib/types
├── tools/      # Scripts, infra templates, browser harness, Playwright tests
├── Plans.md    # Implementation backlog and risk/modularization plan
└── README.md   # Top-level system overview
```

Useful entry points:

- `src/app/`: pages, layouts, route handlers, and public surfaces
- `src/components/`: UI, layout, dashboard, patient, visit, report, and workflow components
- `src/core/`: provider registries and module-independent contracts
- `src/modules/pharmacy/`: active pharmacy module adapters
- `src/server/`: server-only services, report generation, risk, visit, billing, jobs
- `tools/scripts/`: readiness, AWS, DB, import, audit, performance, and compliance scripts
- `tools/tests/`: Playwright and medical UI gate tests

## Getting Started

### Requirements

- Node.js `24.16.0`
- pnpm `11.5.2`
- PostgreSQL for local database-backed flows and E2E tests

Install dependencies:

```bash
pnpm install
```

Generate the Prisma client:

```bash
pnpm db:generate
```

Start the development server:

```bash
pnpm dev
```

### Local E2E Profile

Prepare the local E2E database:

```bash
pnpm db:e2e:prepare
```

Run the E2E development server on port `3012`:

```bash
pnpm dev:e2e:local
```

Run Playwright against that server:

```bash
pnpm test:e2e:local
```

Environment variable names and production setup are intentionally not fully
listed here. Use the operations and compliance docs for deployment context, and
never commit `.env` files or secret values.

## Common Validation Commands

Use focused checks for the area you changed, then widen only when the impact
radius warrants it.

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:no-unused
pnpm test
pnpm test:e2e:list
pnpm boundaries:check
pnpm colors:check
pnpm format:check
```

Operational and release-readiness checks:

```bash
pnpm perf:smoke
pnpm pilot:readiness
pnpm aws:deploy:readiness
pnpm medical-ui:e2e:gate
pnpm test:rls-proof
```

Database-backed E2E commands assume the configured local PostgreSQL instance is
available, commonly through the repository E2E connection settings.

## Security, Privacy, And Compliance

Treat patient, prescription, visit, report, file, notification, audit, and
billing surfaces as sensitive by default.

Core rules:

- Do not commit secrets, tokens, credentials, private keys, production dumps,
  raw patient data, or `.env` files.
- Public API responses must not expose S3 storage keys, original file names,
  signed URLs, raw provider errors, raw metadata, unrestricted free text, or
  external provider internals.
- Authenticated routes should use shared auth context, permission checks,
  organization scoping, no-store responses, and audit logging patterns.
- Tenant-owned data is scoped by `org_id`; RLS and application-layer guards are
  both part of the design.
- Clinical output, CSV/PDF export, file download, external share, and
  notification delivery must go through masking, permission, audit, and
  no-store boundaries.
- Cross-tenant access must be justified by membership, assignment/grant, or a
  support session with an auditable reason.

Reference docs:

- [API conventions](docs/api-conventions.md)
- [Compliance docs](docs/compliance/README.md)
- [Operations docs](docs/operations/README.md)
- [Testing docs](docs/testing/README.md)
- [UI/UX design guidelines](docs/ui-ux-design-guidelines.md)

## AWS And Deployment Direction

PH-OS has staged AWS planning assets rather than a single mandatory topology:

1. Low-cost pilot: Lightsail App VM, Lightsail PostgreSQL, S3, Cognito, SES,
   CloudWatch, DynamoDB rate limiting, ECR, Route 53, ACM.
2. Production minimum: ECS Express / Fargate, ALB, RDS PostgreSQL, S3 Object
   Lock, Cognito, SES, DynamoDB, CloudWatch, Secrets Manager, EventBridge
   Scheduler.
3. Scale-out: multiple Fargate tasks, RDS Multi-AZ, durable queues, WAF,
   GuardDuty, Security Hub, CloudTrail, AWS Backup.

When changing AWS-related code, scripts, IAM, S3, RDS, ECS, DynamoDB, SES,
Cognito, CloudWatch, Route 53, ACM, Secrets Manager, or EventBridge behavior,
verify against official AWS documentation before implementation and record the
reference in the relevant plan, state, or PR notes.

## Documentation Map

- [Docs index](docs/README.md)
- [Architecture index](docs/architecture/README.md)
- [Operations index](docs/operations/README.md)
- [Compliance index](docs/compliance/README.md)
- [Testing index](docs/testing/README.md)
- [UI/UX design guidelines](docs/ui-ux-design-guidelines.md)
- [Implementation plan](Plans.md)
- [Tools index](tools/README.md)

## Development Notes

- Prefer existing route, presenter, DTO, auth, audit, and validation patterns
  over new one-off abstractions.
- Keep API route handlers thin. Move orchestration into server services or
  module application code.
- Preserve existing response shapes unless a planned API-contract migration
  explicitly says otherwise.
- Use `src/core` for module-independent contracts and `src/modules/pharmacy`
  for pharmacy-specific adapters.
- Do not add new common-core imports from `src/modules/pharmacy`.
- UI/UX changes must follow [PH-OS UI/UX Design Guidelines](docs/ui-ux-design-guidelines.md).
- AWS-related implementation must be checked against official AWS references,
  not memory alone.

## Status

This is a private product repository under active development. `README.md` is
the orientation page for engineers and operators. Detailed release readiness,
open implementation tasks, and current operating state live in `Plans.md` and
`ops/refactor/STATE.md`.
