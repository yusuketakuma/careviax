---
type: FixPattern
title: <standard fix for <failure>>
memory_id: projects/careviax/fix-patterns/<fix-id>
project_id: careviax
created_by: <codex-lead | claude-lead>
owner_agent: <codex-lead | claude-lead>
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
tags: [<area>, <concern>, <technology>, <agent>]
---

# <title>

fixes: [[projects/careviax/failures/<failure-id>]]

## Recipe

1. <step>
2. <step>
3. <step>

## Required checks

- `pnpm typecheck` · `pnpm test <area>` · <visual / behavior check>

## Anti-patterns

- <what NOT to do>

## Links

- fixes: [[projects/careviax/failures/<failure-id>]]
