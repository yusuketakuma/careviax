-- Medication Stock Ledger DB foundation.
-- This migration adds append-only stock events, read-optimized snapshots, and
-- external-observation review rows without storing inbound raw text.

CREATE TYPE "MedicationStockSourceType" AS ENUM (
  'prescription',
  'initial_leftover',
  'other_institution',
  'otc',
  'manual',
  'unknown'
);

CREATE TYPE "MedicationStockCategory" AS ENUM (
  'prn',
  'topical',
  'external',
  'regular_leftover',
  'otc',
  'other',
  'unknown'
);

CREATE TYPE "MedicationStockUnit" AS ENUM (
  'tablet',
  'capsule',
  'packet',
  'sheet',
  'patch',
  'tube',
  'bottle',
  'ml',
  'g',
  'dose',
  'application',
  'other'
);

CREATE TYPE "MedicationStockManagingParty" AS ENUM (
  'patient',
  'family',
  'facility',
  'pharmacy',
  'unknown'
);

CREATE TYPE "MedicationStockEventType" AS ENUM (
  'prescription_supply',
  'visit_observation',
  'external_observation_apply',
  'patient_report',
  'manual_adjustment',
  'disposal',
  'transfer_in',
  'transfer_out',
  'usage_frequency_update',
  'equivalence_merge',
  'correction',
  'no_stock_observed'
);

CREATE TYPE "MedicationStockQuantityKind" AS ENUM (
  'delta',
  'observed_absolute',
  'usage_rate',
  'no_quantity'
);

CREATE TYPE "MedicationStockSourceEntityType" AS ENUM (
  'prescription_line',
  'visit_record',
  'inbound_signal',
  'external_observation',
  'patient_self_report',
  'manual',
  'unknown'
);

CREATE TYPE "MedicationStockUsageConfidence" AS ENUM (
  'high',
  'medium',
  'low',
  'unknown'
);

CREATE TYPE "MedicationStockRiskLevel" AS ENUM (
  'ok',
  'watch',
  'shortage_expected',
  'urgent',
  'unknown'
);

CREATE TYPE "MedicationStockEquivalenceReviewStatus" AS ENUM (
  'not_required',
  'needs_review',
  'reviewed',
  'uncertain'
);

CREATE TYPE "MedicationStockEquivalenceConfidence" AS ENUM (
  'exact_code',
  'ingredient_strength_form',
  'ingredient_only',
  'manual',
  'uncertain'
);

CREATE TYPE "ExternalMedicationStockObservationKind" AS ENUM (
  'remaining_quantity',
  'patient_held_stock',
  'prn_usage_report',
  'topical_remaining_report',
  'no_stock_observed',
  'unknown'
);

CREATE TYPE "MedicationStockSourceConfidence" AS ENUM (
  'structured_exact',
  'structured_partial',
  'text_parsed_high',
  'text_parsed_low',
  'manual',
  'unknown'
);

CREATE TYPE "ExternalMedicationStockObservationReviewState" AS ENUM (
  'pending_pharmacist_review',
  'applied',
  'rejected',
  'held',
  'superseded'
);

CREATE TABLE "PatientMedicationStockItem" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "drug_master_id" TEXT,
  "drug_package_id" TEXT,
  "canonical_medication_group_id" TEXT,
  "source_type" "MedicationStockSourceType" NOT NULL DEFAULT 'unknown',
  "medication_category" "MedicationStockCategory" NOT NULL DEFAULT 'unknown',
  "display_name" TEXT NOT NULL,
  "normalized_name" TEXT,
  "ingredient_name" TEXT,
  "strength" TEXT,
  "dosage_form" TEXT,
  "route" TEXT,
  "unit" "MedicationStockUnit" NOT NULL,
  "default_usage_amount_per_day" DECIMAL(12,4),
  "default_usage_frequency_text" TEXT,
  "max_usage_amount_per_day" DECIMAL(12,4),
  "indication_text" TEXT,
  "usage_instruction_text" TEXT,
  "managing_party" "MedicationStockManagingParty" NOT NULL DEFAULT 'unknown',
  "equivalence_review_status" "MedicationStockEquivalenceReviewStatus" NOT NULL DEFAULT 'not_required',
  "equivalence_confidence" "MedicationStockEquivalenceConfidence",
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMP(3),
  "archived_by" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientMedicationStockItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientMedicationStockItem_default_usage_nonnegative_chk"
    CHECK ("default_usage_amount_per_day" IS NULL OR "default_usage_amount_per_day" >= 0),
  CONSTRAINT "PatientMedicationStockItem_max_usage_nonnegative_chk"
    CHECK ("max_usage_amount_per_day" IS NULL OR "max_usage_amount_per_day" >= 0)
);

