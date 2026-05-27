-- Add formulary review and import provenance fields.
ALTER TABLE "PharmacyDrugStock"
  ADD COLUMN "adoption_source" TEXT,
  ADD COLUMN "adoption_note" TEXT,
  ADD COLUMN "last_reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" TEXT;

CREATE INDEX "PharmacyDrugStock_org_id_site_id_is_stocked_idx"
  ON "PharmacyDrugStock"("org_id", "site_id", "is_stocked");

CREATE INDEX "PharmacyDrugStock_last_reviewed_at_idx"
  ON "PharmacyDrugStock"("last_reviewed_at");
