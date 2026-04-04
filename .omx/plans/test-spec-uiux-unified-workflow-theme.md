# Test Spec: CareViaX UI/UX Unified Workflow Theme

## Objective

Verify that the unified UI/UX rollout improves hierarchy and workflow clarity without changing behavior, backend contracts, or introducing flashy design.

## Test Scope

- Shared primitives:
  - `WorkflowPageHeader`
  - `WorkflowPageIntro`
  - `PageScaffold`
  - badge / emphasis contract
- High-priority pages:
  - `dashboard`
  - `workflow`
  - `prescriptions`
  - `dispensing`
  - `auditing`
  - `medication-sets`
  - `visits`
  - `reports`
  - `schedules`
- Representative detail pages in the core flow
- route-family verification for `tail-later` families as they enter scope

## Acceptance Checks

### Shared Structure

- headers clearly separate title/description, primary action, shortcut rail, and support guidance
- scaffolded pages maintain grouped layout with no horizontal overflow
- intro-based and header-only pages remain navigable and visually coherent

### Workflow Clarity

- dashboard shows overall schedule, personal schedule, to-dos, stalled counts, and actionable links
- dashboard acts as today/personal work entry, not a second pipeline backlog hub
- workflow acts as cross-case pipeline backlog and exception hub, not a duplicate personal dashboard
- each core workflow top-level page exposes current purpose and next actions at the top
- queue/list pages separate filters, summaries, and main data groups
- detail pages preserve action visibility and navigation clarity on desktop and mobile

### Design Constraints

- badge usage remains sparse and state-meaningful
- emphasis highlights important status/action, not decoration
- no page becomes visually loud or flashy
- each introduced badge / emphasis pattern maps back to `.omx/plans/badge-emphasis-contract-uiux.md`

## Automated Verification

### Unit / Integration

- `pnpm exec vitest run 'src/components/features/workflow/workflow-page-header.test.tsx'`
- `pnpm exec vitest run 'src/components/features/workflow/workflow-page-intro.test.tsx'`
- `pnpm exec vitest run 'src/app/(dashboard)/dashboard/dashboard-content.test.tsx'`
- Add focused tests for newly grouped list/detail sections where shared copy or grouping logic changes
- Add focused tests for shared badge / severity helpers when a canonical mapping is introduced

### Lint

- `pnpm exec eslint <touched-files>`

### E2E

- `pnpm exec playwright test --config playwright.local.config.ts 'tools/tests/ui-page-layout.spec.ts' --project=chromium`
- `pnpm exec playwright test --config playwright.local.config.ts 'tools/tests/ui-detail-layout.spec.ts' --project=chromium`
- run workflow-specific specs when touched:
  - `tools/tests/ui-dashboard-nav.spec.ts`
  - `tools/tests/ui-workflow-flow.spec.ts`
  - `tools/tests/ui-schedule-visit-report.spec.ts`
  - `tools/tests/ui-mobile-layout.spec.ts`

## Manual Review Checklist

- desktop dashboard feels calm and immediately scannable
- badge count per screen feels limited and meaningful
- major action buttons are easy to locate
- workflow pages visually read in the same theme
- detail pages do not show confusing duplicate navigation without clear reason

## Risks To Watch

- duplicated nav affordances on detail screens
- shared header support blocks becoming too verbose
- shortcut rails growing into secondary toolbars
- inconsistent badge wording or severity color mapping across pages

## Exit Criteria

- touched unit/integration tests pass
- touched lint checks pass
- relevant Playwright layout/detail specs pass
- no known visual regressions in dashboard + core flow top-level screens
- reviewer pass confirms medical-system calmness and non-flashy presentation
- all `core-now` screens are completed
- all `tail-later` route families are either completed or explicitly deferred with reason
