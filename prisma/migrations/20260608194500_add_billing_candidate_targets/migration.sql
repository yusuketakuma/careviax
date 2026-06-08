ALTER TABLE "BillingCandidate"
  ADD COLUMN "billing_domain" TEXT NOT NULL DEFAULT 'home_care',
  ADD COLUMN "billing_target_type" TEXT NOT NULL DEFAULT 'patient',
  ADD COLUMN "billing_target_id" TEXT,
  ADD COLUMN "billing_target_name" TEXT;

UPDATE "BillingCandidate"
SET
  "billing_target_type" = 'patient',
  "billing_target_id" = "patient_id"
WHERE "billing_target_id" IS NULL;

ALTER TABLE "BillingCandidate"
  ALTER COLUMN "patient_id" DROP NOT NULL;

CREATE INDEX "BillingCandidate_org_id_billing_domain_billing_month_idx"
  ON "BillingCandidate"("org_id", "billing_domain", "billing_month");

CREATE INDEX "BillingCandidate_org_id_billing_target_type_billing_target_id_idx"
  ON "BillingCandidate"("org_id", "billing_target_type", "billing_target_id");
