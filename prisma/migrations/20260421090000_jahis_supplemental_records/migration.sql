-- CreateTable
CREATE TABLE "JahisSupplementalRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT,
    "qr_draft_id" TEXT,
    "prescription_intake_id" TEXT,
    "record_type" TEXT NOT NULL,
    "record_label" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "raw_line" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JahisSupplementalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JahisSupplementalRecord_org_id_idx" ON "JahisSupplementalRecord"("org_id");
CREATE INDEX "JahisSupplementalRecord_patient_id_idx" ON "JahisSupplementalRecord"("patient_id");
CREATE INDEX "JahisSupplementalRecord_qr_draft_id_idx" ON "JahisSupplementalRecord"("qr_draft_id");
CREATE INDEX "JahisSupplementalRecord_prescription_intake_id_idx" ON "JahisSupplementalRecord"("prescription_intake_id");
CREATE INDEX "JahisSupplementalRecord_record_type_idx" ON "JahisSupplementalRecord"("record_type");

-- AddForeignKey
ALTER TABLE "JahisSupplementalRecord"
  ADD CONSTRAINT "JahisSupplementalRecord_qr_draft_id_fkey"
  FOREIGN KEY ("qr_draft_id") REFERENCES "QrScanDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JahisSupplementalRecord"
  ADD CONSTRAINT "JahisSupplementalRecord_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JahisSupplementalRecord"
  ADD CONSTRAINT "JahisSupplementalRecord_prescription_intake_id_fkey"
  FOREIGN KEY ("prescription_intake_id") REFERENCES "PrescriptionIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS Policy
ALTER TABLE "JahisSupplementalRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jahis_supplemental_record_org_isolation" ON "JahisSupplementalRecord"
  USING (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "JahisSupplementalRecord" FORCE ROW LEVEL SECURITY;
