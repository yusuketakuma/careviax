-- Expand-only v0.2 billing alignment:
-- keep scheduled payment date queryable without rewriting invoice snapshots.
ALTER TABLE "PharmacyInvoice"
  ADD COLUMN "payment_scheduled_for" DATE;

CREATE INDEX "PharmacyInvoice_org_id_payment_scheduled_for_idx"
  ON "PharmacyInvoice"("org_id", "payment_scheduled_for");
