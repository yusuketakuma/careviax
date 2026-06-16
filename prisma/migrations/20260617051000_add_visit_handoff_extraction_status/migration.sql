CREATE TABLE "VisitHandoffExtraction" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "visit_record_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "source_visit_record_version" INTEGER NOT NULL,
    "source_visit_record_updated_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMP(3),
    "last_succeeded_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitHandoffExtraction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitHandoffExtraction_visit_record_id_key"
ON "VisitHandoffExtraction"("visit_record_id");

CREATE UNIQUE INDEX "VisitHandoffExtraction_schedule_id_key"
ON "VisitHandoffExtraction"("schedule_id");

CREATE INDEX "VisitHandoffExtraction_org_id_idx"
ON "VisitHandoffExtraction"("org_id");

CREATE INDEX "VisitHandoffExtraction_status_idx"
ON "VisitHandoffExtraction"("status");

ALTER TABLE "VisitHandoffExtraction"
ADD CONSTRAINT "VisitHandoffExtraction_visit_record_id_fkey"
FOREIGN KEY ("visit_record_id") REFERENCES "VisitRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitHandoffExtraction"
ADD CONSTRAINT "VisitHandoffExtraction_schedule_id_fkey"
FOREIGN KEY ("schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitHandoffExtraction" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "VisitHandoffExtraction";
CREATE POLICY tenant_isolation ON "VisitHandoffExtraction"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

ALTER TABLE "VisitHandoffExtraction" FORCE ROW LEVEL SECURITY;
