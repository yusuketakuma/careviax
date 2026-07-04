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

ALTER TABLE "PatientLabObservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientLabObservation"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

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

ALTER TABLE "VisitHandoffExtraction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitHandoffExtraction";
CREATE POLICY tenant_isolation ON "VisitHandoffExtraction"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitHandoffExtraction" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitInstruction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitInstruction";
CREATE POLICY tenant_isolation ON "VisitInstruction"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitInstruction" FORCE ROW LEVEL SECURITY;

ALTER TABLE "SpecialPatientStatus" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SpecialPatientStatus";
CREATE POLICY tenant_isolation ON "SpecialPatientStatus"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "SpecialPatientStatus" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitVehicleResource" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitVehicleResource";
CREATE POLICY tenant_isolation ON "VisitVehicleResource"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitVehicleResource" FORCE ROW LEVEL SECURITY;

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

ALTER TABLE "CareReportSendRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareReportSendRequest"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

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

ALTER TABLE "PharmacyOperatingHours" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyOperatingHours";
CREATE POLICY tenant_isolation ON "PharmacyOperatingHours"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

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

ALTER TABLE "IncidentReport" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IncidentReport";
CREATE POLICY tenant_isolation ON "IncidentReport"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "IncidentReport" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DrugAlertRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DrugAlertRule";
CREATE POLICY tenant_isolation ON "DrugAlertRule"
  USING (org_id IS NULL OR org_id = public.app_enforced_org_id())
  WITH CHECK (org_id IS NULL OR org_id = public.app_enforced_org_id());
ALTER TABLE "DrugAlertRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FileAsset" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FileAsset";
CREATE POLICY tenant_isolation ON "FileAsset"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FileAsset" FORCE ROW LEVEL SECURITY;

ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WebhookDelivery";
CREATE POLICY tenant_isolation ON "WebhookDelivery"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;

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

ALTER TABLE "VisitScheduleProposalBatch" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleProposalBatch";
CREATE POLICY tenant_isolation ON "VisitScheduleProposalBatch"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

-- ─── Drug Domain (org-scoped and hybrid tables) ────────────────────────────
-- Note: DrugMaster, DrugPackage, DrugPackageInsert, DrugInteraction,
-- GenericDrugMapping, DrugMasterImportLog are global (no org_id) = NO RLS.
-- DrugAlertRule is hybrid: org_id NULL stores global baseline rules, while
-- org-specific rows are protected by the RLS policy above.

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

ALTER TABLE "PcaPumpRentalAccessory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPumpRentalAccessory";
CREATE POLICY tenant_isolation ON "PcaPumpRentalAccessory"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

ALTER TABLE "PcaPumpMaintenanceEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPumpMaintenanceEvent";
CREATE POLICY tenant_isolation ON "PcaPumpMaintenanceEvent"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

ALTER TABLE "WebhookRegistration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookRegistration"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- =============================================================================
-- W1-7: tenant tables that previously had NO DB-layer RLS backstop
-- (docs/security/rls-gap-ledger.md §1a). ENABLE + FORCE + fail-close policy.
-- Design-review tables (PrescriberInstitution, User) intentionally excluded.
-- =============================================================================

-- PHI (最重大).
ALTER TABLE "PatientPackagingProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientPackagingProfile";
CREATE POLICY tenant_isolation ON "PatientPackagingProfile"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PatientPackagingProfile" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitScheduleContactLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleContactLog";
CREATE POLICY tenant_isolation ON "VisitScheduleContactLog"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitScheduleContactLog" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitScheduleOverride" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleOverride";
CREATE POLICY tenant_isolation ON "VisitScheduleOverride"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitScheduleOverride" FORCE ROW LEVEL SECURITY;

ALTER TABLE "BillingRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BillingRule";
CREATE POLICY tenant_isolation ON "BillingRule"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "BillingRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "BusinessHoliday" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BusinessHoliday";
CREATE POLICY tenant_isolation ON "BusinessHoliday"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "BusinessHoliday" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FacilityUnit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FacilityUnit";
CREATE POLICY tenant_isolation ON "FacilityUnit"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FacilityUnit" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FormularyChangeRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FormularyChangeRequest";
CREATE POLICY tenant_isolation ON "FormularyChangeRequest"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FormularyChangeRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FormularyTemplate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FormularyTemplate";
CREATE POLICY tenant_isolation ON "FormularyTemplate"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FormularyTemplate" FORCE ROW LEVEL SECURITY;

