# Ultracode Expansion — Round 2 (Codex cross-review) — 2026-07-02

Claude の `ULTRACODE_EXPANSION_ROUND2_CLAUDE.md` N01-N33 を、Codex 側の DB/RLS, frontend/offline, backend/TZ, concurrency, performance, security, medical-safety subagents で read-only 再検証した結果。実装・stage・commit・DB write・migration 適用はしていない。

## Executive verdict

- Round 2 の N 群は大半が実体あり。ただし RLS 群は **missing RLS** と **SSOT drift** を明確に分ける。
- **missing RLS anywhere**: N01, N06, N07, N11/F79, N12, N14, N17, N28, N29, N33.
- **migration protected but SSOT drift**: N02, N03, N04, N05, N08, N09, N13, N15, N31.
- **dedup/merge required**: N11 is already F79. N02/N13/N15 should be one Facility/FacilityContact/ExternalProfessional SSOT-drift cluster. N04/N09 should be one PharmacyCooperationMessage/Thread cluster.
- RLS contract gap is structural: `src/tools/rls-policy-contract.test.ts` is a fixed small allowlist and does not derive org-scoped coverage from schema.

## RLS cluster normalization

| cluster                        | status              | ids                             | action                                                                                                  |
| ------------------------------ | ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Patient/package/condition PHI  | confirmed           | N01 missing RLS; N08 SSOT drift | N01 needs migration + SSOT. N08 needs SSOT only. F82 is CDS input gap, not RLS duplicate.               |
| Facility/external masters      | confirmed, merge    | N02, N13, N15                   | Treat as one SSOT-drift patch for Facility, FacilityContact, ExternalProfessional.                      |
| Pharmacy cooperation messages  | confirmed, merge    | N04, N09                        | Treat as one SSOT-drift patch for message + thread.                                                     |
| Formulary                      | confirmed duplicate | N11, F79                        | Implement under F79. N11 should not create a second queue item.                                         |
| Visit scheduling tenant tables | confirmed           | N06, N07                        | Missing RLS backstop; current app filters lower live reachability.                                      |
| Tenant config/admin tables     | confirmed           | N14, N17, N28, N29, N33         | Missing RLS backstop; require approval-gated migration + SSOT + generated contract.                     |
| Migration-protected SSOT drift | confirmed           | N03, N05, N31                   | Production migration chain likely protected; SSOT-provisioned env and audit artifact drift remain real. |

## Cross-review matrix

