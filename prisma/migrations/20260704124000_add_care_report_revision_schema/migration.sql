-- W3-B6a Slice 1: CareReport finalize/lock schema foundation.
-- Additive only: no finalize endpoint, no amendment/void runtime path, and no
-- existing report content/status mutation in this migration.

CREATE TABLE "CareReportRevision" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "revision_no" INTEGER NOT NULL,
  "content_snapshot" JSONB NOT NULL,
  "content_hash" TEXT NOT NULL,
  "pdf_hash" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "amend_reason" TEXT,
  "supersedes_revision_no" INTEGER,

  CONSTRAINT "CareReportRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CareReport"
  ADD COLUMN "finalized_at" TIMESTAMP(3),
  ADD COLUMN "finalized_by" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "locked_by" TEXT,
  ADD COLUMN "report_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "content_hash" TEXT,
  ADD COLUMN "pdf_hash" TEXT,
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "voided_by" TEXT,
  ADD COLUMN "void_reason" TEXT,
  ADD COLUMN "unlocked_at" TIMESTAMP(3),
  ADD COLUMN "unlocked_by" TEXT,
  ADD COLUMN "unlock_reason" TEXT,
  ADD COLUMN "finalized_pharmacist_credential_id" TEXT,
  ADD COLUMN "finalized_credential_type" TEXT,
  ADD COLUMN "finalized_credential_number" TEXT,
  ADD COLUMN "finalized_credential_role_snapshot" TEXT,
  ADD COLUMN "finalized_credential_checked_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "CareReportRevision_org_id_display_id_key"
  ON "CareReportRevision"("org_id", "display_id");
CREATE UNIQUE INDEX "CareReportRevision_id_org_id_key"
  ON "CareReportRevision"("id", "org_id");
CREATE UNIQUE INDEX "CareReportRevision_org_report_revision_no_key"
  ON "CareReportRevision"("org_id", "report_id", "revision_no");
CREATE UNIQUE INDEX "CareReportRevision_org_report_content_hash_key"
  ON "CareReportRevision"("org_id", "report_id", "content_hash");
CREATE INDEX "CareReportRevision_org_id_report_id_idx"
  ON "CareReportRevision"("org_id", "report_id");

CREATE UNIQUE INDEX "PharmacistCredential_id_org_id_key"
  ON "PharmacistCredential"("id", "org_id");
CREATE INDEX "CareReport_org_finalized_credential_idx"
  ON "CareReport"("org_id", "finalized_pharmacist_credential_id");

ALTER TABLE "CareReportRevision"
  ADD CONSTRAINT "CareReportRevision_report_id_org_id_fkey"
  FOREIGN KEY ("report_id", "org_id") REFERENCES "CareReport"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareReport"
  ADD CONSTRAINT "CareReport_finalized_credential_org_id_fkey"
  FOREIGN KEY ("finalized_pharmacist_credential_id", "org_id")
  REFERENCES "PharmacistCredential"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareReportRevision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareReportRevision"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "CareReportRevision" FORCE ROW LEVEL SECURITY;
