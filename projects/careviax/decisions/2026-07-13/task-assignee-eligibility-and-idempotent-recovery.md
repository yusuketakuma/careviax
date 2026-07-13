---
type: project
title: Task Assignee Eligibility And Idempotent Recovery
ingested_via: put_page
ingested_at: '2026-07-13T09:01:20.571Z'
source_kind: put_page
---

---

type: ImplementationDecision
title: Task assignee eligibility and idempotent recovery share one contract
memory_id: projects/careviax/decisions/2026-07-13/task-assignee-eligibility-and-idempotent-recovery
project_id: careviax
task_id: AUTHZ-TASK-ASSIGNEE-ELIGIBILITY-001
commit_after: a226ff664
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: codex-lead
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [src/lib/tasks, src/app/api/tasks, src/app/api/staff-workload, src/app/(dashboard)/tasks], files: [src/lib/tasks/task-assignee-eligibility.ts, src/app/api/tasks/route.ts, src/app/api/tasks/[id]/route.ts, src/app/api/staff-workload/route.ts, src/app/(dashboard)/tasks/tasks-content.tsx] }
expires_at: null
superseded_by: null
dedupe_key: da09f3182150223927a89a5637bed8054d544755d71523abe645ecf53ff09da8
tags: [tasks, authorization, membership, idempotency, privacy, react-query, codex-lead, accepted]

---

# Task assignee eligibility and idempotent recovery share one contract

## Problem

- Candidate rows and task writes used different membership and capability rules, so an active same-org user could appear assignable while being unable to read or execute the task.
- A task could be committed while its response was lost, and the UI had no stable operation key for a safe retry.
- Evidence: `src/app/api/staff-workload/route.ts`, `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts`, `src/app/(dashboard)/tasks/tasks-content.tsx`.

## Decision

- Adopted: one canonical task-type, stable-role, active-account/membership evaluator for candidate projection and POST/PATCH writes; fail closed for mixed roles and task-relevant capability ambiguity.
- Adopted: preserve one payload-fingerprint-scoped client dedupe key across network, 5xx, or malformed-success response uncertainty; classify explicit assignee rejection separately from other failures.
- Reason: candidate/write parity prevents impossible assignments, while the stable operation key makes retry safe without exposing provider text or retaining unauthorized cached PHI.

## Alternatives rejected

- Trusting the first Membership row was rejected because site row order is not an authorization policy.
- Clearing the assignee for every POST failure was rejected because it misclassifies confirmed validation failures and cannot reconcile an unknown write outcome.
- Treating all task types as context-complete was rejected; visit assignment and self-audit/two-person checks remain dedicated workflow gates.

## Migration

- From: route-local same-org membership checks and role-agnostic workload candidates.
- To: `src/lib/tasks/task-assignee-eligibility.ts` plus a strict `assignable_work_request_types` projection and typed rejection reason.

## Verification

- Focused Vitest: 8 files / 160 tests passed.
- Full Vitest: 1549 files / 16035 tests passed; 3 files / 13 tests skipped.
- Scoped ESLint, Prettier, 8 GiB typecheck and no-unused, static contracts, and Next production build with 311 pages passed.

## Review

- Reviewer: codex-lead read-only contract, independent, and medical/privacy passes; result: approved with contextual and serialization follow-ups.

## Future rule candidate

- Any candidate selector that performs a write must project from the same server evaluator as the write, and any response-uncertain create must retry with the same operation key.

## Links

- canonical: [[file:src/lib/tasks/task-assignee-eligibility.ts]]
- canonical: [[file:src/app/(dashboard)/tasks/tasks-content.tsx]]
