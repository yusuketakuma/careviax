-- Expand PrescriptionLine with nullable medication identity/provenance fields.
-- Existing rows stay NULL; resolver-backed dual-write and backfill are separate app/data phases.
ALTER TABLE "PrescriptionLine"
  ADD COLUMN "drug_master_id" TEXT,
  ADD COLUMN "source_drug_code" TEXT,
  ADD COLUMN "source_drug_code_type" TEXT,
  ADD COLUMN "drug_resolution_status" TEXT;

ALTER TABLE "PrescriptionLine"
  ADD CONSTRAINT "PrescriptionLine_drug_master_id_fkey"
  FOREIGN KEY ("drug_master_id") REFERENCES "DrugMaster"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PrescriptionLine_drug_master_id_idx"
  ON "PrescriptionLine"("drug_master_id");

CREATE INDEX "PrescriptionLine_org_id_drug_master_id_idx"
  ON "PrescriptionLine"("org_id", "drug_master_id");

CREATE INDEX "PrescriptionLine_org_id_drug_resolution_status_idx"
  ON "PrescriptionLine"("org_id", "drug_resolution_status");
