-- 12_handoff (design/images/new): responsibility-transfer model for HandoffItem.
-- Additive nullable columns only — legacy rows / API consumers keep working.
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "recipient_user_id" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "recipient_label" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "lifecycle_status" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "scope" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "rationale" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMP(3);
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "progress_done" INTEGER;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "progress_total" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HandoffItem_recipient_user_id_idx" ON "HandoffItem"("recipient_user_id");
