-- Expand-only canonical drug identity for residual medications.
-- No existing ResidualMedication rows are mutated by this migration.
ALTER TABLE "ResidualMedication"
  ADD COLUMN "drug_master_id" TEXT;

CREATE INDEX "ResidualMedication_drug_master_id_idx"
  ON "ResidualMedication"("drug_master_id");

CREATE INDEX "ResidualMedication_org_id_drug_master_id_idx"
  ON "ResidualMedication"("org_id", "drug_master_id");

ALTER TABLE "ResidualMedication"
  ADD CONSTRAINT "ResidualMedication_drug_master_id_fkey"
  FOREIGN KEY ("drug_master_id") REFERENCES "DrugMaster"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
