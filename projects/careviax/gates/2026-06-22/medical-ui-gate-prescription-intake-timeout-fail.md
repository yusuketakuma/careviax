---
type: project
title: Medical Ui Gate Prescription Intake Timeout Fail
ingested_via: put_page
ingested_at: '2026-06-22T03:55:42.582Z'
source_kind: put_page
---

# GateResult: medical-ui gate prescription-intake timeout fail

- type: GateResult
- run_id: RUN-20260622-001
- task_id: RUN-20260622-001-medical-ui-gate-stabilization
- recorded_at: 2026-06-22T12:52:14+09:00
- gate: `pnpm medical-ui:e2e:gate`
- result: fail
- confidence: high
- evidence_level: command_output_and_server_log
- validity_scope: current branch `refactor/state-color-unification`, local e2e services

## Result

The controlled final medical-ui gate failed. Preflight, duplicate care-report check, visit-route conflict check, and migration preconditions passed. Playwright then failed the billing/PCA/prescription guardrail test because `/api/prescription-intakes` returned 500 for a blocked-injection payload that should return validation 400.

## Key Evidence

- Failing assertion: `tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts:249`.
- Expected: HTTP 400 validation error for an unconfirmed outpatient/self-injection drug.
- Actual: HTTP 500.
- Server log root cause: Prisma interactive transaction timeout at `workflowException.findFirst` in `src/server/services/prescription-intake-service.ts`.
- Direct minimal authenticated fetch returned expected HTTP 400 with `blocked_lines`, but took 33718ms.

## Follow-up

Do not release `medical-ui-gate-stab-20260622`. Resolve or hand off the prescription-intakes performance/stability issue, then rerun the focused guardrail and the full gate.
