---
type: BlockedContext
title: set-audit fixed-fixture e2e timed out after repeated stabilization attempts
branch: refactor/state-color-unification
source:
  - 'file:tools/tests/e2e-prescription-dispensing-flow.spec.ts'
  - >-
    file:src/components/features/dispense-workbench/use-workbench-write-handlers.ts
  - 'file:src/components/features/dispense-workbench/medication-calendar-grid.tsx'
  - >-
    test:PLAYWRIGHT_REUSE_SERVER=1 pnpm exec playwright test --config
    playwright.local.config.ts
    tools/tests/e2e-prescription-dispensing-flow.spec.ts --project=chromium
    --grep set-audit-final-approval-conflict
task_id: RUN-20260622-001-medical-ui-gate-stabilization
repo_url: null
memory_id: projects/careviax/blocked/2026-06-22/set-audit-fixed-fixture-e2e-timeout
confidence: high
created_at: '2026-06-22T00:33:50.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-06-22T00:33:50.000Z'
owner_agent: codex-lead
commit_after: null
commit_before: 760db51896eb7b760ca29d012a4c8312920f6231
superseded_by: null
evidence_level: tested
reviewer_agent: claude-lead
validity_scope:
  repo: careviax
  files:
    - tools/tests/e2e-prescription-dispensing-flow.spec.ts
  tech_stack:
    - Next.js
    - React
    - TypeScript
    - Playwright
    - Zustand
  directories:
    - tools/tests
    - src/components/features/dispense-workbench
ingested_via: put_page
ingested_at: '2026-06-22T00:34:37.012Z'
source_kind: put_page
tags:
  - agent-loop
  - blocked
  - codex
  - dispense
  - e2e
  - set-audit
  - stability
---

# set-audit fixed-fixture e2e timed out after repeated stabilization attempts

## Blocked reason

- Codex support work reached the loop hard-stop condition for repeated focused e2e failures on the set-audit fixed-fixture final approval path.
- The latest failed state showed the set-audit page at zero audited cells with the approval and checklist controls disabled after navigation/hydration, while earlier attempts alternated between audited progress and no final approval POST.
- Continuing safely likely requires inspecting or modifying dispense-workbench product code outside the Codex locked paths, or a Claude-owned review of the hydration/write-handler flow.

## Blocked by

- Lock expansion or Claude handoff for dispense-workbench implementation files.
- Peer review of whether this is test harness setup drift, patient/plan hydration instability, or a product bug in set/set-audit state persistence.

## Attempted

- Removed the local duplicate `PATIENT_HANDLING_TAG_CLASSES` from the patient board in favor of the shared safety-board helper.
- Made prescription intake `apiFetch` avoid retrying POST by default.
- Stabilized schedule proposal and optimizer tests with deterministic fixture setup.
- Updated set-to-set-audit navigation to use the actual set-audit href instead of action-click route waiting.
- Added target-patient reselection and visit carry/outside-med toggle confirmation in the e2e helper.
- Focused schedule e2e passed; focused set-audit final approval conflict case still timed out.

## Safe next action

- Ask `claude-lead` to review or grant a narrow lock for `src/components/features/dispense-workbench/*` around hydration, `useWorkbenchWriteHandlers`, and set/set-audit state persistence.
- Re-run only the single focused conflict test after the root cause is identified; do not keep blind-retrying the same Playwright command.

## Do not do

- Do not skip or weaken the final approval tests.
- Do not broaden POST retries for mutating requests.
- Do not edit auth, billing, payments, security, migrations, or production surfaces for this blocker.
- Do not store patient names, DB URLs, cookies, tokens, or raw Playwright logs in gbrain.

## Links

- mirrors: [[.agent-loop/BLOCKED.md]]
- evidence: [[tools/tests/e2e-prescription-dispensing-flow.spec.ts]]
