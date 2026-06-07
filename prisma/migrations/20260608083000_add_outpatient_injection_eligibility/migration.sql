ALTER TABLE "DrugMaster"
  ADD COLUMN "outpatient_injection_eligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "outpatient_injection_note" TEXT;

CREATE INDEX "DrugMaster_outpatient_injection_eligible_idx"
  ON "DrugMaster"("outpatient_injection_eligible");
