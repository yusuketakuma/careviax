---
type: note
title: >-
  set-audit e2e must use SPA phase-tab navigation when preserving workbench
  state
branch: refactor/state-color-unification
source:
  - 'file:tools/tests/e2e-prescription-dispensing-flow.spec.ts'
  - 'test:focused set-audit conflict and persistence Playwright runs'
task_id: RUN-20260622-001-medical-ui-gate-stabilization
memory_id: >-
  projects/careviax/fix-patterns/2026-06-22/set-audit-spa-nav-preserves-workbench-state
confidence: high
created_at: '2026-06-22T10:26:08+09:00'
created_by: codex-lead
feature_id: medical-ui-gate-stab-20260622
project_id: careviax
legacy_type: FixPattern
owner_agent: codex-lead
evidence_level: tested
reviewer_agent: claude-lead
validity_scope:
  repo: careviax
  files:
    - tools/tests/e2e-prescription-dispensing-flow.spec.ts
  tech_stack:
    - Playwright
    - React
    - Zustand
    - Next.js
ingested_via: put_page
ingested_at: '2026-06-22T01:26:57.871Z'
source_kind: put_page
tags:
  - agent-loop
  - codex
  - e2e
  - fix-pattern
  - set-audit
  - stability
---

# set-audit e2e must use SPA phase-tab navigation when preserving workbench state

## Problem

The set-to-set-audit final approval tests depend on in-session workbench state created on the Set page, including selected plan context and visit carry packet evidence. A full page reload into `/set-audit` can lose that client-side state and make the audit page appear hydrated but not ready for final approval.

## Fix pattern

- Enter `/set` first and complete the carry/outside-med evidence on the Set page.
- Move to `/set-audit` through the phase tab as an SPA navigation, then wait on URL, active tab, period text, and a visible set-audit cell.
- Keep direct API probes aligned with the production adapter contract, including `include_set_plan=1` when reading workbench patients for SetPlan hydration.
- Assert the outgoing final approval POST carries the selected `plan_id` so fixture drift is caught without relying only on visible text.

## Evidence

- Focused conflict case passed after preserving SPA navigation and asserting the approval payload plan id.
- Focused persistence case passed individually against the fixed local e2e fixture.
- Mobile non-submit set-audit smoke passed with the route-mocked fixture.

## Do not do

- Do not replace phase-tab navigation with full-route reloads for tests that intentionally carry client workbench state between phases.
- Do not add retries for mutating POST requests to hide transient 500s or duplicate writes.
- Do not store DB URLs, cookies, tokens, raw trace files, or patient-identifying data in gbrain.

## Links

- supersedes blocker context: [[projects/careviax/blocked/2026-06-22/set-audit-fixed-fixture-e2e-timeout]]
- evidence: [[tools/tests/e2e-prescription-dispensing-flow.spec.ts]]