CREATE TABLE "MedicationStockEvent" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "stock_item_id" TEXT NOT NULL,
  "event_type" "MedicationStockEventType" NOT NULL,
  "event_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by" TEXT NOT NULL,
  "quantity_kind" "MedicationStockQuantityKind" NOT NULL DEFAULT 'no_quantity',
  "quantity_delta" DECIMAL(12,4),
  "observed_quantity" DECIMAL(12,4),
  "usage_quantity" DECIMAL(12,4),
  "usage_period_days" INTEGER,
  "unit" "MedicationStockUnit" NOT NULL,
  "source_entity_type" "MedicationStockSourceEntityType" NOT NULL DEFAULT 'unknown',
  "source_entity_id" TEXT,
  "source_signal_id" TEXT,
  "external_observation_id" TEXT,
  "idempotency_key_hash" TEXT NOT NULL,
  "request_fingerprint_hash" TEXT NOT NULL,
  "supersedes_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationStockEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationStockEvent_observed_nonnegative_chk"
    CHECK ("observed_quantity" IS NULL OR "observed_quantity" >= 0),
  CONSTRAINT "MedicationStockEvent_usage_nonnegative_chk"
    CHECK ("usage_quantity" IS NULL OR "usage_quantity" >= 0),
  CONSTRAINT "MedicationStockEvent_usage_period_positive_chk"
    CHECK ("usage_period_days" IS NULL OR "usage_period_days" > 0),
  CONSTRAINT "MedicationStockEvent_observed_kind_requires_observed_chk"
    CHECK ("quantity_kind" <> 'observed_absolute' OR "observed_quantity" IS NOT NULL),
  CONSTRAINT "MedicationStockEvent_delta_kind_requires_delta_chk"
    CHECK ("quantity_kind" <> 'delta' OR "quantity_delta" IS NOT NULL),
  CONSTRAINT "MedicationStockEvent_usage_kind_requires_usage_chk"
    CHECK ("quantity_kind" <> 'usage_rate' OR ("usage_quantity" IS NOT NULL AND "usage_period_days" IS NOT NULL))
);

CREATE TABLE "MedicationStockSnapshot" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "stock_item_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "current_quantity" DECIMAL(12,4),
  "unit" "MedicationStockUnit" NOT NULL,
  "last_observed_quantity" DECIMAL(12,4),
  "last_observed_at" TIMESTAMP(3),
  "last_event_id" TEXT,
  "estimated_daily_usage" DECIMAL(12,4),
  "usage_confidence" "MedicationStockUsageConfidence" NOT NULL DEFAULT 'unknown',
  "estimated_stockout_date" TIMESTAMP(3),
  "days_until_stockout" INTEGER,
  "stock_risk_level" "MedicationStockRiskLevel" NOT NULL DEFAULT 'unknown',
  "risk_reason_code" TEXT,
  "calculation_version" TEXT NOT NULL DEFAULT 'medication-stock-snapshot:v1',
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationStockSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationStockSnapshot_current_nonnegative_chk"
    CHECK ("current_quantity" IS NULL OR "current_quantity" >= 0),
  CONSTRAINT "MedicationStockSnapshot_last_observed_nonnegative_chk"
    CHECK ("last_observed_quantity" IS NULL OR "last_observed_quantity" >= 0),
  CONSTRAINT "MedicationStockSnapshot_daily_usage_nonnegative_chk"
    CHECK ("estimated_daily_usage" IS NULL OR "estimated_daily_usage" >= 0),
  CONSTRAINT "MedicationStockSnapshot_days_nonnegative_chk"
    CHECK ("days_until_stockout" IS NULL OR "days_until_stockout" >= 0)
);

