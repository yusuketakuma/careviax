ALTER TABLE "BillingCandidate"
  ADD COLUMN IF NOT EXISTS "calculation_breakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "rule_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_snapshot" JSONB;

ALTER TABLE "BillingEvidence"
  ADD COLUMN IF NOT EXISTS "applied_rule_keys" JSONB,
  ADD COLUMN IF NOT EXISTS "billing_service_type" TEXT,
  ADD COLUMN IF NOT EXISTS "building_patient_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "calculation_context" JSONB,
  ADD COLUMN IF NOT EXISTS "provider_scope" TEXT,
  ADD COLUMN IF NOT EXISTS "recommended_rule_keys" JSONB,
  ADD COLUMN IF NOT EXISTS "weekly_count_snapshot" INTEGER;

ALTER TABLE "BillingRule"
  ADD COLUMN IF NOT EXISTS "billing_scope" TEXT NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS "calculation_unit" TEXT NOT NULL DEFAULT 'point',
  ADD COLUMN IF NOT EXISTS "display_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "effective_from" DATE,
  ADD COLUMN IF NOT EXISTS "effective_to" DATE,
  ADD COLUMN IF NOT EXISTS "evidence_requirements" JSONB,
  ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "payer_basis" "PayerBasis",
  ADD COLUMN IF NOT EXISTS "provider_scope" TEXT,
  ADD COLUMN IF NOT EXISTS "selection_mode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "service_type" TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS "source_note" TEXT,
  ADD COLUMN IF NOT EXISTS "source_url" TEXT,
  ADD COLUMN IF NOT EXISTS "ssot_key" TEXT;

ALTER TABLE "ContactParty"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "department" TEXT,
  ADD COLUMN IF NOT EXISTS "is_primary" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "BillingRule_billing_scope_idx" ON "BillingRule"("billing_scope");
CREATE INDEX IF NOT EXISTS "BillingRule_service_type_idx" ON "BillingRule"("service_type");
CREATE UNIQUE INDEX IF NOT EXISTS "BillingRule_org_id_ssot_key_key" ON "BillingRule"("org_id", "ssot_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PatientCondition_patient_id_fkey'
  ) THEN
    ALTER TABLE "PatientCondition"
      ADD CONSTRAINT "PatientCondition_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "Patient"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END;
$$;
