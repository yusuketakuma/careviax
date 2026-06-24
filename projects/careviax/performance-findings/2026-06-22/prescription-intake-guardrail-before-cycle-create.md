---
type: project
title: Prescription Intake Guardrail Before Cycle Create
ingested_at: '2026-06-22T04:00:15.162Z'
source_kind: put_page
ingested_via: put_page
---

# PerformanceFinding: prescription intake guardrails run after cycle creation

- type: PerformanceFinding
- run_id: RUN-20260622-001
- task_id: RUN-20260622-001-medical-ui-gate-stabilization
- recorded_at: 2026-06-22T12:59:51+09:00
- status: candidate_fix_classification
- confidence: high
- evidence_level: source_read_plus_live_db_explain
- validity_scope: current branch `refactor/state-color-unification`, local e2e DB, read-only investigation

## Finding

The immediate medical-ui gate blocker is best classified as a code-level transaction-scope problem, not as an index-only migration problem.

`createPrescriptionIntakeInTx` loads/creates a `MedicationCycle` before structuring and outpatient-injection guardrails. When callers send `case_id` + `patient_id` without `cycle_id`, `loadCycleContext` creates a new cycle even if the prescription is later rejected by the outpatient-injection safety guardrail. Repeated blocked POSTs have accumulated many no-intake cycles in the e2e DB.

## Evidence

- Source: `src/server/services/prescription-intake-service.ts` creates the cycle in `loadCycleContext` before `collectStructuringBlockedLines` and `collectOutpatientInjectionBlockedLines`.
- Live e2e DB: 185 `MedicationCycle` rows for the target case/patient; 93 target cycles have no `PrescriptionIntake`.
- `WorkflowException` does not have a composite `(org_id, cycle_id, exception_type, status)` index, but the exact lookup currently scans 95 rows and executes in 0.086ms.
- `MedicationCycle` target lookup currently scans 210 rows and executes in 0.128ms.
- Direct authenticated blocked POST returned the correct 400 contract but took 33718ms; full gate can exceed Prisma's 5s interactive transaction budget and surface as 500.

## Fix Classification

Code-level first:

- Fail fast on structuring/outpatient-injection guardrails before creating a new cycle for `case_id` + `patient_id` payloads when possible.
- Keep the safety contract unchanged: HTTP 400 plus `blocked_lines` for ineligible injections.
- Avoid idempotency-less POST retries as a mitigation.
- Consider a follow-up migration for a composite `WorkflowException` lookup index only after human approval; current local evidence does not prove the missing index is the immediate blocker.
