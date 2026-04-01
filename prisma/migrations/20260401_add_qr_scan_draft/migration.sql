-- AlterEnum
ALTER TYPE "PrescriptionSourceType" ADD VALUE 'qr_scan';

-- CreateEnum
CREATE TYPE "QrDraftStatus" AS ENUM ('pending', 'confirmed', 'discarded');

-- CreateTable
CREATE TABLE "QrScanDraft" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "patient_id" TEXT,
    "scanned_by" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "status" "QrDraftStatus" NOT NULL DEFAULT 'pending',
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "raw_qr_texts" JSONB NOT NULL,
    "parsed_data" JSONB NOT NULL,
    "parse_errors" JSONB,
    "auto_completed" JSONB,
    "expected_qr_count" INTEGER,
    "confirmed_intake_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QrScanDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QrScanDraft_org_id_idx" ON "QrScanDraft"("org_id");
CREATE INDEX "QrScanDraft_org_id_status_idx" ON "QrScanDraft"("org_id", "status");
CREATE INDEX "QrScanDraft_session_id_idx" ON "QrScanDraft"("session_id");
CREATE INDEX "QrScanDraft_patient_id_idx" ON "QrScanDraft"("patient_id");

-- RLS Policy
ALTER TABLE "QrScanDraft" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qr_scan_draft_org_isolation" ON "QrScanDraft"
  USING (org_id = current_setting('app.current_org_id', true));
