# PRD: CareViaX UI/UX Improvement

## Metadata

- Source spec: `.omx/specs/deep-interview-uiux-improvement.md`
- Context snapshot: `.omx/context/uiux-recent-implementation-20260403T015510Z.md`
- Plan mode: `ralplan --consensus`
- Status: `draft`

## RALPLAN-DR Summary

### Principles

1. Reuse shared layout primitives before adding new surfaces.
2. Make the next action obvious before showing secondary information.
3. Use badges and emphasis only to support operational judgment, not decoration.
4. Keep the visual language clinical and calm; avoid flashy treatment.
5. Preserve workflow behavior while improving structure, grouping, and navigation.

### Decision Drivers

1. Highest operational value sits in dashboard plus the prescription-to-reporting workflow.
2. Scope is repo-wide, so rollout must maximize consistency while keeping diffs reviewable.
3. Existing `PageScaffold` / `WorkflowPageHeader` / `WorkflowPageIntro` already provide the safest extension points.

### Viable Options

#### Option A: Shared primitives first, then apply screen-by-screen by workflow priority

- Pros:
  - Maximizes consistency across the repo.
  - Keeps later page diffs smaller and easier to review.
  - Aligns with the existing brownfield direction.
- Cons:
  - Requires restraint to avoid over-abstracting too early.
  - Initial progress is less immediately visible on a single screen.

#### Option B: Page-by-page workflow redesign without shared primitive expansion

- Pros:
  - Fast visible wins on priority routes.
  - Simpler to reason about one screen at a time.
- Cons:
  - High drift risk across dozens of screens.
  - Repeats header/grouping logic.
  - Conflicts with the current shared-layout trajectory.

#### Decision

Choose **Option A**, but keep the primitive expansion minimal and directly justified by priority screens.

## Problem

CareViaX already has partial UI grouping and shared layout adoption, but the experience is uneven across dashboard, queue screens, and detail flows. Users need a consistent way to see:

- what matters now,
- where work is blocked,
- which action starts the next step,
- and how to move across the core pharmacy workflow without relearning each page.

## Goal

Apply a unified UI/UX theme across CareViaX, with highest priority on:

1. Dashboard
2. Prescription intake
3. Dispensing
4. Dispense auditing
5. Medication set
6. Set auditing
7. Visits
8. Report creation and schedule management

## Non-goals

- Changing business workflow semantics
- Changing backend behavior or API contracts
- Introducing flashy or overly decorative visual design

## Users

- Pharmacists executing the main pharmacy workflow
- Staff coordinating schedules and operational routing

## Success Criteria

### Global

- Priority pages use the same grouping language and header structure.
- Primary actions and workflow entry points are visually obvious.
- Badges indicate status, backlog, or urgency without overwhelming the page.
- The UI remains calm and appropriate for a medical system.

### Dashboard

Within 5 seconds, users can identify:

- today’s overall schedule,
- their own schedule,
- today’s required actions,
- blocked counts in core flows,
- links to jump directly into work.

### Core workflow screens

On each priority screen, users can quickly identify:

- current stage/state,
- blocked or pending counts,
- next action,
- adjacent flow destinations.

## Brownfield Constraints

- Follow `docs/ui-ux-design-guidelines.md` as SSOT.
- Reuse shared page primitives where possible.
- Respect existing uncommitted repo changes.
- Keep diffs small and reversible by grouping work into phases.

## Execution Plan

### Phase 1: Shared theme and entry-point consistency

- Extend shared page/header primitives only where needed for calm emphasis, labeled shortcut rails, and consistent support copy.
- Normalize dashboard and workflow hub headers to reflect the same structure.
- Define a limited badge/emphasis taxonomy for backlog, urgency, and stage state.

### Phase 2: Core queue/index screens

Target pages:

- `src/app/(dashboard)/prescriptions/page.tsx`
- `src/app/(dashboard)/dispensing/page.tsx`
- `src/app/(dashboard)/auditing/page.tsx`
- `src/app/(dashboard)/medication-sets/page.tsx`
- `src/app/(dashboard)/schedules/page.tsx`
- `src/app/(dashboard)/reports/page.tsx`
- `src/app/(dashboard)/workflow/page.tsx`

For each:

- separate header / filter-summary / main list or work area / secondary info,
- make blocked counts and next actions obvious,
- align shortcut grouping and copy tone.

### Phase 3: Dashboard and detail/workbench alignment

Target pages/components:

- dashboard sections and navigation clusters,
- patient and visit detail surfaces where cross-flow actions exist,
- selected workflow detail screens that are part of the core path.

Focus:

- keep dashboard as the master operational surface,
- ensure detail screens still expose clear tabs, summaries, and return paths,
- avoid duplicate emphasis patterns.

### Phase 4: Broad repo sweep for theme consistency

- Apply the chosen header/grouping/badge conventions to remaining screens.
- Limit this sweep to layout and UI structure unless a screen is clearly blocking consistency.

## Risks

- Over-abstracting shared primitives too early and creating brittle props.
- Regressing mobile or overflow behavior on dense list screens.
- Duplicating navigation affordances on detail screens when adding visibility.
- Spending too much time on low-value screens before the core workflow is unified.

## Mitigations

- Only add primitive props that are used by multiple priority pages.
- Keep Playwright layout/detail checks in the loop after each phase.
- Validate detail-screen navigation visually when desktop and mobile affordances differ.
- Use phased commits or review slices by flow group.

## Rollout Order

1. Dashboard + workflow hub + shared header primitives
2. Prescription / dispensing / auditing / set management queues
3. Schedule + reports
4. Detail and remaining route consistency sweep

## ADR

- Decision:
  - Use shared primitives first, then apply the theme by workflow priority.
- Drivers:
  - Need consistency across many screens.
  - Existing primitives already anchor the current UI direction.
  - Dashboard and core workflow queues carry the highest operational value.
- Alternatives considered:
  - Page-by-page redesign without primitive changes
  - Repo-wide sweep without prioritization
- Why chosen:
  - Best balance of consistency, reviewability, and delivery speed.
- Consequences:
  - Some early work lands in shared primitives before broad screen application.
  - Later phases become easier to apply consistently.
- Follow-ups:
  - Add focused tests for shared header usage and grouping-heavy screens.
