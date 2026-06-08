-- =============================================================================
-- PH-OS: Row Level Security (RLS) Policies
-- Purpose: Tenant isolation by org_id for all multi-tenant tables
-- Usage: Run via psql or as a Prisma migration after schema creation
-- Prerequisite: Application connects with role 'app_user' (not superuser)
-- =============================================================================

-- Create application role if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- Grant usage to app_user on public schema
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- =============================================================================
-- Helper: Enable RLS + create tenant isolation policy for a table
-- Policy uses current_setting('app.current_org_id', true) which is set per
-- transaction via SET LOCAL in withOrgContext (src/lib/db/rls.ts)
-- =============================================================================

-- ─── Patient Domain ─────────────────────────────────────────────────────────

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Patient"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Residence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Residence"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CareCase" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareCase"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ContactParty" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ContactParty"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CareTeamLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareTeamLink"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ManagementPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ManagementPlan"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PatientSchedulePreference" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientSchedulePreference"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PatientInsurance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientInsurance";
CREATE POLICY tenant_isolation ON "PatientInsurance"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

-- ─── Prescription / Workflow Domain ─────────────────────────────────────────

ALTER TABLE "MedicationCycle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationCycle"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PrescriptionIntake" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PrescriptionIntake"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PrescriptionLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PrescriptionLine"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "InquiryRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InquiryRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispenseTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispenseTask"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispenseResult" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispenseResult"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispenseAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispenseAudit"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispensingDecision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispensingDecision"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetPlan"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetBatch"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetAudit"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "WorkflowException" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkflowException"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Visit Domain ───────────────────────────────────────────────────────────

ALTER TABLE "VisitSchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitSchedule"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "FacilityVisitBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FacilityVisitBatch"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "VisitRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "VisitPreparation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitPreparation"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Communication Domain ───────────────────────────────────────────────────

ALTER TABLE "CommunicationEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunicationEvent"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CommunicationRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunicationRequest"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CommunicationResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunicationResponse"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CareReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareReport"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DeliveryRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeliveryRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ConferenceNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConferenceNote"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "EscalationRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EscalationRule"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ExternalAccessGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExternalAccessGrant"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PatientSelfReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientSelfReport"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CommunityActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunityActivity"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "TracingReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TracingReport"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "TaskComment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaskComment"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "HandoffBoard" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HandoffBoard"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "HandoffItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HandoffItem"
  USING (
    EXISTS (
      SELECT 1
      FROM "HandoffBoard"
      WHERE "HandoffBoard"."id" = "HandoffItem"."board_id"
        AND "HandoffBoard"."org_id" = current_setting('app.current_org_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "HandoffBoard"
      WHERE "HandoffBoard"."id" = "HandoffItem"."board_id"
        AND "HandoffBoard"."org_id" = current_setting('app.current_org_id', true)
    )
  );

-- ─── Medication Domain ──────────────────────────────────────────────────────

ALTER TABLE "MedicationProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationProfile"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ResidualMedication" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ResidualMedication"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "MedicationIssue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationIssue"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Intervention" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Intervention"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "FirstVisitDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FirstVisitDocument"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Organization Domain ────────────────────────────────────────────────────

ALTER TABLE "PharmacySite" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacySite"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "FacilityStandardRegistration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FacilityStandardRegistration"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PharmacistCredential" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacistCredential"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PharmacistShift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacistShift"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PharmacistShiftTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacistShiftTemplate"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Admin Domain ───────────────────────────────────────────────────────────

ALTER TABLE "BillingCandidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingCandidate"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "BillingEvidence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingEvidence"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Template"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DocumentDeliveryRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentDeliveryRule"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PushSubscription"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SourceOfTruthMatrix" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SourceOfTruthMatrix"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Patient MCS Domain ────────────────────────────────────────────────────

ALTER TABLE "PatientMcsLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMcsLink"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PatientMcsSummary" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMcsSummary"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PatientMcsMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMcsMessage"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Prescription / Workflow Domain (additional) ───────────────────────────

ALTER TABLE "CycleTransitionLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CycleTransitionLog"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetBatchChangeLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetBatchChangeLog"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "QrScanDraft" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "QrScanDraft"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Visit Domain (additional) ─────────────────────────────────────────────

ALTER TABLE "VisitScheduleProposal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitScheduleProposal"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Drug Domain (org-scoped only) ─────────────────────────────────────────
-- Note: DrugMaster, DrugPackageInsert, DrugInteraction, DrugAlertRule,
-- GenericDrugMapping, DrugMasterImportLog are global (no org_id) = NO RLS

ALTER TABLE "PharmacyDrugStock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacyDrugStock"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ServiceArea" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceArea"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── PCA Pump Rental Domain ─────────────────────────────────────────────────

ALTER TABLE "PcaPump" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPump";
CREATE POLICY tenant_isolation ON "PcaPump"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

ALTER TABLE "PcaPumpRental" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPumpRental";
CREATE POLICY tenant_isolation ON "PcaPumpRental"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

-- ─── IntegrationJob (org_id is nullable) ────────────────────────────────────
-- IntegrationJob.org_id is String? (nullable) — skip RLS for safety
-- Jobs with null org_id are system-level and should be accessible regardless

-- ─── LabelDictionary (no org_id) ────────────────────────────────────────────
-- Global dictionary, no RLS needed

-- =============================================================================
-- Force RLS for app_user role (bypass for superuser/migration role)
-- =============================================================================
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Residence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareCase" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ContactParty" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareTeamLink" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ManagementPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PatientSchedulePreference" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PatientInsurance" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MedicationCycle" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PrescriptionIntake" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PrescriptionLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InquiryRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispenseTask" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispenseResult" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispenseAudit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispensingDecision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetAudit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowException" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitSchedule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FacilityVisitBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitPreparation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationResponse" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareReport" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConferenceNote" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EscalationRule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ExternalAccessGrant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TracingReport" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TaskComment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "HandoffBoard" FORCE ROW LEVEL SECURITY;
ALTER TABLE "HandoffItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MedicationProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ResidualMedication" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MedicationIssue" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Intervention" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FirstVisitDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacySite" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FacilityStandardRegistration" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacistCredential" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacistShift" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacistShiftTemplate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BillingCandidate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BillingEvidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Template" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentDeliveryRule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SourceOfTruthMatrix" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacyDrugStock" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ServiceArea" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PatientMcsLink" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PatientMcsSummary" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PatientMcsMessage" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CycleTransitionLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetBatchChangeLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "QrScanDraft" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitScheduleProposal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PcaPump" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PcaPumpRental" FORCE ROW LEVEL SECURITY;
