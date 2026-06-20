---
type: DuplicateMap
title: <consolidation — e.g. items filtering logic>
memory_id: projects/careviax/duplicates/<duplicate-map-id>
project_id: careviax
task_id: <QL-YYYYMMDD-nnn>
created_by: <codex-lead | claude-lead>
owner_agent: <codex-lead | claude-lead>
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
tags: [<area>, duplicate-removal, <agent>]
---

# <title>

## Canonical implementation

- file: <src/...> · exports: [<fn>, <fn>]

## Duplicates removed

- <src/...> — <removed logic>

## Callers migrated

- <src/...>

## Do not recreate

- <rule: do not re-implement this per-screen>

## Verification

- `pnpm test <area>` · `pnpm typecheck` → <pass>

## Links

- canonicalizes: [[file:<src/...>]]
- produced_by: [[projects/careviax/loop-runs/<YYYY-MM-DD>/<task-id>]]