ALTER TABLE "NotificationRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationRule";
CREATE POLICY tenant_isolation ON "NotificationRule"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "NotificationRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PackagingMethodMaster" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PackagingMethodMaster";
CREATE POLICY tenant_isolation ON "PackagingMethodMaster"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PackagingMethodMaster" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacySiteInsuranceConfig" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacySiteInsuranceConfig";
CREATE POLICY tenant_isolation ON "PharmacySiteInsuranceConfig"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PharmacySiteInsuranceConfig" FORCE ROW LEVEL SECURITY;

-- ─── IntegrationJob — skip RLS for safety (org_id nullable, system jobs) ──────
-- org_id is nullable and the job runner (src/server/jobs/runner.ts) creates/updates
-- rows via the BASE prisma client OUTSIDE withOrgContext. The /api/jobs admin path
-- supplies a non-NULL org_id (refreshMedicalInstitutionMaster/refreshCareServiceOfficeMaster
-- with targetOrgIds:[ctx.orgId] → runJob(..., orgId)), so a fail-close FORCE-RLS policy
-- would RAISE 'RLS context missing' on that INSERT and 500 the master-refresh endpoint
-- under any RLS-enforcing (non-superuser) prod role. System jobs must remain accessible
-- regardless of context, so RLS is intentionally skipped until the runner is reworked to
-- run org-scoped writes inside withOrgContext. Tracked in src/tools/rls-known-gaps.ts.

-- ─── id_sequence / IdSequence — intentional RLS exclusion (internal counter) ──
-- id_sequence stores only per-scope display_id counters: org_id, prefix, next_value,
-- updated_at. It contains no PHI or secret material. Global master imports allocate
-- through the explicit '__global__' sentinel outside withOrgContext, while tenant
-- allocations are limited by allocateDisplayId* helper signatures and tests.
-- Adding fail-close FORCE RLS would break those global imports and is intentionally
-- skipped by design. Direct prisma.idSequence access and raw id_sequence writes outside
-- the allocator are forbidden by src/lib/db/display-id.test.ts.

-- =============================================================================
-- W1-7: SSOT drift sync — tables ENABLE+FORCE+POLICY via migration but missing
-- from this file (docs/security/rls-gap-ledger.md §1b). Statements below mirror
-- the FINAL applied migration policy for each table (last migration wins).
-- =============================================================================

