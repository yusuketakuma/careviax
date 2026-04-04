-- Add reject_reason_code to DispenseAudit for structured rejection tracking
ALTER TABLE "DispenseAudit" ADD COLUMN "reject_reason_code" TEXT;

-- Index for rejection reason aggregation queries
CREATE INDEX "DispenseAudit_org_id_reject_reason_code_idx" ON "DispenseAudit"("org_id", "reject_reason_code");
