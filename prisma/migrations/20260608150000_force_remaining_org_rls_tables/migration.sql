-- Keep migration-built databases aligned with the RLS SSOT for org-scoped
-- clinical/workflow tables added outside the original baseline.

ALTER TABLE "PatientLabObservation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientLabObservation";
CREATE POLICY tenant_isolation ON "PatientLabObservation"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "PatientLabObservation" FORCE ROW LEVEL SECURITY;

ALTER TABLE "QrScanDraft" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "QrScanDraft";
DROP POLICY IF EXISTS "qr_scan_draft_org_isolation" ON "QrScanDraft";
CREATE POLICY tenant_isolation ON "QrScanDraft"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "QrScanDraft" FORCE ROW LEVEL SECURITY;

ALTER TABLE "WebhookRegistration" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WebhookRegistration";
CREATE POLICY tenant_isolation ON "WebhookRegistration"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "WebhookRegistration" FORCE ROW LEVEL SECURITY;

ALTER TABLE "SetBatchChangeLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SetBatchChangeLog";
CREATE POLICY tenant_isolation ON "SetBatchChangeLog"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "SetBatchChangeLog" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitScheduleProposal" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleProposal";
CREATE POLICY tenant_isolation ON "VisitScheduleProposal"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "VisitScheduleProposal" FORCE ROW LEVEL SECURITY;