| id  | Codex verdict                          | consistency / correction                                                                                                                                | evidence anchor                                                                                                      | tests to require                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| N01 | Confirm                                | `PatientPackagingProfile` is org-scoped PHI and has no RLS in migrations/SSOT.                                                                          | `prisma/schema/patient.prisma:373`; `prisma/rls-policies.sql:457`                                                    | schema-derived RLS coverage + cross-tenant smoke.                                 |
| N02 | Partial merge                          | FacilityContact drift is real; merge with N13/N15 for Facility/FacilityContact/ExternalProfessional.                                                    | `prisma/schema/organization.prisma:422`; migration `20260328234500_add_facility_and_external_masters`                | SSOT coverage for all three; contract catches omission.                           |
| N03 | Confirm                                | JahisSupplementalRecord is migration-protected but absent from SSOT.                                                                                    | `prisma/schema/prescription.prisma:587`; migration `20260421090000_jahis_supplemental_records`                       | SSOT contract.                                                                    |
| N04 | Confirm, merge with N09                | PharmacyCooperationMessage absent from SSOT; thread shares same patch.                                                                                  | `prisma/schema/pharmacy-partnership.prisma:394`; migration `20260619223000_add_pharmacy_cooperation_message_threads` | SSOT covers message + thread.                                                     |
| N05 | Confirm                                | SavedView is org-scoped and migration-protected but absent from SSOT.                                                                                   | `prisma/schema/saved-view.prisma:3`; migration `20260614120000_wave2_design_fidelity_contract`                       | JSON/filter PHI regression + SSOT contract.                                       |
| N06 | Confirm                                | VisitScheduleOverride missing RLS; current call sites mostly filter org_id, so defense-in-depth gap.                                                    | `prisma/schema/visit.prisma:372`                                                                                     | migration + route cross-org tests.                                                |
| N07 | Confirm                                | VisitScheduleContactLog missing RLS; patient contact PHI.                                                                                               | `prisma/schema/visit.prisma:343`                                                                                     | migration + static contract.                                                      |
| N08 | Confirm, not duplicate of F82          | PatientCondition SSOT drift; F82 is CDS coverage.                                                                                                       | `prisma/schema/patient.prisma:257`; migration `20260329022000_add_patient_conditions_table`                          | SSOT contract.                                                                    |
| N09 | Confirm, merge with N04                | PharmacyCooperationMessageThread absent from SSOT.                                                                                                      | `prisma/schema/pharmacy-partnership.prisma:371`                                                                      | same as N04.                                                                      |
| N10 | Confirm                                | Top admin/realtime signals false-zero on workflow query error while lower panel has error guard.                                                        | `src/app/(dashboard)/admin/realtime/page.tsx:128`, `:188`, `:222`                                                    | workflow query error shows retry/unknown, not zero.                               |
| N11 | Confirm duplicate of F79               | Technical claim true, but already covered by F79 FormularyTemplate/FormularyChangeRequest missing RLS.                                                  | `prisma/schema/drug.prisma:246`; `ops/refactor/ULTRACODE_FINDINGS_20260702.md:617`                                   | implement under F79.                                                              |
| N12 | Confirm                                | FacilityUnit missing RLS.                                                                                                                               | `prisma/schema/organization.prisma:399`                                                                              | migration + parent/facility cross-org smoke.                                      |
| N13 | Partial merge                          | ExternalProfessional SSOT drift is real; merge with N02/N15.                                                                                            | `prisma/schema/organization.prisma:445`; migration `20260328234500_add_facility_and_external_masters`                | same facility/external cluster.                                                   |
| N14 | Confirm                                | BillingRule org-scoped config has no RLS.                                                                                                               | `prisma/schema/admin.prisma:38`                                                                                      | billing-rule cross-org route/service test.                                        |
| N15 | Partial merge                          | Facility and FacilityContact drift real; merge into N02 cluster.                                                                                        | `prisma/schema/organization.prisma:369`, `:422`                                                                      | same facility/external cluster.                                                   |
| N16 | Confirm                                | Billing candidate regeneration does not reassert invoice lock; billing integrity rather than clinical safety.                                           | `src/app/api/visit-billing-candidates/route.ts:124`, `:293`, `:384`; `src/server/services/pharmacy-invoices.ts:643`  | concurrent invoicing between read and update leaves invoiced candidate unchanged. |
| N17 | Confirm                                | PharmacySiteInsuranceConfig missing RLS; FK to protected parent does not cascade RLS.                                                                   | `prisma/schema/organization.prisma:165`                                                                              | site/org mismatch smoke.                                                          |
| N18 | Confirm with ranking correction        | Print hub fetches all SetPlans to choose one. Current ranking is longest target-period span, then newest `created_at`, not simply newest.               | `src/app/api/set-plans/route.ts:98`, `:132`; `src/app/(dashboard)/reports/print/print-hub.shared.ts:293`             | server query equivalence with span/tie cases.                                     |
| N19 | Confirm with column-type nuance        | `startOfDay(new Date())` is reused for instant and @db.Date columns; split helper by column type.                                                       | `src/server/services/home-care-ops.ts:444`, `:641`, `:714`, `:1187`                                                  | UTC runtime dashboard snapshot.                                                   |
| N20 | Confirm                                | External shared upcoming visits uses server-local startOfDay against @db.Date schedule date; not cross-patient leak but minimization/correctness issue. | `src/server/services/external-access.ts:806`                                                                         | early-JST shared payload fixture.                                                 |
| N21 | Confirm                                | Evidence-photo auto-sync is capture-page scoped only.                                                                                                   | `src/lib/offline/evidence-drafts.ts:348`; `src/app/(dashboard)/visits/[id]/capture/capture-content.tsx:124`          | capture unmount then online event drains evidence drafts globally.                |
| N22 | Confirm                                | Notifications unsynced row depends on non-bootstrapped `pendingSyncCount`.                                                                              | `src/app/(dashboard)/notifications/notifications-content.tsx:75`, `:177`, `:226`                                     | page mount refreshes count; count failure is not empty.                           |
| N23 | Confirm                                | Dispense workbench loads every historical SetPlan for selected patients, then keeps first per patient.                                                  | `src/server/services/dispense-workbench-patients.ts:196`, `:231`                                                     | latest-per-patient service equivalence and assignment scoping.                    |
| N24 | Confirm, classify as date correctness  | Same file as F77 but different root cause: JST month bucket/window on instant delivery records.                                                         | `src/server/services/report-reminders.ts:22`, `:154`, `:273`; `ops/refactor/ULTRACODE_FINDINGS_20260702.md:597`      | JST month-edge delivery fixtures.                                                 |
| N25 | Confirm                                | Evidence drafts over retry max are excluded forever; no reset/dead-letter/discard path.                                                                 | `src/lib/offline/evidence-drafts.ts:294`, `:318`, `:327`                                                             | retryCount=3 excluded, manual reset makes syncable again.                         |
| N26 | Confirm                                | conference-sync no-discharge proposal derives date from UTC/local current instant rather than JST date key.                                             | `src/server/services/conference-sync.ts:789`; `prisma/schema/visit.prisma:285`                                       | no-discharge 00:30 JST proposed date.                                             |
| N27 | Confirm, narrower harm                 | Duplicate return-inspection maintenance/audit and last-writer fields; accessory sync mostly idempotent.                                                 | `src/app/api/pca-pump-rentals/[id]/route.ts:40`, `:151`, `:235`, `:254`                                              | double return creates one maintenance event.                                      |
| N28 | Confirm with intent check              | PackagingMethodMaster has required `org_id`; confirm not intended global, then add RLS.                                                                 | `prisma/schema/medication.prisma:171`                                                                                | master-hub/set-plan cross-org test.                                               |
| N29 | Confirm                                | BusinessHoliday org-scoped calendar missing RLS.                                                                                                        | `prisma/schema/organization.prisma:328`                                                                              | schedule planner cross-org read test.                                             |
| N30 | Confirm                                | Nav handoff badge uses server-local date while board producer uses JST date key.                                                                        | `src/server/services/nav-badges.ts:20`, `:81`; `src/app/api/handoff-board/route.ts:91`                               | UTC runtime early-JST nav badge fixture.                                          |
| N31 | Confirm                                | UatFeedback migration has RLS, SSOT omits it.                                                                                                           | `prisma/schema/admin.prisma:306`; migration `20260328234500_add_uat_feedback`                                        | SSOT contract.                                                                    |
| N32 | Confirm, low-to-medium clinical impact | Pump PATCH can clobber status after concurrent rental creation; partial unique prevents double open rental but not status inconsistency.                | `src/app/api/pca-pumps/[id]/route.ts:72`, `:117`; `src/app/api/pca-pump-rentals/route.ts:199`                        | rental POST between PATCH read/update returns conflict and pump remains rented.   |
| N33 | Confirm                                | NotificationRule org-scoped tenant config missing RLS.                                                                                                  | `prisma/schema/admin.prisma:22`                                                                                      | notification-rule cross-org smoke.                                                |

