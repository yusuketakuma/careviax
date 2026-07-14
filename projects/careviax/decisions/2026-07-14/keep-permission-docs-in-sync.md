---
type: ImplementationDecision
title: Keep permission documentation synchronized with the runtime matrix
task_id: PERM-DOC-SYNC-001A
memory_id: projects/careviax/decisions/2026-07-14/keep-permission-docs-in-sync
confidence: high
created_by: codex1
expires_at: null
project_id: careviax
captured_at: '2026-07-14T02:37:05.053Z'
owner_agent: codex1
captured_via: capture-cli
commit_after: 2c5aa56d7
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex2
validity_scope:
  repo: careviax
  files:
    - src/lib/auth/permission-matrix.ts
    - src/lib/auth/__tests__/permission-matrix-doc-sync.test.ts
    - docs/compliance/access-control-policy.md
  directories:
    - src/lib/auth
    - docs/compliance
ingested_via: put_page
ingested_at: '2026-07-14T02:37:05.782Z'
source_kind: put_page
tags:
  - accepted
  - authorization
  - codex
  - documentation
  - permissions
  - testing
---

# Keep permission documentation synchronized with the runtime matrix

## Problem

- The capability table and runtime permission matrix were independently maintained.
- A role, capability, or permission-bit change could update only one side and leave the policy documentation inaccurate without failing CI.

## Decision

- Derive frozen role and capability key lists from the typed runtime matrix.
- Parse the policy capability table in a focused test and require exact role and capability sets, unique capability rows, supported boolean markers, exact row widths, and bit-for-bit parity with `hasPermission`.
- Keep permission values and route behavior unchanged; this slice adds a drift guard only.

## Alternatives rejected

- Duplicating the role and capability lists inside the test was rejected because the duplicate could drift together with the document and miss runtime additions.
- Snapshotting only the Markdown text was rejected because it would not prove semantic parity with the runtime authorization result.

## Migration

- from: independently maintained runtime and documentation matrices
- to: runtime-derived keys plus semantic documentation parity test

## Verification

- Focused permission suites: 2 files / 10 tests passed.
- Exact ESLint, Prettier, and diff checks passed.
- Shared `pnpm typecheck` and bare `pnpm typecheck:no-unused` passed.

## Review

- reviewer: codex2
- result: approved; no authorization, privacy, or test-robustness blocker

## Future rule candidate

- Any role or permission capability change must update the runtime matrix and documented capability table in the same verified slice.

## Links

- canonical: [[file:src/lib/auth/permission-matrix.ts]]
- guard: [[file:src/lib/auth/__tests__/permission-matrix-doc-sync.test.ts]]
- policy: [[file:docs/compliance/access-control-policy.md]]
