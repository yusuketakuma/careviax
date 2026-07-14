---
type: FixPattern
title: Stable Next route type generation and full TypeScript validation
branch: agent/continuous-improvement-20260712
source:
  - 'file:package.json'
  - 'file:tools/scripts/typecheck-no-unused-contract.test.ts'
  - 'commit:5bbb47937fb478bd0e510208bb322e0226b3814a'
  - 'test:pnpm typecheck twice'
  - 'test:NODE_OPTIONS max-old-space-size 8192 pnpm typecheck no-unused'
task_id: TYPECHECK-STALE-NEXT-TYPES-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/fix-patterns/2026-07-14/stable-next-typegen-typecheck
confidence: high
created_at: '2026-07-14T02:04:45.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-14T02:04:45.000Z'
owner_agent: codex-lead
commit_after: 5bbb47937fb478bd0e510208bb322e0226b3814a
commit_before: ba6ec79e54873928c87d0ea86cec02aec197a845
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - package.json
    - tools/scripts/typecheck-no-unused-contract.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Node.js
  directories:
    - tools/scripts
ingested_via: put_page
ingested_at: '2026-07-14T02:05:51.964Z'
source_kind: put_page
tags:
  - accepted
  - codex
  - nextjs
  - stability
  - tooling
  - typecheck
  - typescript
---

# Stable Next route type generation and full TypeScript validation

fixes: [[projects/careviax/failures/2026-07-14/next-typegen-stale-tsbuildinfo]]

## Recipe

1. Run `next typegen` before the main TypeScript project so current route definitions exist.
2. Invoke the repository-local TypeScript compiler with the repository-standard 8 GiB Node heap and `--incremental false`.
3. Run the service-worker TypeScript project as a separate command so its boundary remains validated.
4. Pin this command order and heap contract in a focused package-script test.
5. Run the complete command twice to prove generated files and ignored build-info cannot change the result.

## Required checks

- `pnpm typecheck` twice
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused`
- `pnpm exec vitest run tools/scripts/typecheck-no-unused-contract.test.ts`
- Exact ESLint, Prettier, and diff checks for the package script and contract test

## Anti-patterns

- Do not copy deleted files back into `.next/types`.
- Do not weaken strictness, skip the main project, or accept a typegen-only green result.
- Do not depend on an existing incremental cache to keep full-program memory below the default heap.
- Do not change Next build or development incremental behavior for this typecheck-only failure.

## Links

- fixes: [[projects/careviax/failures/2026-07-14/next-typegen-stale-tsbuildinfo]]