## Additional Codex candidates from neighbor debate

### CXR2-RLS01 [new flag] PrescriberInstitution missing RLS unless intentionally global

- Severity: high if tenant-scoped; needs intent check before migration.
- Evidence: `prisma/schema/organization.prisma:473-496`; migration `20260330213000_add_prescriber_institution_master/migration.sql:1-26`.
- Reproduction: `PrescriberInstitution` has `org_id`, contact fields, and prescription/PCA relations, but the creating migration has table/index/FK only and no RLS block. It is not a direct N ID, though N13 mentions it in prose.
- Impact: prescriber institution contact/config data lacks DB tenant-isolation backstop if tenant-scoped.
- Fix direction: document intent. If tenant-scoped, add approval-gated migration + SSOT + generated contract coverage.
- Tests: RLS coverage test and cross-org suggestion/access smoke.
- Confidence: medium-high.

### CXR2-RLS02 [needs design] User table RLS omission may be intentional

- Evidence: `prisma/schema/organization.prisma:194-229`; baseline creation in `prisma/migrations/20260326000000_baseline/migration.sql:700-713`.
- Why not promoted: `User` has required `org_id` and PII, but auth/user-resolution may intentionally be app-layer/global identity design. Needs architecture/security design review before treating as N-level RLS bug.

### CXR2-SEC01 [new authz] External access GET exposes sharing-management metadata under canReport/canVisit

