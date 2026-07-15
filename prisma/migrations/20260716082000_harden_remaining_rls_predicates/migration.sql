-- Complete the fail-visible RLS predicate migration for tenant tables that were
-- created after the original app_enforced_org_id() hardening pass.
DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'JahisSupplementalRecord',
    'PatientLabObservation',
    'QrScanDraft',
    'SetBatchChangeLog',
    'UatFeedback',
    'VisitScheduleProposal',
    'WebhookRegistration'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'Required RLS table is missing: %', target_table;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = public.app_enforced_org_id()) WITH CHECK (org_id = public.app_enforced_org_id())',
      target_table
    );
  END LOOP;
END;
$$;
