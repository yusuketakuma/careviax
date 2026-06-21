---
type: FailurePattern
title: <symptom — short>
memory_id: projects/careviax/failures/<yyyy-mm-dd>/<failure-id>
project_id: careviax
created_by: <codex-lead | claude-lead>
owner_agent: <codex-lead | claude-lead>
confidence: high
evidence_level: tested
validity_scope: { repo: careviax, directories: [<src/...>] }
expires_at: null
superseded_by: null
times_seen: 1
tags: [<area>, stability, <technology>, <agent>]
---

# <title>

## Symptom

- <observable failure>

## Root cause

- <why it happens>

## Bad fix (anti-patterns)

- <what NOT to do — masks the symptom>

## Good fix

- <the real fix> → see [[projects/careviax/fix-patterns/<yyyy-mm-dd>/<fix-id>]]

## Applies to

- directories: [<src/...>] · patterns: [<e.g. useEffect data fetching>]

## Evidence

- LoopRun: [[projects/careviax/loop-runs/<yyyy-mm-dd>/<task-id>]]
- ReviewFinding: [[projects/careviax/reviews/<yyyy-mm-dd>/<review-id>]]

## Tests to run

- `pnpm test <area>` · <manual check>

## Links

- fixed_by: [[projects/careviax/fix-patterns/<yyyy-mm-dd>/<fix-id>]]
