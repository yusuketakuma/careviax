---
type: LoopRun
title: <task-id> — <one-line summary>
memory_id: projects/careviax/loop-runs/<yyyy-mm-dd>/<task-id>
project_id: careviax
branch: <branch>
commit_before: <sha>
commit_after: <sha>
task_id: <QL-YYYYMMDD-nnn>
feature_id: <F-... | null>
created_by: <claude-lead | codex-lead>
owner_agent: <claude-lead | codex-lead>
reviewer_agent: <codex-lead | claude-lead>
confidence: medium
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
partial: false
tags: [<domain>, <layer>, <concern>, <agent>, <outcome>]
---

# <task-id> — LoopRun

## Inputs

- feature_queue_items: [<F-...>]
- loop_policy_sources: [gbrain://<slug>, ...]

## Actions

- <what was done>

## Changed files

- <src/...>

## Verification

lint: <pass|fail> · format_check: <pass|fail> · typecheck: <pass|fail> · unit_test: <pass|fail>
integration_test: <skipped> · build: <pass|fail> · e2e: <skipped> · secret_scan: <pass>

## Peer review

- reviewer: <codex-lead|claude-lead> · result: <approved|changes_requested>
- comments: <abstracted>

## Outcome

- status: <accepted|blocked|rejected> · regressions_found: <n> · blocked_items: [<...>]

## Lessons created

- [[projects/careviax/lessons/candidates/<yyyy-mm-dd>/<lesson-id>]]

## Links

- produced: [[projects/careviax/decisions/<yyyy-mm-dd>/<id>]]
