# Test Spec: CareViaX UI/UX Improvement

## Scope

This test spec covers the repo-wide UI/UX improvement plan, with priority on dashboard and the prescription-to-reporting workflow.

## Verification Principles

1. Verify shared primitives first, then route-level integration.
2. Use focused tests for structural regressions before broad E2E sweeps.
3. Protect desktop and mobile layout integrity on dense operational screens.

## Unit / Component

### Shared UI primitives

- `WorkflowPageHeader`
  - eyebrow / support copy / action / labeled shortcut rail render correctly
- `WorkflowPageIntro`
  - header alignment remains intact when support content and right rail coexist
- `PageShortcutLinks`
  - grouped and ungrouped variants stay stable

### Priority screen components

- dashboard content grouping tests
- queue/list screen tests for new section headings and summary group presence
- detail screen tests where tab or action visibility changes

## Integration / Route-level

Priority route verification:

- `/dashboard`
- `/workflow`
- `/prescriptions`
- `/dispensing`
- `/auditing`
- `/medication-sets`
- `/schedules`
- `/reports`
- key detail routes under patients / visits / workflow as modified

Assertions:

- shared header structure is visible
- grouped layout renders without horizontal overflow
- primary action and adjacent shortcuts are reachable
- blocked/backlog summary is visible where intended

## E2E / Browser

### Desktop Chromium

- `tools/tests/ui-page-layout.spec.ts`
- `tools/tests/ui-detail-layout.spec.ts`
- `tools/tests/ui-dashboard-nav.spec.ts`
- `tools/tests/ui-schedule-visit-report.spec.ts`
- any targeted flow spec added for the core queue screens

### Mobile Chromium

- `tools/tests/ui-mobile-layout.spec.ts`

Assertions:

- no horizontal overflow
- grouped sections remain readable
- primary actions keep touch-target size
- tab/shortcut rails remain usable

## Lint / Static Checks

- Run `eslint` on touched files each phase
- Run focused `vitest` on touched test/component sets

## Phase-by-Phase Verification

### Phase 1

- shared primitive tests
- dashboard layout tests

### Phase 2

- queue/index page route checks
- relevant unit tests for section grouping

### Phase 3

- detail layout tests
- targeted route verification for changed detail screens

### Phase 4

- broad layout sweep
- mobile layout sanity pass

## Residual Gaps To Watch

- Theme consistency across lower-priority screens may still rely on broader Playwright coverage.
- Detail screens with both sidebar and top-level navigation need explicit visual review when changed.
