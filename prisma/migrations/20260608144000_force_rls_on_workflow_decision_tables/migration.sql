-- The schema drift migration materialized these workflow tables; make their
-- tenant isolation explicit in the migration path as well as the RLS SSOT.

ALTER TABLE "CycleTransitionLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CycleTransitionLog";
CREATE POLICY tenant_isolation ON "CycleTransitionLog"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "CycleTransitionLog" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DispensingDecision" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DispensingDecision";
CREATE POLICY tenant_isolation ON "DispensingDecision"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "DispensingDecision" FORCE ROW LEVEL SECURITY;
