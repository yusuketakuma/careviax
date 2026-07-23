---
type: FailurePattern
title: Static checker fixture stays green after production source split
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/lib/tasks/task-registry.ts'
  - 'file:src/lib/tasks/risk-task-registry.ts'
  - 'file:tools/scripts/check-task-type-registry.mjs'
  - 'file:tools/scripts/check-task-type-registry.test.ts'
  - 'commit:b83c3f1c7'
  - 'commit:a8e68db71'
  - 'test:pnpm task-types:check'
  - 'test:pnpm exec vitest run tools/scripts/check-task-type-registry.test.ts'
created: '2026-07-23'
task_id: CI-TASK-TYPE-REGISTRY-SPLIT-PARITY-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/failures/2026-07-23/static-checker-production-topology-drift
confidence: high
created_at: '2026-07-23T15:01:06Z'
created_by: codex-lead
dedupe_key: 3048d0bfa90e0077d33df4fd2db9c72128f22f971066b0c4d19d5721157c8c50
expires_at: null
feature_id: null
project_id: careviax
times_seen: 1
updated_at: '2026-07-23T15:01:06Z'
ingested_at: '2026-07-23T15:01:45.945Z'
owner_agent: codex-lead
source_kind: put_page
commit_after: a8e68db71878864c422f7f9d61126ad2c0a9eac2
ingested_via: put_page
commit_before: 35cacc71720c4006e91fc3b90fd97bd0200f26fa
superseded_by: null
evidence_level: tested
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/lib/tasks/task-registry.ts
    - src/lib/tasks/risk-task-registry.ts
    - tools/scripts/check-task-type-registry.mjs
    - tools/scripts/check-task-type-registry.test.ts
  tech_stack:
    - TypeScript
    - Node.js
    - Vitest
  directories:
    - src/lib/tasks
    - tools/scripts
tags:
  - ci
  - codex
  - maintainability
  - static-analysis
  - task-registry
---

# Static checker fixture stays green after production source split

## Symptom

- Required `pnpm task-types:check` fails because it looks for `RISK_TASK_REGISTRY` in `task-registry.ts` after that registry moved to `risk-task-registry.ts`.
- The checker fixture remains a monolithic source string, so its focused tests pass while the live repository command fails.

## Root cause

- A file-size responsibility split updated runtime imports and re-exports but not a static semantic consumer that parsed a literal block from one exact source file.
- The test fixture modeled the old topology instead of the production module graph.

## Bad fix

- Do not copy registry literals back into the old file, skip the missing block, dynamically import runtime code, or remove the required CI step.

## Good fix

- Resolve the canonical tracked split sources statically, validate the re-export and domain-to-module mapping, and make the fixture mirror production topology with missing, duplicate, unmapped, and wrong-path mutations.
- After responsibility extraction, run both focused checker tests and the live package command before declaring the split complete.

## Applies to

- directories: `src/lib/tasks`, `tools/scripts`
- patterns: source-parsing ratchets, generated documentation readers, static registries, responsibility/file-size extractions

## Evidence

- source split: commit `b83c3f1c7`
- planning reconciliation: commit `a8e68db71`
- observed: live `pnpm task-types:check` fails with `RISK_TASK_REGISTRY block was not found`
- tested: `tools/scripts/check-task-type-registry.test.ts` passes 5/5 against the stale monolithic fixture
- active remediation: `CI-TASK-TYPE-REGISTRY-SPLIT-PARITY-001`

## Tests to run

- `pnpm task-types:check`
- `pnpm exec vitest run tools/scripts/check-task-type-registry.test.ts`
- `pnpm boundaries:check`
