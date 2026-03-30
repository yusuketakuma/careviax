CREATE TABLE "UatFeedback" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "submitted_by" TEXT,
    "priority" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "checklist_progress" TEXT,
    "checked_items" JSONB,
    "source" TEXT NOT NULL DEFAULT 'pilot_pharmacy',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UatFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UatFeedback_org_id_idx" ON "UatFeedback"("org_id");
CREATE INDEX "UatFeedback_priority_idx" ON "UatFeedback"("priority");

ALTER TABLE "UatFeedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UatFeedback"
  USING ("org_id" = current_setting('app.current_org_id'));
ALTER TABLE "UatFeedback" FORCE ROW LEVEL SECURITY;