-- JahisSupplementalRecord (PHI) — custom policy name, USING-only, soft context
-- (matches 20260421090000_jahis_supplemental_records).
ALTER TABLE "JahisSupplementalRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jahis_supplemental_record_org_isolation" ON "JahisSupplementalRecord";
CREATE POLICY "jahis_supplemental_record_org_isolation" ON "JahisSupplementalRecord"
  USING (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "JahisSupplementalRecord" FORCE ROW LEVEL SECURITY;

-- PatientCondition (PHI) — fail-close (matches 20260329022000_add_patient_conditions_table).
ALTER TABLE "PatientCondition" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientCondition";
CREATE POLICY tenant_isolation ON "PatientCondition"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PatientCondition" FORCE ROW LEVEL SECURITY;

-- Facility / FacilityContact / ExternalProfessional — final state is fail-close after
-- 20260328234500_rls_context_failsafe re-created their policies with app_enforced_org_id().
ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Facility";
CREATE POLICY tenant_isolation ON "Facility"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FacilityContact" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FacilityContact";
CREATE POLICY tenant_isolation ON "FacilityContact"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FacilityContact" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ExternalProfessional" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExternalProfessional";
CREATE POLICY tenant_isolation ON "ExternalProfessional"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "ExternalProfessional" FORCE ROW LEVEL SECURITY;

-- PharmacyCooperationMessage / Thread — fail-close
-- (matches 20260619223000_add_pharmacy_cooperation_message_threads).
ALTER TABLE "PharmacyCooperationMessageThread" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyCooperationMessageThread";
CREATE POLICY tenant_isolation ON "PharmacyCooperationMessageThread"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PharmacyCooperationMessageThread" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyCooperationMessage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyCooperationMessage";
CREATE POLICY tenant_isolation ON "PharmacyCooperationMessage"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PharmacyCooperationMessage" FORCE ROW LEVEL SECURITY;

-- SavedView — fail-close (matches 20260614120000_wave2_design_fidelity_contract).
ALTER TABLE "SavedView" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SavedView";
CREATE POLICY tenant_isolation ON "SavedView"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "SavedView" FORCE ROW LEVEL SECURITY;

-- UatFeedback — USING-only, hard current_setting (no `true` arg → THROWS on missing
-- context; matches 20260328234500_add_uat_feedback).
ALTER TABLE "UatFeedback" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UatFeedback";
CREATE POLICY tenant_isolation ON "UatFeedback"
  USING (org_id = current_setting('app.current_org_id'));
ALTER TABLE "UatFeedback" FORCE ROW LEVEL SECURITY;

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
ALTER TABLE "PatientLabObservation" FORCE ROW LEVEL SECURITY;
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
ALTER TABLE "VisitHandoffExtraction" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitInstruction" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SpecialPatientStatus" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationResponse" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareReport" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareReportSendRequest" FORCE ROW LEVEL SECURITY;
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
ALTER TABLE "PharmacyOperatingHours" FORCE ROW LEVEL SECURITY;
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
ALTER TABLE "VisitScheduleProposalBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PcaPump" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PcaPumpRental" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PcaPumpRentalAccessory" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PcaPumpMaintenanceEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WebhookRegistration" FORCE ROW LEVEL SECURITY;

-- ─── PatientFieldRevision (患者項目 業務差分履歴 層b/層c) ─────────────────────
ALTER TABLE "PatientFieldRevision" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientFieldRevision";
CREATE POLICY tenant_isolation ON "PatientFieldRevision"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientFieldRevision" FORCE ROW LEVEL SECURITY;

-- ─── PatientMedicalProcedure / PatientNarcoticUse (在宅医療処置/麻薬 構造化) ──
ALTER TABLE "PatientMedicalProcedure" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientMedicalProcedure";
CREATE POLICY tenant_isolation ON "PatientMedicalProcedure"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientMedicalProcedure" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientNarcoticUse" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientNarcoticUse";
CREATE POLICY tenant_isolation ON "PatientNarcoticUse"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientNarcoticUse" FORCE ROW LEVEL SECURITY;

-- ─── PackagingGroup / CycleHold (調剤ワークベンチ P0) ─────────────────────────
ALTER TABLE "PackagingGroup" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PackagingGroup";
CREATE POLICY tenant_isolation ON "PackagingGroup"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PackagingGroup" FORCE ROW LEVEL SECURITY;

ALTER TABLE "CycleHold" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CycleHold";
CREATE POLICY tenant_isolation ON "CycleHold"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "CycleHold" FORCE ROW LEVEL SECURITY;

-- ─── Pharmacy Partnership / Patient Share Foundation ───────────────────────
ALTER TABLE "PartnerPharmacy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PartnerPharmacy";
CREATE POLICY tenant_isolation ON "PartnerPharmacy"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PartnerPharmacy" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyPartnership" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyPartnership";
CREATE POLICY tenant_isolation ON "PharmacyPartnership"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyPartnership" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientShareCase" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientShareCase";
CREATE POLICY tenant_isolation ON "PatientShareCase"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientShareCase" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientShareConsent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientShareConsent";
CREATE POLICY tenant_isolation ON "PatientShareConsent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientShareConsent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientLink" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientLink";
CREATE POLICY tenant_isolation ON "PatientLink"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientLink" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientShareCorrectionRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientShareCorrectionRequest";
CREATE POLICY tenant_isolation ON "PatientShareCorrectionRequest"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientShareCorrectionRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyVisitRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyVisitRequest";
CREATE POLICY tenant_isolation ON "PharmacyVisitRequest"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyVisitRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PartnerVisitRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PartnerVisitRecord";
CREATE POLICY tenant_isolation ON "PartnerVisitRecord"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PartnerVisitRecord" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClaimCooperationNote" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClaimCooperationNote";
CREATE POLICY tenant_isolation ON "ClaimCooperationNote"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClaimCooperationNote" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyContract" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyContract";
CREATE POLICY tenant_isolation ON "PharmacyContract"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyContract" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyContractVersion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyContractVersion";
CREATE POLICY tenant_isolation ON "PharmacyContractVersion"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyContractVersion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyContractFeeRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyContractFeeRule";
CREATE POLICY tenant_isolation ON "PharmacyContractFeeRule"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyContractFeeRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitBillingCandidate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitBillingCandidate";
CREATE POLICY tenant_isolation ON "VisitBillingCandidate"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "VisitBillingCandidate" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyInvoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyInvoice";
CREATE POLICY tenant_isolation ON "PharmacyInvoice"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyInvoice" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyInvoiceItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyInvoiceItem";
CREATE POLICY tenant_isolation ON "PharmacyInvoiceItem"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyInvoiceItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ContractDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ContractDocument";
CREATE POLICY tenant_isolation ON "ContractDocument"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ContractDocument" FORCE ROW LEVEL SECURITY;
