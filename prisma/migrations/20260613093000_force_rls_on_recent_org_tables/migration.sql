-- Complete RLS enforcement for recent org-scoped operational tables.

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
