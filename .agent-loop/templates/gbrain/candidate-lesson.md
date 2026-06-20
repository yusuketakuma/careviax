---
type: CandidateLesson
title: <lesson — phrased as a rule>
memory_id: projects/careviax/lessons/candidates/<lesson-id>
project_id: careviax
task_id: <QL-YYYYMMDD-nnn>
created_by: <claude-lead | codex-lead>
owner_agent: <claude-lead | codex-lead>
confidence: medium
evidence_level: peer_reviewed
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
times_confirmed: 1
promotion_status: candidate
tags: [<area>, <concern>, <agent>]
---

# <title>

lesson: <one-sentence rule>
source_task: <QL-YYYYMMDD-nnn>
source_memory: [[projects/careviax/decisions/<decision-id>]]

## Applies to

- [<area>, <concern>]

## Validated by

- [peer_review, typecheck, unit_test]

## Promotion requirements (see PROMOTION_QUEUE.md §13)

- reproduced in 2+ independent runs · both supervisors agree · gate-backed · stack-fit ·
  clear exceptions · no security weakening · explicit human approval

## Anti-conditions

- <when this lesson must be re-evaluated>

## Links

- derived_from: [[projects/careviax/decisions/<decision-id>]]
- promotes_to: PROMOTION_QUEUE.md
