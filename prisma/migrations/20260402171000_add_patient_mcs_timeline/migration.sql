-- CreateTable
CREATE TABLE "PatientMcsLink" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "mcs_patient_id" TEXT,
    "mcs_patient_url" TEXT,
    "mcs_project_id" TEXT,
    "mcs_project_url" TEXT,
    "project_title" TEXT,
    "project_memo" TEXT,
    "member_count" INTEGER,
    "last_sync_attempt_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_error" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientMcsLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientMcsMessage" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "source_message_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_role" TEXT,
    "author_organization" TEXT,
    "author_descriptor" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_at_label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reaction_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER,
    "source_url" TEXT NOT NULL,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientMcsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientMcsLink_patient_id_key" ON "PatientMcsLink"("patient_id");

-- CreateIndex
CREATE INDEX "PatientMcsLink_org_id_idx" ON "PatientMcsLink"("org_id");

-- CreateIndex
CREATE INDEX "PatientMcsLink_patient_id_idx" ON "PatientMcsLink"("patient_id");

-- CreateIndex
CREATE INDEX "PatientMcsLink_mcs_project_id_idx" ON "PatientMcsLink"("mcs_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "PatientMcsMessage_link_id_source_message_id_key" ON "PatientMcsMessage"("link_id", "source_message_id");

-- CreateIndex
CREATE INDEX "PatientMcsMessage_org_id_idx" ON "PatientMcsMessage"("org_id");

-- CreateIndex
CREATE INDEX "PatientMcsMessage_patient_id_posted_at_idx" ON "PatientMcsMessage"("patient_id", "posted_at");

-- CreateIndex
CREATE INDEX "PatientMcsMessage_source_message_id_idx" ON "PatientMcsMessage"("source_message_id");

-- AddForeignKey
ALTER TABLE "PatientMcsLink" ADD CONSTRAINT "PatientMcsLink_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMcsMessage" ADD CONSTRAINT "PatientMcsMessage_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMcsMessage" ADD CONSTRAINT "PatientMcsMessage_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "PatientMcsLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS Policy
ALTER TABLE "PatientMcsLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMcsLink"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientMcsLink" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientMcsMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMcsMessage"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientMcsMessage" FORCE ROW LEVEL SECURITY;
