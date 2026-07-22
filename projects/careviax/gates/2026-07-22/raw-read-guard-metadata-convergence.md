---
type: GateResult
title: Raw-read guard metadata convergence
memory_id: projects/careviax/gates/2026-07-22/raw-read-guard-metadata-convergence
project_id: careviax
repo_url: https://github.com/yusuketakuma/careviax.git
branch: codex1/continuous-optimization-20260716
commit_before: b13607c5c
commit_after: 1c7f72da1
task_id: RLS-RAW-READ-GUARD-001
feature_id: null
created_at: 2026-07-22T15:58:00+09:00
updated_at: 2026-07-22T15:58:00+09:00
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: codex-lead
source:
  - file:tools/raw-read-org-guard-allowlist.json
  - commit:28c8b3e2d0
  - commit:1c7f72da1
  - test:pnpm db:raw-read-org-guard:check
confidence: high
evidence_level: gate_verified
validity_scope:
  repo: careviax
  directories: [tools, src/server/jobs, src/server/services]
  files: [tools/raw-read-org-guard-allowlist.json]
  tech_stack: [TypeScript, Prisma, RLS]
expires_at: null
superseded_by: null
tags: [rls, static-analysis, allowlist, metadata, codex, accepted]
---

# Raw-read guard metadata convergence

## Commands

- `pnpm db:raw-read-org-guard:check` -> pass, 104 allowlisted violations and 0 new violations
- JSON parse, Prettier, and diff check -> pass

## Security

`RAW-READ-ORG-050` retains the global DrugMaster rationale and exact count while following the read moved by commit `28c8b3e2d0`. Seven entries with zero current detections were removed; no guard rule or exclusion was weakened.

## Overall

result: pass; accepted_for_next_step: true.