CREATE TABLE "ExternalMedicationStockObservation" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "inbound_signal_id" TEXT,
  "source_entity_type" "MedicationStockSourceEntityType" NOT NULL DEFAULT 'unknown',
  "source_entity_id" TEXT,
  "source_author_role" TEXT,
  "observed_at" TIMESTAMP(3),
  "observation_kind" "ExternalMedicationStockObservationKind" NOT NULL,
  "matched_stock_item_id" TEXT,
  "matched_drug_master_id" TEXT,
  "matched_drug_package_id" TEXT,
  "extracted_medication_name" TEXT,
  "extracted_quantity" DECIMAL(12,4),
  "extracted_unit" "MedicationStockUnit",
  "source_confidence" "MedicationStockSourceConfidence" NOT NULL DEFAULT 'unknown',
  "review_state" "ExternalMedicationStockObservationReviewState" NOT NULL DEFAULT 'pending_pharmacist_review',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "applied_stock_event_id" TEXT,
  "idempotency_key_hash" TEXT NOT NULL,
  "request_fingerprint_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalMedicationStockObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalMedicationStockObservation_extracted_quantity_nonnegative_chk"
    CHECK ("extracted_quantity" IS NULL OR "extracted_quantity" >= 0)
);

CREATE UNIQUE INDEX "PatientMedicationStockItem_org_id_display_id_key"
  ON "PatientMedicationStockItem"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "PatientMedicationStockItem_id_org_id_key"
  ON "PatientMedicationStockItem"("id", "org_id");
CREATE INDEX "PatientMedicationStockItem_org_id_idx" ON "PatientMedicationStockItem"("org_id");
CREATE INDEX "PatientMedicationStockItem_org_patient_active_idx"
  ON "PatientMedicationStockItem"("org_id", "patient_id", "active");
CREATE INDEX "PatientMedicationStockItem_org_case_active_idx"
  ON "PatientMedicationStockItem"("org_id", "case_id", "active");
CREATE INDEX "PatientMedicationStockItem_org_drug_master_idx"
  ON "PatientMedicationStockItem"("org_id", "drug_master_id");
CREATE INDEX "PatientMedicationStockItem_org_drug_package_idx"
  ON "PatientMedicationStockItem"("org_id", "drug_package_id");
CREATE INDEX "PatientMedicationStockItem_org_canonical_group_idx"
  ON "PatientMedicationStockItem"("org_id", "canonical_medication_group_id");
CREATE INDEX "PatientMedicationStockItem_org_equivalence_review_status_idx"
  ON "PatientMedicationStockItem"("org_id", "equivalence_review_status");

CREATE UNIQUE INDEX "MedicationStockEvent_org_id_display_id_key"
  ON "MedicationStockEvent"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "MedicationStockEvent_id_org_id_key"
  ON "MedicationStockEvent"("id", "org_id");
CREATE UNIQUE INDEX "MedicationStockEvent_org_idempotency_key_hash_key"
  ON "MedicationStockEvent"("org_id", "idempotency_key_hash");
CREATE INDEX "MedicationStockEvent_org_id_idx" ON "MedicationStockEvent"("org_id");
CREATE INDEX "MedicationStockEvent_org_patient_event_at_idx"
  ON "MedicationStockEvent"("org_id", "patient_id", "event_at" DESC);
CREATE INDEX "MedicationStockEvent_org_case_event_at_idx"
  ON "MedicationStockEvent"("org_id", "case_id", "event_at" DESC);
CREATE INDEX "MedicationStockEvent_org_stock_item_event_at_idx"
  ON "MedicationStockEvent"("org_id", "stock_item_id", "event_at" DESC);
CREATE INDEX "MedicationStockEvent_org_source_entity_idx"
  ON "MedicationStockEvent"("org_id", "source_entity_type", "source_entity_id");
CREATE INDEX "MedicationStockEvent_org_source_signal_idx"
  ON "MedicationStockEvent"("org_id", "source_signal_id");
CREATE INDEX "MedicationStockEvent_org_external_observation_idx"
  ON "MedicationStockEvent"("org_id", "external_observation_id");