- Severity: high if list endpoint is a sharing-management surface.
- Evidence: `src/app/api/external-access/route.ts:195`, `:260`, `:386`, `:411`; `src/lib/api/route-catalog.ts:480`; `src/lib/auth/permission-matrix.ts:67`; `src/app/api/external-access/route.test.ts:305`, `:551`.
- Reproduction: `pharmacist_trainee` has `canVisit/canReport` but not `canManagePatientSharing`; unscoped `GET /api/external-access` can enumerate active org grants with patient identity, recipient metadata, scope, expiry/access metadata, and self-report counts.
- Impact: unauthorized disclosure of patient-sharing relationships and external recipient metadata. Separate from F80 POST issuance.
- Fix direction: either gate GET with `canManagePatientSharing`, or split a narrow clinician-visible status endpoint from management listing.
- Tests: trainee negative; pharmacist/admin positive; org-wide listing only for sharing managers; no-store remains asserted.
- Confidence: high, with policy assumption noted.

### CXR2-FE01 [new false-empty] Evidence gallery hides offline-draft query failure as empty

- Severity: medium-high.
- Evidence: `src/app/(dashboard)/visits/evidence/evidence-gallery-content.tsx:70-86`, `:101-115`, `:135-145`, `:207-224`.
- Reproduction: server gallery query reads `isError`, but offline draft query only consumes data. If `listEvidenceDraftSummaries` rejects, `offlineDraftItems ?? []` makes unsynced drafts appear as 0, and the gallery can say no images exist.
- Impact: N21/N25 stuck evidence drafts can be hidden at the gallery surface.
- Fix direction: consume offline draft `isError/refetch`; show partial/error state rather than empty.
- Tests: offline draft listing rejection shows retry/error, not zero/empty.
- Confidence: medium-high.

### CXR2-PERF01 [new perf] medication-sets workspace loads all SetPlans per case to keep latest per case

- Severity: medium-high, reachability medium.
- Evidence: `src/app/api/medication-sets/workspace/route.ts:75`, `:111`, `:122`, `:284`; `src/lib/dispensing/set-workspace-shared.ts:1`.
- Reproduction: route gets schedule case IDs, loads all SetPlans with batches/audits/change_logs, then keeps only newest per case.
- Impact: same load-all-use-newest pattern as N23, with potentially large nested payloads. Current FE reachability appears lower.
- Fix direction: DB latest-per-case selection before loading nested details; preserve `created_at DESC` latest rule.
- Tests: multiple plans per case response matches current latest-per-case output and does not hydrate non-latest details.
- Confidence: medium-high.

### CXR2-TZ01 [new date correctness] operational-policy audit month count uses server-local month

- Severity: medium auditability.
- Evidence: `src/app/api/settings/operational-policy/route.ts:68-92`; `prisma/schema/admin.prisma:163-176`.
- Reproduction: `AuditLog.created_at` instant is filtered by server-local month start.
- Impact: operational policy change count shifts at JST month boundary.
- Fix direction: use `japanMonthInstantRange`.
- Tests: policy update at JST month edge.
- Confidence: high.

### CXR2-TZ02 [new date correctness] monthly jobs use server-local months for instant columns

- Severity: medium billing/ops/audit correctness.
- Evidence: `src/server/jobs/monthly.ts:37-43`, `:144-151`, `:176-180`, `:202-213`; instant columns `visit_date`, `prescribed_date`, `conference_date`.
- Reproduction: monthly reports/metrics use `startOfMonth/endOfMonth` server-local for instant data.
- Impact: boundary records can be missed or included in the wrong month.
- Fix direction: `japanMonthInstantRange`, preferably half-open upper bounds.
- Tests: monthly job fixtures around JST month start/end.
- Confidence: high.

## Security consistency notes

- F80/F86/F87 are confirmed live issues and are not explained by the RLS cluster. `ExternalAccessGrant` and `WebhookRegistration` already have RLS in `prisma/rls-policies.sql`; the bugs are authz/no-store/API contract issues.
- External public token/self-report paths looked hardened in the reviewed angles: token + OTP from header, no-store on success/error, token-path rate limiting and redaction present.
- Conference-note participant suggestions are not the same class as F87: they verify note/facility match, omit phone/email, and use no-store.

## Non-actions

- No implementation was performed.
- No test/build command was run.
- No DB write, migration, or destructive command was run.
