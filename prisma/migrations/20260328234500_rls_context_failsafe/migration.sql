CREATE OR REPLACE FUNCTION public.app_enforced_org_id()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  applied TEXT;
  org_id TEXT;
BEGIN
  applied := current_setting('app.rls_context_applied', true);
  IF applied IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'RLS context missing';
  END IF;

  org_id := current_setting('app.current_org_id', true);
  IF org_id IS NULL OR org_id = '' THEN
    RAISE EXCEPTION 'RLS org context missing';
  END IF;

  RETURN org_id;
END;
$$;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'Patient',
    'Residence',
    'CareCase',
    'ContactParty',
    'Facility',
    'FacilityContact',
    'ExternalProfessional',
    'CareTeamLink',
    'ConsentRecord',
    'ManagementPlan',
    'PatientSchedulePreference',
    'MedicationCycle',
    'PrescriptionIntake',
    'PrescriptionLine',
    'InquiryRecord',
    'DispenseTask',
    'DispenseResult',
    'DispenseAudit',
    'SetPlan',
    'SetBatch',
    'SetAudit',
    'WorkflowException',
    'VisitSchedule',
    'FacilityVisitBatch',
    'VisitRecord',
    'VisitPreparation',
    'CommunicationEvent',
    'CommunicationRequest',
    'CommunicationResponse',
    'CareReport',
    'DeliveryRecord',
    'ConferenceNote',
    'EscalationRule',
    'ExternalAccessGrant',
    'PatientSelfReport',
    'CommunityActivity',
    'TracingReport',
    'MedicationProfile',
    'PatientMcsLink',
    'PatientMcsMessage',
    'ResidualMedication',
    'MedicationIssue',
    'Intervention',
    'Task',
    'FirstVisitDocument',
    'PharmacySite',
    'Membership',
    'FacilityStandardRegistration',
    'PharmacistCredential',
    'PharmacistShift',
    'PharmacistShiftTemplate',
    'BillingCandidate',
    'BillingEvidence',
    'Notification',
    'AuditLog',
    'Template',
    'Setting',
    'SourceOfTruthMatrix',
    'PharmacyDrugStock'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE table_schema = 'public'
        AND c.table_name = target_table
        AND column_name = 'org_id'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = public.app_enforced_org_id()) WITH CHECK (org_id = public.app_enforced_org_id())',
      target_table
    );
  END LOOP;
END;
$$;
