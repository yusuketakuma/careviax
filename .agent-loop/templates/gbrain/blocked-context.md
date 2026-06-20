---
type: BlockedContext
title: <short — why we stopped>
memory_id: projects/careviax/blocked/<yyyy-mm-dd>/<blocked-id>
project_id: careviax
task_id: <QL-YYYYMMDD-nnn>
created_by: <claude-lead | codex-lead>
owner_agent: <claude-lead | codex-lead>
confidence: high
evidence_level: observed
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
tags: [blocked, <security?>, <destructive-migration?>, <agent>]
---

# <title>

## Blocked reason

- <destructive DB migration | billing domain | missing staging credentials | auth/payments | ...>

## Blocked by

- <human approval | staging credential | migration plan review>

## Attempted (safe, read-only)

- <schema impact scan · tests discovery · migration file inspection>

## Safe next action

- <present migration plan to human · prepare dry-run env · run as a separate task after approval>

## Do not do

- <do not auto-run migration · do not stub billing logic>

## Links

- requires: HumanApproval
- mirrors: [[.agent-loop/blocked]]
