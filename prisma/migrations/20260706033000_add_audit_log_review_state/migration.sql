CREATE TABLE "AuditLogReview" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "audit_log_id" TEXT NOT NULL,
  "review_state" TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "reason_code" TEXT,
  "reason_note" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLogReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditLog_id_org_id_key" ON "AuditLog"("id", "org_id");
CREATE UNIQUE INDEX "AuditLogReview_org_id_audit_log_id_key" ON "AuditLogReview"("org_id", "audit_log_id");
CREATE INDEX "AuditLogReview_org_review_updated_idx" ON "AuditLogReview"("org_id", "review_state", "updated_at");
CREATE INDEX "AuditLogReview_audit_log_id_idx" ON "AuditLogReview"("audit_log_id");

ALTER TABLE "AuditLogReview"
  ADD CONSTRAINT "AuditLogReview_audit_log_id_fkey"
  FOREIGN KEY ("audit_log_id", "org_id") REFERENCES "AuditLog"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLogReview" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLogReview";
CREATE POLICY tenant_isolation ON "AuditLogReview"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "AuditLogReview" FORCE ROW LEVEL SECURITY;
