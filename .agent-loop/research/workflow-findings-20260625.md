# Workflow Backend Audit — Confirmed Findings (2026-06-25)

Source: ultracode Workflow w4hljwto2 — 150 raw → 33 confirmed (adversarially verified), 49 false-positives killed, 60 dropped at cap.

Buckets: GATED_ESCALATE = §15 (billing/算定・schema migration・RLS cross-org job) → human approval (BLOCKED.md). CODEX_ROUTES = api/\* non-gated → codex. CLAUDE_FIXABLE = services/lib non-gated → claude maker/checker slices.

## §15 GATED — escalate, do NOT auto-fix (14)

- **P1** `prisma/schema/visit.prisma:306-310` [data-integrity] — VisitScheduleProposal.finalized_schedule_id has @unique without org_id; composite FK with Cascade can cause data loss
  - fix: Change to @@unique([org_id, finalized_schedule_id]) to ensure uniqueness per org. Change FK to composite [finalized_schedule_id, org_id] if VisitSchedule schema supports [id, org_id] unique constraint
- **P1** `src/app/api/billing-candidates/close/route.ts:49-68` [data-integrity] — transmitClaimsExportForClose does not check billing_domain matches candidateIds
  - fix: Add assertion that returned candidates.length > 0 after fetch, or validate candidateIds domain before transmit: const domainMismatch = candidateIds.some(id => !returnedIds.has(id)); if (domainMismatch
- **P1** `src/lib/dispensing/set-derivations.ts:47-51` [data-integrity] — Day count calculation uses Math.round which rounds 0.5 days ambiguously causing off-by-one
  - fix: Use Math.floor(...) + 1 to match diffInclusiveDays logic at line 214 for consistent inclusive day range calculation.
- **P1** `src/server/jobs/daily-prescription-original-retention.ts:32-58` [data-integrity] — RLS violation: checkPrescriptionOriginalRetention reads intakes and fax originals across all orgs
  - fix: Add org_id filter to both findMany queries or iterate per org.
- **P1** `src/server/jobs/daily/billing.ts:8-12` [data-integrity] — billingEvidence.findMany() missing org_id filter in daily job
  - fix: Add org_id filter: where: { org_id: visitRecord.org_id } before select, or run findMany inside withOrgContext transaction. Currently relies on visitRecord filtering downstream, but the intermediate ex
- **P1** `src/server/jobs/daily/conferences.ts:19-30` [data-integrity] — RLS bypass: checkConferenceMeetingReminders reads all conference notes without org_id
  - fix: Add org_id filter or iterate per org with withOrgContext.
- **P1** `src/server/jobs/daily/followups.ts:56-69` [data-integrity] — RLS bypass: checkCallbackFollowups reads contact logs across all orgs
  - fix: Add org_id filter or process per org.
- **P1** `src/server/jobs/daily/followups.ts:99-122` [data-integrity] — RLS bypass: checkResidenceGeocodeQuality reads residences across all orgs
  - fix: Add org_id filter in where clause.
- **P1** `src/server/jobs/daily/followups.ts:153-166` [data-integrity] — RLS bypass: checkSelfReportFollowups reads patient reports across all orgs
  - fix: Add org_id filter or iterate per org.
- **P1** `src/server/services/billing-evidence/core.ts:1657, 1662-1672` [data-integrity] — singleBuilding logic uses buildingPatientCount (monthly count) but should check per-visit tier
  - fix: singleBuilding should be derived from residence.building_id presence and actual occupancy at visit date, not from monthly aggregated buildingPatientCount. This requires fetching concurrent residents a
- **P2** `src/app/api/billing-evidence/check/route.ts:136-141` [data-integrity] — rejectionCount filters by contains '返戻' without billing_month constraint
  - fix: Add billing_month: monthStart to the where clause on line 138, or document the intentional cross-month scope and adjust UI label to clarify this is cumulative.
- **P2** `src/server/jobs/daily/cleanup.ts:10-16` [data-integrity] — RLS bypass: cleanupAbandonedQrDrafts lacks org_id filter
  - fix: Add org_id filter in where clause or iterate per org with withOrgContext. Same for cleanupTerminalQrDraftPayloads.
- **P2** `src/server/jobs/daily/compliance-expiry.ts:28-35` [data-integrity] — RLS bypass: checkFacilityStandardExpiry reads all orgs without org_id filter
  - fix: Add org_id in where clause or iterate per org. Same issue in checkCredentialExpiry (line 99-106) and checkConsentExpiry.
- **P2** `src/server/services/billing-evidence/core.ts:309-310` [data-integrity] — isClaimableOutcome excludes delivery_only but monthly/weekly counts include it
  - fix: Either: (1) Add 'delivery_only' to isClaimableOutcome if it should be counted toward cadence, or (2) Remove 'delivery_only' from the outcome_status filters on lines 1251, 1266, 495, 515 if it should n

## codex-routes — hand to codex (9)

- **P1** `src/app/api/visit-schedules/day-board/route.ts:543-548` [data-integrity] — Proposal query missing upper bound on proposed_date filters future proposals indefinitely
  - fix: Change line 547 from `proposed_date: { gte: dayStart }` to `proposed_date: { gte: dayStart, lt: dayEnd }` to constrain proposals to today only, consistent with day-board design (docs/design-gap-analys
- **P2** `src/app/api/admin/organizations/route.ts:83-85` [security] — Organization provisioning requires owner role but should enforce admin permission first
  - fix: Keep the role check as defense-in-depth, but ensure withAuthContext(canAdmin) is the primary guard. Consider documenting that owner role is the only role with canAdmin permission to make invariant exp
- **P2** `src/app/api/care-reports/route.ts:806-817` [security] — careReport.create does not validate that resolved case exists and belongs to org
  - fix: After validateCareReportSource returns a caseId, re-check in the transaction that the case still exists and belongs to org before calling create(). Or rely on the database foreign key constraint to ca
- **P2** `src/app/api/management-plans/[id]/route.ts:44-48` [security] — Missing explicit org_id check in GET response - relies solely on RLS
  - fix: This is actually correct as written. No fix needed - the org_id is properly checked in findFirst. Mark as false positive if org_id exposure in response is acceptable.
- **P2** `src/app/api/prescription-intakes/route.ts:282-286` [bug] — QR draft line mismatch check skips requestValue=null comparison — false negatives on optional fields
  - fix: Check both directions: (comparison.draftValue != null) XOR (normalizedLineComparableValue(comparison.requestValue) !== normalizedLineComparableValue(comparison.draftValue))
- **P2** `src/app/api/visit-schedules/day-board/route.ts:633-634, 760` [data-integrity] — @db.Time fields serialized as ISO 8601 full timestamps instead of time-only strings
  - fix: Use timeDateToString() helper (from @/lib/visits/time-of-day) or extract HH:MM manually: `schedule.time_window_start ? timeDateToString(schedule.time_window_start) : null` to serialize as '09:00' form
- **P2** `src/app/api/visit-schedules/day-board/route.ts:43` [perf] — WORKDAY_MINUTES constant hardcoded as 9 hours (540 min) — inflexible, assumes fixed shift
  - fix: Replace hardcoded constant with dynamic lookup: fetch pharmacist's PharmacistShift.available_from/available_to for the proposed_date, compute actual work minutes, then subtract occupied time. Fallback
- **P2** `src/app/api/visit-schedules/day-board/route.ts:639-641` [data-integrity] — facility_label fallback assumes single unknown facility — will collide if multiple unmapped batches exist
  - fix: Return a disambiguated label: `facilityNameById.get(schedule.facility_batch.facility_id) ?? `施設(${schedule.facility_batch_id?.slice(0,4)})` to make each batch distinct, or log a warning if facility_id
- **P2** `src/app/api/visits/today-preparation/route.ts:550-568` [perf] — auditQueue query fetches 10 dispense tasks unconditionally, but only uses first 1 item
  - fix: Reduce take: 10 to take: 1 if only the single highest-priority item is needed. If multiple items needed for future display, document why and justify. Current code suggests take: 1 would suffice.

## claude services/lib — fixable slices (10)

- **P1** `src/server/services/prescription-intake-service.ts:1281` [data-integrity] — medicationProfile.update missing org_id in WHERE clause — potential cross-tenant update
  - fix: Add org_id to WHERE clause: where: { id: existing.id, org_id: orgId }
- **P2** `src/app/api/handoff-board/items/route.ts:100-106` [data-integrity] — Handoff recipient_user_id validation missing is_active check
  - fix: Add is_active: true to the findFirst where clause: where: { id: parsed.data.recipient_user_id, org_id: ctx.orgId, is_active: true }
- **P2** `src/lib/dispensing/dispense-workbench-shared.ts:395-401` [bug] — inferGroupMethod always defaults to unit_dose regardless of input
  - fix: Return 'none' when rows is empty. Only default to unit_dose if explicit methods exist or unit_dose tag is present in at least one row.
- **P2** `src/server/services/patient-detail-documents.ts:613-620` [data-integrity] — Audit log history truncation loses incomplete data
  - fix: Increase limit or fetch all logs per document; add explicit cap with warning, or aggregate state separately.
- **P2** `src/server/services/patient-detail-workspace.ts:182-184` [perf] — batchResolveNames called for transition_logs even if fetch fails upstream
  - fix: Match timeline's explicit fail-soft pattern; wrap in try-catch and log separately.
- **P2** `src/server/services/prescription-intake-service.ts:1325` [data-integrity] — medicationProfile.updateMany missing org_id in WHERE — cross-tenant discontinue risk
  - fix: Add org_id filter: where: { id: { in: idsToDiscontinue }, org_id: orgId }
- **P2** `src/server/services/prescription-intake-service.ts:1266-1270` [bug] — start_date defaults to current moment when not provided — loses original medication start intent
  - fix: Change default: startDate should be line.start_date || args.prescribedDate (passed from intake) or null, not new Date()
- **P2** `src/server/services/prescription-intake-service.ts:1265` [bug] — medicationProfile match logic uses first matching key — can misidentify profile across multiple keyed entries
  - fix: Prefer drug_master_id > drug_code > drug_name priority, or use more strict matching logic with all keys
- **P3** `src/lib/dispensing/dispense-workbench-shared.ts:485` [perf] — Using Number.EPSILON for dosage comparison is incorrect; should use fixed precision
  - fix: Replace with dose step-aware comparison: const tolerance = 0.01; needsCheck = Math.abs(perDose - rounded) > tolerance;
- **P3** `src/server/services/patient-detail-foundation.ts:410-427` [perf] — patientInsurance.findMany lacks explicit ordering guarantee for consistency
  - fix: Add tiebreaker: `orderBy: [{ insurance_type: 'asc' }, { valid_until: 'asc' }, { id: 'asc' }]`

## Triage updates (post-handoff)

- **FALSE POSITIVE** `src/app/api/visits/today-preparation/route.ts:550-568` (P2 perf, "auditQueue fetches 10 use 1"): codex due-diligence found the take:10 feeds a post-fetch filter (latest audit null/hold) + narcotic-first re-sort before next_action[0]. take:1 would hide a valid 2nd candidate or lose narcotic priority. Workflow missed the intervening filter/resort. Closed as FP, no edit.
- **SKIPPED (§15-adjacent / domain judgment)** `src/lib/dispensing/dispense-workbench-shared.ts:395-401` (P2 inferGroupMethod): fallback unit_dose + the preceding unit_dose branch are redundant, but changing the fallback to 'none' is a 在宅 一包化-default domain decision (算定-adjacent). Not auto-fixed; left for domain confirmation.
- **NEEDS RAW SQL (deferred slice)**: per-group top-N bounding that Prisma cannot do bounded (distinct is in-memory) — patient-status-tracker auditLog latest-per-patient, and patient-detail-documents.ts:613-620 (global take:30 mis-distributes per-document history). Both need a ROW_NUMBER() PARTITION BY window query (cf. codex staff-workload pattern).

## Resolution status (2026-06-25 dual-maker loop)

### Fixed by claude (maker/checker + objective gates, committed)

- `084945d1` patient-status-tracker visit membership: unbounded visitSchedule.findMany×3 → careCase `some` (EXISTS).
- `0cd03fff` prescription-intake syncMedicationProfiles: per-line create → createMany.
- `369fdc2a` prescription-intake update/updateMany: +org_id (cross-tenant write, confirmed P1+P2).
- `501f267f` patient-detail-documents history: global take:30 → ROW_NUMBER() per-document top-5 window (confirmed P2 correctness, raw-SQL-class).
- `932cbf82` patient-status-tracker previousStatusLogs: unbounded auditLog.findMany → ROW_NUMBER() per-patient top-5 window (deferred from 084945d1, raw-SQL-class; malformed-skip preserved).

### Fixed by codex (claude reviewed/APPROVED, committed)

- `7a69f082` job-logging PHI sanitize. `7ee09743` staff-workload N+1→window query (claude caught a NULLS-order regression → fixed). `f8ea9e49` day-board proposal date upper bound. + prescription-intakes QR null-mismatch (APPROVED).

### Closed as FALSE POSITIVE / SKIP

- today-preparation take:10→1 (FP: take:10 feeds filter+narcotic-resort). inferGroupMethod (skip: §15-adjacent 一包化 domain default). management-plans/[id] GET (verifier self-flagged likely-FP, codex confirming).

### Escalated to BLOCKED.md (§15, human approval)

- cross-org RLS daily jobs ×8; billing/算定 correctness; schema migration (finalized_schedule_id composite unique); set-derivations day-count rounding.

### Remaining minor (non-§15, low ROI — open backlog)

- patient-detail-workspace:182-184 batchResolveNames fail-soft (P2; needs log-not-swallow care). patient-detail-foundation:410-427 ordering tiebreaker (P3). dispense-workbench-shared:485 Number.EPSILON (P3). handoff-board route is_active (P2, codex/routes).
