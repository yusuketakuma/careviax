CREATE TYPE "SelfReportStatus" AS ENUM (
    'submitted',
    'triaged',
    'converted_to_task',
    'resolved',
    'dismissed'
);

CREATE TABLE "PatientSelfReport" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "external_access_grant_id" TEXT,
    "reported_by_name" TEXT NOT NULL,
    "relation" TEXT,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "requested_callback" BOOLEAN NOT NULL DEFAULT false,
    "preferred_contact_time" TEXT,
    "status" "SelfReportStatus" NOT NULL DEFAULT 'submitted',
    "triaged_by" TEXT,
    "triaged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientSelfReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientSelfReport_org_id_idx" ON "PatientSelfReport"("org_id");
CREATE INDEX "PatientSelfReport_patient_id_idx" ON "PatientSelfReport"("patient_id");
CREATE INDEX "PatientSelfReport_status_idx" ON "PatientSelfReport"("status");

ALTER TABLE "PatientSelfReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientSelfReport"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientSelfReport" FORCE ROW LEVEL SECURITY;

CREATE TABLE "CommunityActivity" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "partner_name" TEXT,
    "activity_date" TIMESTAMP(3) NOT NULL,
    "target_population" TEXT,
    "attendee_count" INTEGER,
    "referrals_generated" INTEGER,
    "follow_up_required" BOOLEAN NOT NULL DEFAULT false,
    "outcome_summary" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityActivity_org_id_idx" ON "CommunityActivity"("org_id");
CREATE INDEX "CommunityActivity_activity_type_idx" ON "CommunityActivity"("activity_type");
CREATE INDEX "CommunityActivity_activity_date_idx" ON "CommunityActivity"("activity_date");

ALTER TABLE "CommunityActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunityActivity"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "CommunityActivity" FORCE ROW LEVEL SECURITY;
