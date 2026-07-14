---
type: FixPattern
title: Align E2E Next compiler heap with the production build
created: '2026-07-14T00:00:00.000Z'
memory_id: >-
  projects/careviax/fix-patterns/2026-07-14/align-e2e-next-heap-with-production-build
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
ingested_at: '2026-07-14T01:58:50.487Z'
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

# Align E2E Next compiler heap with the production build

fixes: [[projects/careviax/failures/2026-07-14/e2e-local-build-default-heap-oom]]

## Recipe

1. Preserve all local E2E environment flags and change only the Next compiler invocation.
2. Invoke the repository-local Next binary through Node with `--max-old-space-size=8192`, matching the existing production build contract.
3. Add a static package-script contract test so the E2E path cannot silently regress to the default heap.
4. Run the full E2E build and require complete standalone artifacts, TypeScript success, all static pages, traces, and exit 0.

## Required checks

- `pnpm exec vitest run tools/scripts/e2e-local-build-contract.test.ts`
- Exact ESLint, Prettier, and diff checks for the package script and contract test.
- `pnpm build:e2e:local`
- Confirm `.next/BUILD_ID` and `.next/standalone/server.js` exist before starting the local runtime.

## Anti-patterns

- Relying on a caller-provided `NODE_OPTIONS` that is not encoded in the package script.
- Weakening the E2E build environment or skipping pages to reduce memory use.
- Claiming success from a completed compile stage without checking the final process exit and standalone artifacts.

## Links

- fixes: [[projects/careviax/failures/2026-07-14/e2e-local-build-default-heap-oom]]
