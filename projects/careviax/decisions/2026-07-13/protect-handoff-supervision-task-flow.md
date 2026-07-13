---
type: ImplementationDecision
title: Protect handoff supervision tasks behind the dedicated confirmation workflow
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/app/api/tasks/route.ts'
  - 'file:src/app/api/tasks/[id]/route.ts'
  - 'file:src/app/api/visit-records/[id]/handoff/supervision-confirm/route.ts'
  - 'file:src/server/services/visit-handoff.ts'
  - 'commit:82f506f50606b5880da7e5123482f6661c03c02a'
  - 'commit:f5c71f85c2073d640543ae8b0861b0f3e7ceb016'
  - 'test:pnpm exec vitest run focused-handoff-task-files'
  - 'test:pnpm exec vitest run'
  - 'test:pnpm build'
task_id: AUTHZ-HANDOFF-SUPERVISION-GENERIC-WRITE-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/decisions/2026-07-13/protect-handoff-supervision-task-flow
confidence: high
created_at: '2026-07-13T10:33:30.000Z'
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: f5c71f85c2073d640543ae8b0861b0f3e7ceb016
commit_before: cee804d36
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/tasks/route.ts
    - 'src/app/api/tasks/[id]/route.ts'
    - 'src/app/api/visit-records/[id]/handoff/supervision-confirm/route.ts'
    - src/server/services/visit-handoff.ts
    - src/lib/tasks/inline-completion.ts
    - src/lib/tasks/task-assignee-eligibility.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
    - PostgreSQL RLS
  directories:
    - src/app/api/tasks
    - src/app/api/visit-records
    - src/server/services
    - src/lib/tasks
ingested_via: put_page
ingested_at: '2026-07-13T10:35:00.793Z'
source_kind: put_page
tags:
  - accepted
  - audit
  - authorization
  - fail-closed
  - handoff
  - rls
  - tasks
  - transaction
---

# Protect handoff supervision tasks behind the dedicated confirmation workflow

## Problem

- Generic task create, reassignment, and completion surfaces could operate on both the legacy and canonical handoff supervision task types, bypassing the dedicated request and confirmation contract.
- Confirmation did not atomically revalidate all task metadata, current schedule assignment, request provenance, and the exact observed legacy or canonical task row.
- An intermediate implementation read the FORCE-RLS AuditLog through the global client and left route tests describing the old boundary.

## Decision

- Reject generic creation and non-null reassignment for both supervision task aliases, and reject generic inline or bulk completion.
- Keep an authorized null assignment clear for remediation rather than making historical invalid rows impossible to repair.
- Require the dedicated confirmation route to validate task type, dedupe key, visit and schedule metadata, trainee, selected supervisor, expected version, and current schedule assignment.
- Pass the exact observed task type into the service and claim and resolve that same row in the organization transaction.
- Read the dedicated request AuditLog provenance through `tx.auditLog.findFirst` inside the existing `withOrgContext` transaction before any task or VisitRecord mutation. Map missing provenance to a sanitized no-store 403 and concurrent state loss to 409.

## Alternatives rejected

- Canonicalizing the stored task type during confirmation was rejected because legacy and canonical rows must both remain confirmable without claiming a different row.
- Keeping the AuditLog read in the route was rejected because explicit `org_id` alone does not establish the FORCE-RLS session context.
- Allowing generic completion after metadata checks was rejected because the dedicated transaction is the only place that atomically validates provenance, schedule state, visit version, task claim, and audit.

## Verification

- Focused Vitest passed: 7 files, 173 tests; route plus service passed 2 files, 44 tests.
- Tests cover legacy and canonical positive flows, exact task claiming, current schedule drift, dedicated audit provenance, RLS-scoped transaction use, sanitized errors, and zero mutations when provenance is missing.
- Shared full Vitest passed: 1549 files passed, 3 skipped; 16078 tests passed, 13 skipped.
- Typecheck, no-unused, scoped ESLint and Prettier, task registry, API response, route authorization, DB guards, and the 311-page production build passed.

## Review

- Independent security review and the post-RLS-fix security re-review approved the final implementation.
- Codex1 reproduced three stale route-test failures from the first commit; the follow-up commit corrected the RLS boundary, typed error mapping, and test ownership before integration.

## Future rule candidate

- Workflow-controlled task types must reject generic writes and perform provenance, authorization, state claim, domain mutation, resolution, and audit in one organization-scoped transaction.

## Links

- canonical: [[file:src/server/services/visit-handoff.ts]]
- boundary: [[file:src/app/api/tasks/route.ts]]
- boundary: [[file:src/app/api/tasks/[id]/route.ts]]
