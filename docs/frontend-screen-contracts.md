# FRONTEND-CONTRACT-001 — 7画面 UI slice contract

Status: Active FE implementation SSOT for `FRONTEND-CONTRACT-001`.
Confirmed: 2026-07-09.

This document is the contract gate before the seven operational FE slices. It is
not a visual redesign spec and must not be used to invent production-like UI
against missing APIs. `docs/ui-ux-design-guidelines.md` remains the PH-OS UI/UX
SSOT; `docs/compliance/access-control-policy.md` remains the authorization and
PHI disclosure boundary.

## Scope

- Covered screens: patient list, patient detail, dispensing workbench, schedule,
  visit record, reports, inbound communications.
- Compatibility target: none. This is a new-only release contract; later slices
  must replace old aliases, classic shells, legacy response/action shapes, and
  archived surface behavior instead of supporting both paths.
- Shared chrome dependency: AppShell / Sidebar / Header / WorkspaceActionRail.
- Cross-screen QA dependency: `FE-QA-001` covers loading, empty, data, partial,
  error, forbidden, stale, offline, conflict, mobile, keyboard, and PHI output
  boundary fixtures. Canonical state vocabulary:
  `loading, empty, data, partial, error, forbidden, stale, offline, conflict`.
- Excluded from Codex-only completion: DB migration application, production data
  mutation, live AWS evidence, deploy, secret rotation, destructive operations.

## Shared Rules

- Use current routes and current components only. Do not restore legacy movement
  aliases, old patient timeline shells, or archived reference-board behavior.
- Do not add compatibility shims, dual UI paths, or fallback UI contracts for
  removed behavior. A temporary migration gate may keep writes disabled, but it
  must not present legacy behavior as a supported user path.
- Use existing BFF/API/type contracts. If a screen needs a new field, add the
  backend/API contract and frontend consumer in the same slice or record the
  paired backend task before landing.
- Authorization is server-enforced, not inferred by client UI. BFF/API DTOs may
  include PHI only after capability, tenant/org/RLS, assignment/case scope,
  consent, support session, purpose, precondition/OCC where applicable, and
  audit/read-reason gates have passed. Missing or ambiguous scope must render
  `forbidden` or disabled UI and must not fall back to broader summaries, hidden
  client payloads, or legacy routes.
- Show operationally relevant patient, medical, medication, stock,
  communication, attachment, visit, report, billing, and task details only from
  server-authorized DTOs when the current user is authorized by role-specific
  capability, assignment, case scope, consent, support session, and purpose.
- Keep separate minimization boundaries for OS notifications, SSE payloads,
  server logs, audit diffs, external sharing, CSV/PDF export, public URLs, and
  Oracle/GPT prompts.
- Do not show mock completion. Unimplemented writes must be disabled,
  review-waiting, proposal-only, or linked to detail pages.
- Sample/mock data may be visible only in dev/test/demo fixtures, must be
  visibly labeled and PHI-free, and must never enable save/send/confirm/apply/
  complete actions or appear as saved production/org state.
- Removing legacy/classic routes, response shapes, action shapes, aliases, or
  shells must fail closed: 404/410/403 or authorized redirect to the current
  route, with no PHI payload and no write side effect. This is not a
  compatibility shim.
- Mobile parity is required: right rail becomes sheet/drawer or lower priority
  content, primary action remains reachable, tap targets are 44px or larger,
  tables degrade to cards or verified responsive table behavior.
- For visual reconstruction or layout concept changes, create a PHI-free
  `gpt-image-2` design reference before implementation. For docs-only,
  contract-only, validation-only, or state-only slices, record the omission
  reason in `ops/refactor/STATE.md`.

## Shared Shell Contract

| Surface                | Current files                                                                                                                                     | Contract                                                                                                                                                                                          | Existing validation                                                                                                                                         | Next FE slice                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| App shell / navigation | `src/components/layout/app-shell.tsx`, `sidebar.tsx`, `app-header.tsx`, `mobile-nav.tsx`, `navigation-config.ts`, `WorkspaceActionRail` consumers | Keep one dashboard shell. Preserve landmarks, route active state, org-scoped nav badges, network/status banners, and mobile navigation. Do not create a second shell or a separate design system. | `app-shell.test.tsx`, `sidebar.test.tsx`, `app-header.test.tsx`, `mobile-nav.test.tsx`, `navigation-config.test.ts`, `tools/tests/ui-dashboard-nav.spec.ts` | `FE-SHELL-001` can refine shell density and mobile nav without changing data contracts. |

## Screen Entry Point Map

