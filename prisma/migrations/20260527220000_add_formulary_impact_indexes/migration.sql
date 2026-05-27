-- Add indexes used by adopted-drug impact review counts and queues.
CREATE INDEX "DrugMaster_is_narcotic_idx"
  ON "DrugMaster"("is_narcotic");

CREATE INDEX "DrugMaster_is_psychotropic_idx"
  ON "DrugMaster"("is_psychotropic");

CREATE INDEX "DrugMaster_transitional_expiry_date_idx"
  ON "DrugMaster"("transitional_expiry_date");

CREATE INDEX "PharmacyDrugStock_impact_review_due_idx"
  ON "PharmacyDrugStock"("org_id", "site_id", "is_stocked", "last_reviewed_at");

CREATE INDEX "PharmacyDrugStock_impact_reorder_idx"
  ON "PharmacyDrugStock"("org_id", "site_id", "is_stocked", "reorder_point");

CREATE INDEX "PharmacyDrugStock_impact_follow_up_idx"
  ON "PharmacyDrugStock"("org_id", "site_id", "is_stocked", "follow_up_status");
