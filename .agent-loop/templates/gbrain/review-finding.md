---
type: ReviewFinding
title: <RF-id> — <abstracted finding>
memory_id: projects/careviax/reviews/<yyyy-mm-dd>/<review-id>
project_id: careviax
task_id: <QL-YYYYMMDD-nnn>
created_by: <codex-lead | claude-lead>
owner_agent: <claude-lead | codex-lead>
reviewer_agent: <codex-lead | claude-lead>
confidence: high
evidence_level: peer_reviewed
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
tags: [<finding_type>, <severity>, <agent>]
---

# <title>

finding_type: <duplicate_implementation|missing_test|ui_regression|type_safety|performance|security>
severity: <high|medium|low> · status: <fixed|accepted_risk|blocked|false_positive>

## Finding

- summary: <reusable shape of the problem>
- details: <abstracted>

## Evidence

- <src/...>, <src/...>

## Recommended action

- <what to do instead>

## Resolution

- action_taken: <...> · fixed_in_commit: <sha>

## Lesson candidate

- <one-sentence rule>

## Links

- targets: [[file:<src/...>]]
- from_run: [[projects/careviax/loop-runs/<yyyy-mm-dd>/<task-id>]]
