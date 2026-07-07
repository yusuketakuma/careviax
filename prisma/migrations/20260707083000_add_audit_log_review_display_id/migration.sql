-- Add nullable tenant-local display IDs for AuditLogReview.
-- Existing rows are not backfilled in this additive migration.

ALTER TABLE "AuditLogReview" ADD COLUMN "display_id" TEXT;

CREATE UNIQUE INDEX "AuditLogReview_org_id_display_id_key"
  ON "AuditLogReview"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;
