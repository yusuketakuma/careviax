---
type: FailurePattern
title: E2E local Next build exhausts the default V8 heap
created: '2026-07-14T00:00:00.000Z'
memory_id: projects/careviax/failures/2026-07-14/e2e-local-build-default-heap-oom
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
times_seen: 1
ingested_at: '2026-07-14T01:58:50.532Z'
owner_agent: codex-lead
source_kind: put_page
ingested_via: put_page
superseded_by: null
evidence_level: gate_verified
validity_scope:
  repo: careviax
  files:
    - package.json
  directories:
    - tools/scripts
tags:
  - accepted
  - codex
  - infra
  - nextjs
  - performance
  - stability
  - test
---

# E2E local Next build exhausts the default V8 heap

## Symptom

- `build:e2e:local` exits during Next webpack compile with a V8 heap out-of-memory failure near the default 4 GiB limit and leaves no complete standalone artifact.

## Root cause

- The regular `build` script invokes the Next compiler with an 8 GiB heap, but `build:e2e:local` previously invoked `next build` directly and therefore inherited the lower V8 default.

## Bad fix (anti-patterns)

- Repeating the same build without changing the heap contract.
- Treating the missing standalone output as an application compile error without first checking the OOM tail.
- Removing E2E environment flags or reducing route coverage to make the build appear green.

## Good fix

- Align the E2E Next compiler invocation with the repository production-build heap contract and pin it with a package-script test. See [[projects/careviax/fix-patterns/2026-07-14/align-e2e-next-heap-with-production-build]].

## Applies to

- files: [package.json] and local standalone E2E build workflows.

## Evidence

- Commit: `945452afe`.
- Old command: reproduced OOM before artifact generation.
- Fixed gate: Next 16.2.9 build completed compile, TypeScript, 311/311 pages, traces, and finalization with exit 0.
- Peer review: codex1 APPROVE.

## Tests to run

- `pnpm exec vitest run tools/scripts/e2e-local-build-contract.test.ts`
- `pnpm build:e2e:local`

## Links

- fixed_by: [[projects/careviax/fix-patterns/2026-07-14/align-e2e-next-heap-with-production-build]]
