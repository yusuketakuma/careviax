---
type: ImplementationDecision
title: <decision — e.g. Consolidate API fetchers into src/lib/...>
memory_id: projects/careviax/decisions/<decision-id>
project_id: careviax
task_id: <QL-YYYYMMDD-nnn>
commit_after: <sha>
created_by: <codex-lead | claude-lead>
owner_agent: <codex-lead | claude-lead>
reviewer_agent: <claude-lead | codex-lead>
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [<src/...>], files: [<src/...>] }
expires_at: null
superseded_by: null
tags: [<area>, <concern>, <technology>, <agent>, accepted]
---

# <title>

## Problem

- summary: <what was wrong / duplicated>
- evidence: <src/a>, <src/b>

## Decision

- adopted: <the chosen implementation, named canonical>
- reason: <why — consolidation / single source / fewer test targets / ...>

## Alternatives rejected

- <proposal> — <why rejected> (file a separate RejectedApproach for strong ones)

## Migration

- from: [<src/...>] → to: [<src/...>]

## Verification

- `pnpm typecheck` · `pnpm test <area>` · `pnpm build` → <pass>

## Review

- reviewer: <codex-lead|claude-lead> · result: <approved>

## Future rule candidate

- <one-sentence rule for next time>

## Links

- produced_by: [[projects/careviax/loop-runs/<YYYY-MM-DD>/<task-id>]]
- rejects: [[projects/careviax/rejected/<rejected-id>]]
- canonical: [[file:<src/...>]]
