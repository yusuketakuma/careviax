---
type: FailurePattern
title: Next typegen leaves stale route files in incremental type state
branch: agent/continuous-improvement-20260712
source:
  - 'file:package.json'
  - 'file:tsconfig.json'
  - 'file:tools/scripts/typecheck-no-unused-contract.test.ts'
  - 'commit:5bbb47937fb478bd0e510208bb322e0226b3814a'
  - 'commit:2cc59b06b0d6488570ba92870c2b9feaaf13660c'
  - 'test:pnpm typecheck'
  - 'test:pnpm typecheck:no-unused'
task_id: TYPECHECK-STALE-NEXT-TYPES-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/failures/2026-07-14/next-typegen-stale-tsbuildinfo
confidence: high
created_at: '2026-07-14T02:04:45.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
times_seen: 1
updated_at: '2026-07-14T02:24:12.000Z'
captured_at: '2026-07-14T02:24:54.080Z'
ingested_at: '2026-07-14T02:24:55.490Z'
owner_agent: codex-lead
source_kind: put_page
captured_via: capture-cli
commit_after: 2cc59b06b0d6488570ba92870c2b9feaaf13660c
ingested_via: put_page
commit_before: ba6ec79e54873928c87d0ea86cec02aec197a845
superseded_by: null
evidence_level: peer_reviewed
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - package.json
    - tsconfig.json
    - tools/scripts/typecheck-no-unused-contract.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - Node.js
  directories:
    - tools/scripts
tags:
  - accepted
  - codex
  - nextjs
  - stability
  - tooling
  - typecheck
  - typescript
---

# Next typegen leaves stale route files in incremental type state

## Symptom

- After `next typegen` succeeded, `tsc` failed with TS6053 for removed `.next/types/app/**` files.
- A full non-incremental analysis then exhausted the default approximately 4 GiB V8 heap.

## Root cause

- Ignored `tsconfig.tsbuildinfo` retained generated route files that no longer existed after Next regenerated `.next/types`.
- Disabling incremental reuse exposed the repository full-program memory requirement, which exceeded the default Node heap.

## Bad fix (anti-patterns)

- Do not ignore TS6053 or treat type generation success as a complete typecheck.
- Do not restore obsolete generated route files.
- Do not disable strict checks or use incremental state merely to hide the full-program memory requirement.

## Good fix

- Run the main compiler after type generation with `--incremental false` and the repository-standard 8 GiB Node heap.
- Keep the service-worker project check separate.
- See [[projects/careviax/fix-patterns/2026-07-14/stable-next-typegen-typecheck]].

## Applies to

- directories: [repository root, tools/scripts]
- patterns: [Next route type generation, TypeScript incremental state, local and CI typecheck]

## Evidence

- Commit: `5bbb47937fb478bd0e510208bb322e0226b3814a`
- Follow-up commit: `2cc59b06b0d6488570ba92870c2b9feaaf13660c` made the no-unused gate self-contained with the same heap contract.
- The corrected command passed twice consecutively; 8 GiB no-unused typecheck and the package-script contract test also passed.
- Independent codex peer review approved the change.

## Tests to run

- `pnpm typecheck` twice
- `pnpm typecheck:no-unused`
- `pnpm exec vitest run tools/scripts/typecheck-no-unused-contract.test.ts`

## Links

- fixed_by: [[projects/careviax/fix-patterns/2026-07-14/stable-next-typegen-typecheck]]
