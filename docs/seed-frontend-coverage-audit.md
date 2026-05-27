# Seed / Frontend Coverage Audit

## Conclusion

- Seed data is **not** arbitrarily editable from existing system screens.
- Existing screens can edit or display only a subset of the backend graph.
- `prisma/seed.ts` now seeds **all 76 Prisma models** on a fresh verification database.
- Fresh-db verification found **0 public tables with 0 rows** after `pnpm prisma db seed`.
- `/admin/data-explorer` was added as a cross-model admin surface, so all seeded models now have at least one frontend display/update path for internal verification.
- To avoid omissions, coverage is tracked against:
  - Prisma model presence
  - API route presence
  - frontend page/component presence

## Coverage Summary

### Inventory baseline used for the audit

- Prisma models: `76`
- App Router pages: `69`
- `src/app/api` files: `338`

### Seed verification status

- Verification DB: `ph-os_seed_check`
- Migration on empty DB: passed with `pnpm prisma migrate deploy`
- Seed on empty DB: passed with `pnpm prisma db seed`
- Public tables checked: `76`
- Tables with `count(*) = 0`: `0`

### What this means for editability

- Current system screens do **not** provide arbitrary CRUD over all seeded data.
- Practical editability today is concentrated in operational surfaces such as patients, facilities, selected admin masters, reports, and task-oriented flows.
- Many seeded models are workflow support, system configuration, audit, derived, or integration records. They are intentionally backend-heavy and are not exposed as first-class editable UI resources.
- To close the verification gap without forcing 76 dedicated screens, `/admin/data-explorer` now provides a generic internal page to inspect and patch seeded rows across all models.

### Remediation status

- Dedicated, domain-specific screen parity is still partial and the classification below remains useful for product UX work.
- However, the previous audit gap of “no clear frontend page-level display/update surface” is no longer a blocker for internal seed verification, because `/admin/data-explorer` now covers all models generically.

### Frontend pages and API routes both exist

- `BillingRule`
- `Notification`
- `AuditLog`
- `Template`
- `Setting`
- `DrugMaster`
- `Task`
- `Facility`
- `ExternalProfessional`
- `PharmacistCredential`
- `Patient`
- `ManagementPlan`
- `VisitRecord`

### Frontend pages/components exist, but direct model-to-route coverage is partial or indirect

- `BillingCandidate`
- `PatientCondition`
- `ConsentRecord`
- `PrescriptionIntake`
- `SetPlan`
- `SetAudit`

### API exists, but no clear frontend page-level editing/display surface was found

- `NotificationRule`
- `BillingEvidence`
- `CommunicationEvent`
- `CommunicationRequest`
- `CareReport`
- `ConferenceNote`
- `EscalationRule`
- `TracingReport`
- `PatientSelfReport`
- `CommunityActivity`
- `UatFeedback`
- `PharmacyDrugStock`
- `DrugMasterImportLog`
- `MedicationProfile`
- `ResidualMedication`
- `MedicationIssue`
- `PharmacySite`
- `PharmacistShift`
- `PharmacistShiftTemplate`
- `BusinessHoliday`
- `MedicationCycle`
- `InquiryRecord`
- `DispenseTask`
- `DispenseResult`
- `DispenseAudit`
- `SetBatch`
- `WorkflowException`
- `VisitSchedule`
- `FacilityVisitBatch`
- `VisitPreparation`
- `VisitScheduleProposal`

### Backend-only models with no clear route/page coverage found

- `IntegrationJob`
- `LabelDictionary`
- `SourceOfTruthMatrix`
- `CommunicationResponse`
- `DeliveryRecord`
- `ExternalAccessGrant`
- `DrugPackageInsert`
- `DrugInteraction`
- `DrugAlertRule`
- `GenericDrugMapping`
- `Intervention`
- `FirstVisitDocument`
- `Organization`
- `FacilityContact`
- `User`
- `Membership`
- `FacilityStandardRegistration`
- `PatientPackagingProfile`
- `Residence`
- `CareCase`
- `ContactParty`
- `CareTeamLink`
- `PatientSchedulePreference`
- `PrescriptionLine`
- `VisitScheduleContactLog`
- `VisitScheduleOverride`

## Implication For Seed Data

- Seeding only `Patient` rows is insufficient.
- The seed now covers all backend persistent models so backend validation can run against a complete representative graph.
- This does **not** imply frontend parity. Seed completeness and UI exposure are separate concerns.
- Some models are operational or derived and should not be assumed editable from UI even if seeded.

## Current Safe Direction

- Keep canonical local auth data stable:
  - `1 org`
  - `1 site`
  - `1 demo user`
- Expand seed density under that canonical scope first.
- Treat frontend coverage expansion as a separate phase from seed expansion, because many backend models require workflow-consistent relation graphs rather than arbitrary standalone forms.

## Verification Commands Used

- `pnpm exec eslint prisma/seed.ts`
- `pnpm exec tsc --noEmit`
- `DATABASE_URL='postgresql://ph-os:ph-os@localhost:5433/ph-os_seed_check?schema=public' DIRECT_URL='postgresql://ph-os:ph-os@localhost:5433/ph-os_seed_check?schema=public' pnpm prisma migrate deploy`
- `DATABASE_URL='postgresql://ph-os:ph-os@localhost:5433/ph-os_seed_check?schema=public' DIRECT_URL='postgresql://ph-os:ph-os@localhost:5433/ph-os_seed_check?schema=public' pnpm prisma db seed`
- `docker exec ph-os-db sh -lc "psql -U ph-os -d ph-os_seed_check -At <<'SQL' ... \\gexec SQL"`
