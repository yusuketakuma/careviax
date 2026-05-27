-- Track operational follow-up state for adopted drugs affected by master changes.
ALTER TABLE "PharmacyDrugStock"
  ADD COLUMN "follow_up_status" TEXT,
  ADD COLUMN "follow_up_reason" TEXT,
  ADD COLUMN "follow_up_due_date" TIMESTAMP(3),
  ADD COLUMN "follow_up_resolved_at" TIMESTAMP(3);

CREATE INDEX "PharmacyDrugStock_follow_up_status_idx"
  ON "PharmacyDrugStock"("follow_up_status");
