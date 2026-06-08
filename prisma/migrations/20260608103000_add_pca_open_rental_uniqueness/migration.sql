-- Ensure each PCA pump has at most one operationally open rental per organization.
CREATE UNIQUE INDEX "PcaPumpRental_one_open_per_pump_idx"
  ON "PcaPumpRental"("org_id", "pump_id")
  WHERE "status" IN ('scheduled', 'active', 'overdue');