CREATE INDEX "MedicationStockEvent_org_supersedes_event_idx"
  ON "MedicationStockEvent"("org_id", "supersedes_event_id");

CREATE UNIQUE INDEX "MedicationStockSnapshot_org_id_display_id_key"
  ON "MedicationStockSnapshot"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "MedicationStockSnapshot_id_org_id_key"
  ON "MedicationStockSnapshot"("id", "org_id");
CREATE UNIQUE INDEX "MedicationStockSnapshot_org_stock_item_key"
  ON "MedicationStockSnapshot"("org_id", "stock_item_id");
CREATE INDEX "MedicationStockSnapshot_org_id_idx" ON "MedicationStockSnapshot"("org_id");
CREATE INDEX "MedicationStockSnapshot_org_patient_idx" ON "MedicationStockSnapshot"("org_id", "patient_id");
CREATE INDEX "MedicationStockSnapshot_org_case_idx" ON "MedicationStockSnapshot"("org_id", "case_id");
CREATE INDEX "MedicationStockSnapshot_org_stock_risk_stockout_idx"
  ON "MedicationStockSnapshot"("org_id", "stock_risk_level", "estimated_stockout_date");
CREATE INDEX "MedicationStockSnapshot_org_patient_stock_risk_idx"
  ON "MedicationStockSnapshot"("org_id", "patient_id", "stock_risk_level");
CREATE INDEX "MedicationStockSnapshot_org_estimated_stockout_date_idx"
  ON "MedicationStockSnapshot"("org_id", "estimated_stockout_date");
CREATE INDEX "MedicationStockSnapshot_org_last_event_idx"
  ON "MedicationStockSnapshot"("org_id", "last_event_id");

CREATE UNIQUE INDEX "ExternalMedicationStockObservation_org_id_display_id_key"
  ON "ExternalMedicationStockObservation"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ExternalMedicationStockObservation_id_org_id_key"
  ON "ExternalMedicationStockObservation"("id", "org_id");
CREATE UNIQUE INDEX "ExternalMedicationStockObservation_org_idempotency_key_hash_key"
  ON "ExternalMedicationStockObservation"("org_id", "idempotency_key_hash");
CREATE INDEX "ExternalMedicationStockObservation_org_id_idx" ON "ExternalMedicationStockObservation"("org_id");
CREATE INDEX "ExternalMedicationStockObservation_org_review_created_idx"
  ON "ExternalMedicationStockObservation"("org_id", "review_state", "created_at" DESC);
CREATE INDEX "ExtMedicationStockObs_org_patient_review_created_idx"
  ON "ExternalMedicationStockObservation"("org_id", "patient_id", "review_state", "created_at" DESC);
CREATE INDEX "ExternalMedicationStockObservation_org_case_review_idx"
  ON "ExternalMedicationStockObservation"("org_id", "case_id", "review_state");
CREATE INDEX "ExternalMedicationStockObservation_org_inbound_signal_idx"
  ON "ExternalMedicationStockObservation"("org_id", "inbound_signal_id");
CREATE INDEX "ExternalMedicationStockObservation_org_matched_stock_item_idx"
  ON "ExternalMedicationStockObservation"("org_id", "matched_stock_item_id");
CREATE INDEX "ExternalMedicationStockObservation_org_matched_drug_master_idx"
  ON "ExternalMedicationStockObservation"("org_id", "matched_drug_master_id");
CREATE INDEX "ExternalMedicationStockObservation_org_matched_drug_package_idx"
  ON "ExternalMedicationStockObservation"("org_id", "matched_drug_package_id");
CREATE INDEX "ExternalMedicationStockObservation_org_applied_stock_event_idx"
  ON "ExternalMedicationStockObservation"("org_id", "applied_stock_event_id");

