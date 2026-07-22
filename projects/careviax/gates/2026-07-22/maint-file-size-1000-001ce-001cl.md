---
type: GateResult
title: MAINT-FILE-SIZE-1000-001CE-001CL responsibility extraction gate
memory_id: projects/careviax/gates/2026-07-22/maint-file-size-1000-001ce-001cl
project_id: careviax
repo_url: https://github.com/yusuketakuma/careviax.git
branch: codex1/continuous-optimization-20260716
commit_before: 92650ec02
commit_after: 692ca8162
task_id: MAINT-FILE-SIZE-1000-001CE-001CL
feature_id: null
created_at: 2026-07-22T14:45:56+09:00
updated_at: 2026-07-22T14:45:56+09:00
created_by: codex-lead
owner_agent: codex-lead
reviewer_agent: codex-lead
source:
  - commit:aa613eed2
  - commit:7b1ec2208
  - commit:e52314736
  - commit:7d75bb648
  - commit:692ca8162
  - commit:676628765
  - commit:5bf011d4c
  - commit:42809df81
  - commit:81c6e0ece
  - commit:7975f21c0
  - commit:e552539b2
  - test:pnpm human-maintained-file-size:check
  - test:pnpm authz-account-model-v1:inventory:check
confidence: high
evidence_level: peer_reviewed
validity_scope:
  repo: careviax
  directories: [src/app, src/components, src/phos]
  files:
    - src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx
    - src/app/(dashboard)/patients/[id]/patient-insurance-card.tsx
    - src/app/(dashboard)/qr-scan/page.tsx
    - src/app/(dashboard)/reports/[id]/share/interprofessional-share-content.tsx
    - src/app/api/external-access/route.test.ts
    - src/components/features/dispense-workbench/right-pane.tsx
    - src/phos/infra/api-gateway-lambda-template.test.ts
    - src/phos/ui/board/BoardClient.tsx
  tech_stack: [Next.js, React, TypeScript, Vitest]
expires_at: null
superseded_by: null
tags: [maintainability, ui, test, validation, codex, accepted]
---

# MAINT-FILE-SIZE-1000-001CE-001CL responsibility extraction gate

## Commands

- focused wave 1 tests: 6 files / 117 tests -> pass
- focused wave 2 tests: 6 files / 120 tests -> pass
- independent focused reviews -> pass
- `pnpm human-maintained-file-size:check` -> pass, baseline 144 to 136
- `pnpm authz-account-model-v1:inventory:check` -> pass, direct moved-surface tests registered
- exact ESLint, Prettier, module boundaries, typecheck, typecheck:no-unused -> pass
- build and browser execution -> skipped because the slices preserve visual/runtime behavior and the current integration policy defers the long Next build
- secret scan and dependency audit -> skipped; no dependency, environment, credential, or external request surface changed

## Security

PHI display, archived-write handling, permission classification, IAM, DynamoDB, and Lambda permission assertions were preserved. No secret, schema, migration, dependency, external request, or production mutation was introduced.

## Overall

result: pass; accepted_for_next_step: true. Eight stale baseline entries were removed only after every parent and extracted file was below 1,000 physical lines and focused behavior was independently reviewed.
