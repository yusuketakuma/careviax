ALTER TABLE "DrugMaster"
  ADD COLUMN "is_high_risk" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_lasa_risk" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tall_man_name" TEXT,
  ADD COLUMN "lasa_group_key" TEXT;

CREATE INDEX "DrugMaster_is_high_risk_idx" ON "DrugMaster"("is_high_risk");
CREATE INDEX "DrugMaster_is_lasa_risk_idx" ON "DrugMaster"("is_lasa_risk");
CREATE INDEX "DrugMaster_lasa_group_key_idx" ON "DrugMaster"("lasa_group_key");
