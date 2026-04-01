ALTER TABLE "UatFeedback"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN "owner_user_id" TEXT,
ADD COLUMN "linked_work_item" TEXT,
ADD COLUMN "due_date" TIMESTAMP(3),
ADD COLUMN "resolved_at" TIMESTAMP(3);

CREATE INDEX "UatFeedback_status_idx" ON "UatFeedback"("status");
CREATE INDEX "UatFeedback_owner_user_id_idx" ON "UatFeedback"("owner_user_id");
CREATE INDEX "UatFeedback_due_date_idx" ON "UatFeedback"("due_date");
