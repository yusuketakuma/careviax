---
type: project
title: Dedicated Prescription Supply Review Command
ingested_via: put_page
ingested_at: '2026-07-16T20:59:28.250Z'
source_kind: put_page
---

---

type: ImplementationDecision
title: Resolve prescription supply review through a dedicated atomic command
memory_id: projects/careviax/decisions/2026-07-17/dedicated-prescription-supply-review-command
project_id: careviax
task_id: STOCK-001-PRESCRIPTION-FOLLOWUP-001D
commit_after: 1950b4021
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: codex-lead
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [src/app/api/tasks, src/modules/pharmacy/medication-stock/application], files: [src/app/api/tasks/[id]/prescription-supply/resolve/route.ts, src/modules/pharmacy/medication-stock/application/apply-prescription-supply.ts] }
expires_at: null
superseded_by: null
tags: [pharmacy-stock, prescription-supply, task-lifecycle, authorization, audit, idempotency, codex-lead, accepted]
dedupe_key: careviax-implementationdecision-dedicated-prescription-supply-review-command

---

# Resolve prescription supply review through a dedicated atomic command

## Problem

- summary: Generic Task PATCH could mark a prescription supply review complete without applying stock, while selecting one item from ambiguous candidates required an explicit reviewed boundary.
- evidence: Plans.md STOCK-001-PRESCRIPTION-FOLLOWUP; src/app/api/tasks/[id]/route.ts; src/modules/pharmacy/medication-stock/application/apply-prescription-supply.ts.

## Decision

- adopted: Use a dedicated canDispense command that rechecks task assignment, open status, task-to-line-to-intake binding, writable patient scope, exact stock identity, unit, package, and equivalence. Apply event, audit, and task completion in one Serializable transaction.
- reason: A clinical stock mutation and its review lifecycle must succeed or roll back together and cannot be represented by generic task status mutation.

## Alternatives rejected

- Complete the task through generic Task PATCH and retry stock separately — rejected because partial success would falsely close unresolved clinical work.
- Mutate or auto-create the selected stock item during review — rejected until the create/equivalence contract and UI are explicit.

## Migration

- from: Review tasks had no supported apply command.
- to: Existing exact stock items can be explicitly selected and applied; invalid selections keep the task open.

## Verification

- Related 3 files / 38 tests, full typecheck, targeted ESLint/Prettier, route auth wrapper, authz status, and API reachability gates passed.

## Review

- reviewer: codex-lead; result: focused transaction, authz, PHI, race, and idempotency review passed.

## Future rule candidate

- Clinical review tasks must close in the same transaction as the reviewed domain mutation and audit evidence.

## Links

- canonical: [[file:src/app/api/tasks/[id]/prescription-supply/resolve/route.ts]]
- canonical: [[file:src/modules/pharmacy/medication-stock/application/apply-prescription-supply.ts]]
