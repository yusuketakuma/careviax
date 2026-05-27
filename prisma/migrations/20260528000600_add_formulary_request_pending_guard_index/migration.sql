-- Support duplicate pending-request checks for same org/site/drug.
CREATE INDEX "FormularyChangeRequest_pending_guard_idx"
  ON "FormularyChangeRequest"("org_id", "site_id", "drug_master_id", "status");