ALTER TABLE "PatientMedicationStockItem"
  ADD CONSTRAINT "PatientMedicationStockItem_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "PatientMedicationStockItem"
  ADD CONSTRAINT "PatientMedicationStockItem_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "PatientMedicationStockItem"
  ADD CONSTRAINT "PatientMedicationStockItem_drug_master_fkey"
  FOREIGN KEY ("drug_master_id")
  REFERENCES "DrugMaster"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "PatientMedicationStockItem"
  ADD CONSTRAINT "PatientMedicationStockItem_drug_package_fkey"
  FOREIGN KEY ("drug_package_id")
  REFERENCES "DrugPackage"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "MedicationStockEvent"
  ADD CONSTRAINT "MedicationStockEvent_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockEvent"
  ADD CONSTRAINT "MedicationStockEvent_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockEvent"
  ADD CONSTRAINT "MedicationStockEvent_stock_item_fkey"
  FOREIGN KEY ("stock_item_id", "org_id")
  REFERENCES "PatientMedicationStockItem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockEvent"
  ADD CONSTRAINT "MedicationStockEvent_source_signal_fkey"
  FOREIGN KEY ("source_signal_id", "org_id")
  REFERENCES "InboundCommunicationSignal"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockEvent"
  ADD CONSTRAINT "MedicationStockEvent_external_observation_fkey"
  FOREIGN KEY ("external_observation_id", "org_id")
  REFERENCES "ExternalMedicationStockObservation"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockEvent"
  ADD CONSTRAINT "MedicationStockEvent_supersedes_event_fkey"
  FOREIGN KEY ("supersedes_event_id", "org_id")
  REFERENCES "MedicationStockEvent"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "MedicationStockSnapshot"
  ADD CONSTRAINT "MedicationStockSnapshot_stock_item_fkey"
  FOREIGN KEY ("stock_item_id", "org_id")
  REFERENCES "PatientMedicationStockItem"("id", "org_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockSnapshot"
  ADD CONSTRAINT "MedicationStockSnapshot_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockSnapshot"
  ADD CONSTRAINT "MedicationStockSnapshot_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "MedicationStockSnapshot"
  ADD CONSTRAINT "MedicationStockSnapshot_last_event_fkey"
  FOREIGN KEY ("last_event_id", "org_id")
  REFERENCES "MedicationStockEvent"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_inbound_signal_fkey"
  FOREIGN KEY ("inbound_signal_id", "org_id")
  REFERENCES "InboundCommunicationSignal"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_matched_stock_item_fkey"
  FOREIGN KEY ("matched_stock_item_id", "org_id")
  REFERENCES "PatientMedicationStockItem"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_matched_drug_master_fkey"
  FOREIGN KEY ("matched_drug_master_id")
  REFERENCES "DrugMaster"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_matched_drug_package_fkey"
  FOREIGN KEY ("matched_drug_package_id")
  REFERENCES "DrugPackage"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ExternalMedicationStockObservation"
  ADD CONSTRAINT "ExternalMedicationStockObservation_applied_stock_event_fkey"
  FOREIGN KEY ("applied_stock_event_id", "org_id")
  REFERENCES "MedicationStockEvent"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_medication_stock_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MedicationStockEvent is append-only; write a correction event instead';
END;
$$;

CREATE TRIGGER "MedicationStockEvent_no_update"
  BEFORE UPDATE ON "MedicationStockEvent"
  FOR EACH ROW
  EXECUTE FUNCTION reject_medication_stock_event_mutation();

CREATE TRIGGER "MedicationStockEvent_no_delete"
  BEFORE DELETE ON "MedicationStockEvent"
  FOR EACH ROW
  EXECUTE FUNCTION reject_medication_stock_event_mutation();

ALTER TABLE "PatientMedicationStockItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientMedicationStockItem";
CREATE POLICY tenant_isolation ON "PatientMedicationStockItem"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientMedicationStockItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "MedicationStockEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MedicationStockEvent";
CREATE POLICY tenant_isolation ON "MedicationStockEvent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "MedicationStockEvent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "MedicationStockSnapshot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MedicationStockSnapshot";
CREATE POLICY tenant_isolation ON "MedicationStockSnapshot"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "MedicationStockSnapshot" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ExternalMedicationStockObservation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExternalMedicationStockObservation";
CREATE POLICY tenant_isolation ON "ExternalMedicationStockObservation"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ExternalMedicationStockObservation" FORCE ROW LEVEL SECURITY;
