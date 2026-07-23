---
type: FixPattern
title: Static checker follows split canonical registries
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/lib/tasks/task-registry.ts'
  - 'file:src/lib/tasks/risk-task-registry.ts'
  - 'file:tools/scripts/check-task-type-registry.mjs'
  - 'file:tools/scripts/check-task-type-registry.test.ts'
  - 'commit:b6f073423'
  - 'test:pnpm task-types:check'
  - >-
    test:pnpm exec vitest run tools/scripts/check-task-type-registry.test.ts
    src/lib/tasks/operational-task-presentation.test.ts
    src/server/services/operational-tasks.test.ts
  - 'test:pnpm boundaries:check'
  - 'test:pnpm human-maintained-file-size:check'
  - 'test:pnpm lint'
  - 'test:pnpm typecheck'
  - 'test:pnpm typecheck:no-unused'
task_id: CI-TASK-TYPE-REGISTRY-SPLIT-PARITY-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/fix-patterns/2026-07-24/static-checker-split-registry-parity
confidence: high
created_at: '2026-07-24T00:26:45+09:00'
created_by: codex-lead
dedupe_key: eb2a5ed7d626ffa728ff613ccad71b011f9370a6d39c0755f71f805a2b973b81
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-24T00:26:45+09:00'
owner_agent: codex-lead
commit_after: b6f073423
commit_before: 4353cca956f17ed0ce42f6dc8efccba346d4330d
superseded_by: null
evidence_level: gate_verified
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
ingested_via: put_page
ingested_at: '2026-07-23T15:27:37.749Z'
source_kind: put_page
tags:
  - accepted
  - ci
  - codex
  - maintainability
  - static-analysis
  - task-registry
  - typescript
  - validation
---

# Static checker follows split canonical registries

fixes: [[projects/careviax/failures/2026-07-23/static-checker-production-topology-drift]]

## Recipe

1. Give every canonical source a fixed tracked path and read each source fail-closed.
2. Parse definitions from their owning source while validating the consumer import and public re-export contract.
3. Compare registry domains and domain-to-module mappings in both directions, and reject missing or duplicate domains and task types.
4. Make the test fixture mirror the production module split and mutate missing source, re-export-only, wrong path, duplicate, and unmapped cases.
5. Run the focused fixture tests and the live package command so a stale test topology cannot report a false green.

## Required checks

- `pnpm task-types:check`
- `pnpm exec vitest run tools/scripts/check-task-type-registry.test.ts src/lib/tasks/operational-task-presentation.test.ts src/server/services/operational-tasks.test.ts --reporter=dot --testTimeout=30000`
- `pnpm boundaries:check`
- `pnpm human-maintained-file-size:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm typecheck:no-unused`

## Anti-patterns

- Copying extracted literals back into the former monolith.
- Importing or evaluating production TypeScript at checker runtime.
- Catching a missing source and treating it as success.
- Keeping a monolithic test fixture after the production source graph is split.

## Links

- fixes: [[projects/careviax/failures/2026-07-23/static-checker-production-topology-drift]]
