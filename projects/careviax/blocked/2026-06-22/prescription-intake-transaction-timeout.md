---
type: project
title: Prescription Intake Transaction Timeout
ingested_via: put_page
ingested_at: '2026-06-22T03:55:35.622Z'
source_kind: put_page
---

# BlockedContext: prescription-intake transaction timeout under medical-ui gate

- type: BlockedContext
- run_id: RUN-20260622-001
- task_id: RUN-20260622-001-medical-ui-gate-stabilization
- recorded_at: 2026-06-22T12:52:14+09:00
- status: blocked
- scope: medical-ui gate, prescription intake guardrail E2E, local ph_os_e2e
- confidence: high
- evidence_level: gate_failure_plus_direct_repro
- validity_scope: current branch `refactor/state-color-unification`, local Next dev server on port 3012, local Postgres e2e DB on port 5433

## Summary

The final `pnpm medical-ui:e2e:gate` is not releasable. It passed preflight and DB integrity checks, then failed in `tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts` because the unconfirmed-injection `/api/prescription-intakes` POST returned 500 instead of the expected 400.

## Evidence

- Playwright failure: `tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts:249`, expected status 400 and received 500.
- Next dev log root cause: `/api/prescription-intakes` POST hit a Prisma interactive transaction timeout at `workflowException.findFirst` in `src/server/services/prescription-intake-service.ts`.
- Minimal authenticated direct fetch to the same blocked payload returned the expected 400 with `blocked_lines`, but elapsed time was 33718ms.
- Local DB activity/lock check after the run showed no lingering blocking sessions.

## Blocker

Codex's current lock forbids `src/server/**` and `src/app/api/**`. The likely fix area is `src/server/services/prescription-intake-service.ts` and/or `src/app/api/prescription-intakes/route.ts`, so Codex must not product-fix without a new owner/lock decision.

## Unblock Condition

Claude either takes and lands the product-code performance/stability fix, or grants Codex a narrow expanded lock for the prescription-intakes path. After the fix, rerun the focused prescription guardrail E2E and a controlled full `pnpm medical-ui:e2e:gate`.
