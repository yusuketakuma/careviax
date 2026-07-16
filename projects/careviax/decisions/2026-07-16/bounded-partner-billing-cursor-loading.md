---
type: ImplementationDecision
title: Keep partner billing cursor reads explicit and partial-aware
created: '2026-07-16T18:29:49+09:00'
branch: codex1/continuous-optimization-20260716
source:
  - >-
    file:src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx
  - >-
    file:src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx
  - 'commit:9385da344bbfbe055e2d6c20e15823f1b1612962'
  - 'test:pnpm exec vitest run partner-cooperation-billing-content.test.tsx'
  - 'test:pnpm typecheck'
task_id: FE-PARTNER-BILLING-CURSOR-001A
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/bounded-partner-billing-cursor-loading
confidence: high
created_at: '2026-07-16T09:29:49.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-16T09:29:49.000Z'
owner_agent: codex-lead
commit_after: 9385da344bbfbe055e2d6c20e15823f1b1612962
commit_before: 3ee7b2e46
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - >-
      src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx
    - >-
      src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.test.tsx
  tech_stack:
    - Next.js
    - React
    - TypeScript
    - TanStack Query
  directories:
    - src/app/(dashboard)/billing/partner-cooperation
ingested_via: put_page
ingested_at: '2026-07-16T09:30:20.326Z'
source_kind: put_page
tags:
  - accepted
  - accessibility
  - api-contract
  - billing
  - codex
  - pagination
  - stability
  - tanstack-query
  - ui
---

# Keep partner billing cursor reads explicit and partial-aware

## Problem

- summary: Partner billing candidates and invoices discarded cursor metadata after the first 20 rows, so local tables could look empty or complete while authorized rows remained unread.
- evidence: The two GET consumers returned only `json.data`; both providers already returned `has_more` and `next_cursor`.

## Decision

- adopted: Use independent bounded `useInfiniteQuery` chains for candidates and invoices with user-triggered load-more controls, loaded-count copy, partial/error states, repeated-cursor detection, and duplicate-ID fail-visible handling.
- reason: Explicit continuation avoids both the false-complete first-page bug and an eager fetch-all burst. Loaded rows remain usable when a later page fails.

## Alternatives rejected

- Eagerly collect every cursor page on initial render: rejected because it hides partial scope, increases request and payload cost, and violates the active Plans stop condition.
- Treat a repeated cursor as end-of-list: rejected because malformed continuation would be misreported as a complete list.

## Migration

- from: first-page `useQuery` arrays
- to: independent cursor page envelopes flattened only for currently loaded rows

## Verification

- focused Vitest 1 file / 17 tests passed, including non-eager page 2, cursor propagation, repeated cursor, and duplicate identity.
- exact ESLint, Prettier, diff check, typecheck, frontend/API/client-schema/PHI static gates passed.
- authenticated desktop and mobile browser checks showed the loaded-count complete state with no console or page errors.

## Review

- reviewer: codex-lead; result: approved as slice 001A. Server-side status/pharmacy filtering and authoritative total remain in the parent task.

## Future rule candidate

- Cursor-backed operational tables must state loaded scope and make continuation explicit; never infer completeness from a bounded first page or silently stop on cursor drift.

## Links

- canonical: [[file:src/app/(dashboard)/billing/partner-cooperation/partner-cooperation-billing-content.tsx]]