| Slice                   | Screen                            | Entrypoints / primary component                                                                                                                                         | Current BFF/API/source contract                                                                                                                                                                                                                                                                                            | Shared components / types                                                                                                                             | Existing validation                                                                                                                                                                                                                    | Next implementation boundary                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-PATIENT-LIST-001`   | 患者一覧                          | `src/app/(dashboard)/patients/page.tsx` mounts `patients-board.tsx`                                                                                                     | `GET /api/patients/board`; type `src/types/patient-board.ts`; patient links through `buildPatientHref`; org headers through `buildOrgHeaders`                                                                                                                                                                              | `DataTable` patterns, `PatientBoardLoadingShell`, `SafetyTagBadge`, `GuardedWorkspaceActionRail`                                                      | `patients-board.test.tsx`: server filters, cursor page load, stale refetch warning, full error, exact empty, no hidden address search, action rail, safety tag overflow                                                                | Add left summary / trusted list-card / selected preview against `/api/patients/board`. Do not add deep includes or local hidden search fields.                                                                                                                |
| `FE-PATIENT-DETAIL-001` | 患者詳細                          | `src/app/(dashboard)/patients/[id]/page.tsx` server-loads `getPatientOverview`; `card-workspace.tsx` owns tabs                                                          | `getPatientOverview`; `GET/PATCH /api/patients/:id`; `GET /api/patients/:id/movement-timeline`; case risk routes `/api/cases/:id/risk-cockpit*`; document and management-plan routes                                                                                                                                       | `PatientHeader`, safety board, movement timeline, document panel, `buildPatientApiPath`, `buildPatientHref`, `src/types/patient-movement-timeline.ts` | `card-workspace.test.tsx`, `patient-movement-timeline.test.tsx`: skeleton/error/not-found separation, stale cached workspace, movement-safe timeline, document failures, home-operation degraded banner, encoded paths                 | Split command center / must-check / safety / medication / visit / movement / right rail. Use current movement tab only; do not reintroduce history/timeline shell mixing.                                                                                     |
| `FE-DISPENSE-001`       | 調剤 / 監査 / セット / セット監査 | `/dispense`, `/audit`, `/set`, `/set-audit` mount `src/components/features/dispense-workbench/dispensing-workbench.tsx` with phases `dispense`, `audit`, `setp`, `seta` | Read: `/api/dispense-workbench/patients`, `/api/dispense-tasks/:id/workbench`, set-plan calendar endpoints through adapter. Write: `/api/dispense-results`, `/api/dispense-audits`, `/api/set-plans/:id/batches/cell`, `/bulk-set`, `/generate-batches`, `/api/set-audits`, `/api/cycle-holds`, group/line mutation routes | `dispensing-workbench.adapter.ts`, `dispensing-workbench.from-api.ts`, `use-workbench-mutations.ts`, `ConfirmDialog`, F-key handlers                  | `dispensing-workbench.from-api.test.ts`, `*.logic.test.ts`, `*.fkey.test.ts`, `*.confirm.test.tsx`, `use-workbench-mutations.test.tsx`, color-token tests                                                                              | Refine queue/workbench/stepper/right audit rail while preserving phase workflow, OCC/precondition payloads, confirm evidence, F-key contract, and mock/real-data boundary. If mock is visible, label it as sample; never show mock as saved production state. |
| `FE-SCHEDULE-001`       | スケジュール                      | `src/app/(dashboard)/schedules/page.tsx` mounts `schedule-team-board.tsx`; proposals at `/schedules/proposals`                                                          | `GET /api/visit-schedules/day-board`; `/api/dashboard/cockpit`; mutations `/api/visit-schedules/:id`, `/api/tasks/:id`; proposal routes `/api/visit-schedule-proposals*`; route order helpers                                                                                                                              | `src/types/schedule-day-board.ts`, `buildScheduleFocusHref`, `visit-route-client.ts`, proposal workspace tabs                                         | `schedule-team-board.test.tsx`, proposal tests, `tools/tests/ui-schedule-visit-report.spec.ts`: board fetch error, action rail loading, hidden staff metadata, inbound schedule signals, contact follow-up, proposal routing           | Keep proposal-first and confirmed schedule invariants. Do not display unapproved proposals as confirmed schedules. Preserve review-only inbound schedule signals until pharmacist-selected write flow exists.                                                 |
| `FE-VISIT-001`          | 訪問中                            | `src/app/(dashboard)/visits/[id]/record/page.tsx` mounts `visit-record-form.tsx`; voice/capture routes are adjacent                                                     | Read: `/api/visit-schedules/:id`, `/api/visit-preparations/:id`, `/api/cds/check`, patient header/detail helpers. Write: `/api/visit-records`, `/api/visit-records/:id`, file presign/complete, optional patient PATCH; stock panel read-only through medication stock API                                                 | `VisitMedicationManagementSection`, `VisitMedicationStockObservationPanel`, offline store, SOAP draft, conflict helpers, voice/capture draft helpers  | `visit-record-form.test.tsx`, `visit-record-form.shared.test.ts`, voice/capture tests: schedule load blocking, safety tags, PHI-safe save state, offline/conflict, draft autosave, raw draft error omission, stock panel not submitted | Add mobile section split, bottom bar, residual/stock observation input only after migration/DB evidence gate. Before gate, keep stock write disabled/review-waiting and prevent false success.                                                                |
| `FE-REPORT-001`         | 報告書                            | `src/app/(dashboard)/reports/page.tsx` mounts `report-share-workspace.tsx`; detail in `reports/[id]/page.tsx`; delivery dashboard component                             | `GET /api/care-reports/today-workspace`; generate from visit client; `PATCH /api/communications/inbound/signals/:id`; analytics/reminders APIs; report detail/send/PDF/share routes                                                                                                                                        | `ReportsTodayWorkspaceResponse`, `DataTable`, `GuardedWorkspaceActionRail`, `buildReportHref`, report content/permissions types                       | `report-share-workspace.test.tsx`, report detail/share/print tests: false-empty separation, count metadata, raw failure omission, draft generation lock payload, inbound candidate not sent/PDF/shared automatically                   | Organize list/editor/AI-delivery rail. Inbound/visit/chat/stock content enters reports only by pharmacist-selected candidate insertion; never auto-insert raw text into body or external delivery.                                                            |
| `FE-INBOUND-001`        | 他職種受信                        | `src/app/(dashboard)/communications/inbound/page.tsx` mounts `inbound-content.tsx`                                                                                      | `GET/POST /api/communications/inbound`; `GET /api/communications/inbound/signals`; detail `GET /api/communications/inbound/:id/detail?purpose&read_reason&request_id`; signal task/review/apply routes; source mapping route                                                                                               | Formal `InboundCommunicationEvent` / `InboundCommunicationSignal` DTOs, `readApiJson`, source mapping form, MedicationStock selector                  | `inbound-content.test.tsx`: no raw text in inbox, audited detail only after action, source mapping after detail, lifecycle, stock apply selector, false-empty vs fetch failure, canonical intake                                       | Build inbox/detail/signal/action rail from formal Event/Signal. Raw detail stays purpose/read-audit gated; list/notification/audit changes must not include raw_text, sender contact, source URL, extracted text, or attachment content.                      |

## State Matrix

Legend: `Covered` means there is current UI/test evidence. `Required next`
means the next screen slice must add fixture/test coverage before claiming the
state complete.

| Screen       | Loading                                  | Empty                                                             | Data                                                         | Partial / stale                                                         | Error / forbidden                                               | Offline / conflict                                                         | Required next                                                        |
| ------------ | ---------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 患者一覧     | Covered by `PatientBoardLoadingShell`    | Covered exact empty server result                                 | Covered card/grid/list                                       | Covered stale refetch warning, visible/hidden counts                    | Covered full initial error                                      | Required next for mobile preview/drawer                                    | Selected patient preview and mobile drawer state fixtures.           |
| 患者詳細     | Covered skeleton and dynamic panels      | Covered not-found/no-cycle/empty plan distinctions                | Covered tab workspace                                        | Covered cached data after background error and home ops degraded banner | Covered retryable overview/header/document/movement/risk errors | Required next for cross-tab conflict/offline cues                          | Heading order and island-level state fixtures after split.           |
| 調剤         | Covered in workbench loading/error paths | Partial: mock/empty queue behavior needs explicit sample labeling | Covered real-data mapper and workflow tests                  | Required next for partial API hydration                                 | Covered mutation errors/rollback tests                          | Covered by pending/OCC-related mutation tests; broader offline not covered | Screenshot + keyboard + mock-vs-real fixture before layout work.     |
| スケジュール | Covered board/action rail loading        | Covered hidden staff not false-empty                              | Covered day board and proposals                              | Covered cockpit loading/failure separation, hidden counts               | Covered board/cockpit failures                                  | Required next for offline route draft conflict                             | Responsive timeline/proposal rail screenshots and keyboard path.     |
| 訪問中       | Covered schedule skeleton                | Covered where preparation/detail truly empty                      | Covered long form and record submit                          | Covered carry-item partial acknowledgement and unavailable CDS          | Covered schedule/preparation/CDS/save errors                    | Covered offline store, autosave, sync conflict indicators                  | Section-level mobile fixtures and stock write-disabled gate fixture. |
| 報告書       | Covered workspace loading                | Covered created/draft empty only after success                    | Covered drafts, created reports, waiting, inbound candidates | Covered visible/hidden count labels                                     | Covered workspace/failure omission                              | Required next for offline draft conflict                                   | Editor/detail split and delivery rail mobile state fixtures.         |
| 他職種受信   | Covered query loading                    | Covered successful empty inbox                                    | Covered inbox, detail, signal candidates                     | Covered review lifecycle and post-detail source mapping boundary        | Covered fetch failure vs false empty                            | Required next for offline/manual intake recovery                           | Three-pane/mobile drawer fixture and raw-detail boundary snapshot.   |

## PHI And Output Boundaries

| Screen       | Authorized operational display                                                                                 | Boundary that must stay minimized                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 患者一覧     | Patient name, safety tags, next visit, operational summaries, report/stock/inbound/action cues when authorized | Client-hidden address/search-index payloads; address search must be server-side, authorized, explicit, and non-enumerating; server logs, notification/SSE payloads, public export metadata |
| 患者詳細     | Patient header, care team, medications, visit/report/movement/home-operation facts, case risk actions          | Movement list raw body, audit metadata details, external share/public URL payloads                                                                                                         |
| 調剤         | Drug names, counts, patient identity, workflow status, confirm evidence, narcotic double-count scope           | Provider raw errors, storage keys, unreviewed external content, hidden mock state                                                                                                          |
| スケジュール | Patient names, visit windows, pharmacist lanes, inbound schedule request counts/labels, blocked reasons        | Raw inbound text, sender contact, attachments, external URLs, unconfirmed proposal-as-schedule                                                                                             |
| 訪問中       | Visit content, residual medication, observations, SOAP, voice transcript after local action, stock reference   | Raw sync errors in toast/log, unencrypted offline content, stock write success before migration gate                                                                                       |
| 報告書       | Draft rows, created reports, delivery status, normalized inbound report candidates, billing/report issues      | Raw inbound text auto-insertion, unconfirmed signal body in external delivery, raw delivery failure reason                                                                                 |
| 他職種受信   | Inbox summary, controlled normalized detail after audited action, sender/contact only in gated detail          | Raw text in inbox/list/notification/audit diff, sender contact outside gated detail, source URL, extracted text                                                                            |

## Exact-Path Validation List

Run the smallest set that covers the touched slice. For contract-only changes,
run the docs checks below.

- Contract guard: `pnpm frontend-contract:check`
- Active board guard: `pnpm plans:active:check`
- Frontend shell: `pnpm exec eslint src/components/layout/app-shell.tsx src/components/layout/sidebar.tsx src/components/layout/app-header.tsx src/components/layout/mobile-nav.tsx`
- Patient list: `pnpm vitest run 'src/app/(dashboard)/patients/patients-board.test.tsx' --reporter=dot --testTimeout=30000`
- Patient detail: `pnpm vitest run 'src/app/(dashboard)/patients/[id]/card-workspace.test.tsx' 'src/app/(dashboard)/patients/[id]/patient-movement-timeline.test.tsx' --reporter=dot --testTimeout=30000`
- Dispense: `pnpm vitest run src/components/features/dispense-workbench/dispensing-workbench.from-api.test.ts src/components/features/dispense-workbench/dispensing-workbench.confirm.test.tsx src/components/features/dispense-workbench/use-workbench-mutations.test.tsx --reporter=dot --testTimeout=30000`
- Schedule: `pnpm vitest run 'src/app/(dashboard)/schedules/schedule-team-board.test.tsx' 'src/app/(dashboard)/schedules/proposals/schedule-proposals-content.test.tsx' --reporter=dot --testTimeout=30000`
- Visit: `pnpm vitest run 'src/app/(dashboard)/visits/[id]/record/visit-record-form.test.tsx' 'src/app/(dashboard)/visits/[id]/record/visit-record-form.shared.test.ts' --reporter=dot --testTimeout=30000`
- Reports: `pnpm vitest run 'src/app/(dashboard)/reports/report-share-workspace.test.tsx' 'src/app/(dashboard)/reports/[id]/page.test.tsx' --reporter=dot --testTimeout=30000`
- Inbound: `pnpm vitest run 'src/app/(dashboard)/communications/inbound/inbound-content.test.tsx' --reporter=dot --testTimeout=30000`
- Cross-screen browser smoke: `pnpm test:e2e:local --grep "schedule|visit|report|patient|inbound"`

## Stop Conditions

- A slice depends on applying `MedicationStockObservationContext` migration,
  live AWS credentials, restore drill execution, production data mutation, or
  destructive operation.
- A design requires raw patient/medical/communication text in notifications,
  SSE, logs, audit diffs, public URLs, Oracle/GPT prompts, or any external
  share/CSV/PDF export without explicit user action, scope, recipient/purpose,
  consent where required, minimization, and audit.
- A screen appears to save, send, confirm, apply, or complete data using mock
  state, missing APIs, unreviewed signals, or disabled backend gates.
- A proposed UI bypasses existing route helpers, path encoders, org headers,
  shared DTOs, precondition/OCC fields, or audit-near-action requirements.
- A proposed slice keeps a legacy/classic route, response shape, action shape,
  alias, or shell alive only for compatibility instead of replacing it with the
  current contract.
