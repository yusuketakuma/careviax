-- Attach workflow exceptions to patients for direct patient-scoped queue queries.
ALTER TABLE "WorkflowException" ADD COLUMN "patient_id" TEXT;

UPDATE "WorkflowException" AS "we"
SET "patient_id" = "cc"."patient_id"
FROM "MedicationCycle" AS "mc"
JOIN "CareCase" AS "cc" ON "cc"."id" = "mc"."case_id"
WHERE "we"."cycle_id" = "mc"."id"
  AND "we"."patient_id" IS NULL;

CREATE INDEX "WorkflowException_patient_id_idx" ON "WorkflowException"("patient_id");

ALTER TABLE "WorkflowException"
  ADD CONSTRAINT "WorkflowException_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "Patient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Persist the human-readable RX number for new prescription intakes.
ALTER TABLE "PrescriptionIntake" ADD COLUMN "rx_number" TEXT;
CREATE UNIQUE INDEX "PrescriptionIntake_org_id_rx_number_key"
  ON "PrescriptionIntake"("org_id", "rx_number");

-- Tenant-specific drug alert rules. NULL org_id keeps existing global baseline rules.
ALTER TABLE "DrugAlertRule" ADD COLUMN "org_id" TEXT;

CREATE INDEX "DrugAlertRule_org_id_idx" ON "DrugAlertRule"("org_id");

ALTER TABLE "DrugAlertRule"
  ADD CONSTRAINT "DrugAlertRule_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- First-class file metadata table. Existing Setting JSON records remain as fallback.
CREATE TABLE "FileAsset" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "patient_id" TEXT,
  "visit_record_id" TEXT,
  "report_id" TEXT,
  "job_id" TEXT,
  "uploaded_by" TEXT,
  "etag" TEXT,
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "download_disposition" TEXT NOT NULL DEFAULT 'inline',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileAsset_storage_key_key" ON "FileAsset"("storage_key");
CREATE INDEX "FileAsset_org_id_idx" ON "FileAsset"("org_id");
CREATE INDEX "FileAsset_org_id_purpose_idx" ON "FileAsset"("org_id", "purpose");
CREATE INDEX "FileAsset_org_id_status_idx" ON "FileAsset"("org_id", "status");
CREATE INDEX "FileAsset_org_id_job_id_idx" ON "FileAsset"("org_id", "job_id");
CREATE INDEX "FileAsset_expires_at_idx" ON "FileAsset"("expires_at");

ALTER TABLE "FileAsset"
  ADD CONSTRAINT "FileAsset_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FileAsset" (
  "id",
  "org_id",
  "purpose",
  "storage_key",
  "original_name",
  "mime_type",
  "size_bytes",
  "status",
  "patient_id",
  "visit_record_id",
  "report_id",
  "job_id",
  "uploaded_by",
  "etag",
  "completed_at",
  "expires_at",
  "download_disposition",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT
  value->>'id',
  value->>'orgId',
  value->>'purpose',
  value->>'storageKey',
  value->>'originalName',
  value->>'mimeType',
  COALESCE(NULLIF(value->>'sizeBytes', '')::integer, 0),
  value->>'status',
  NULLIF(value->>'patientId', ''),
  NULLIF(value->>'visitRecordId', ''),
  NULLIF(value->>'reportId', ''),
  NULLIF(value->>'jobId', ''),
  NULLIF(value->>'uploadedBy', ''),
  NULLIF(value->>'etag', ''),
  NULLIF(value->>'completedAt', '')::timestamp(3),
  NULLIF(value->>'expiresAt', '')::timestamp(3),
  COALESCE(NULLIF(value->>'downloadDisposition', ''), 'inline'),
  jsonb_build_object('source', 'setting_backfill'),
  COALESCE(NULLIF(value->>'createdAt', '')::timestamp(3), CURRENT_TIMESTAMP),
  COALESCE(NULLIF(value->>'updatedAt', '')::timestamp(3), CURRENT_TIMESTAMP)
FROM "Setting"
WHERE "scope" = 'organization'
  AND "key" LIKE 'file_asset:%'
  AND jsonb_typeof("value") = 'object'
  AND value->>'version' = '1'
  AND value->>'id' IS NOT NULL
  AND value->>'orgId' IS NOT NULL
  AND value->>'purpose' IS NOT NULL
  AND value->>'storageKey' IS NOT NULL
  AND value->>'originalName' IS NOT NULL
  AND value->>'mimeType' IS NOT NULL
  AND value->>'status' IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
