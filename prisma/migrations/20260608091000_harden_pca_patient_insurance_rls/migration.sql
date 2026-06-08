-- Harden RLS for patient insurance and PCA pump rental data.
-- PatientInsurance was created before app_enforced_org_id() became the SSOT.
DROP POLICY IF EXISTS tenant_isolation ON "PatientInsurance";
CREATE POLICY tenant_isolation ON "PatientInsurance"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PatientInsurance" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PcaPump" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPump";
CREATE POLICY tenant_isolation ON "PcaPump"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PcaPump" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PcaPumpRental" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPumpRental";
CREATE POLICY tenant_isolation ON "PcaPumpRental"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PcaPumpRental" FORCE ROW LEVEL SECURITY;
