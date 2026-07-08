-- Medication Stock visit observation context.
-- Expand-only candidate: preserve MedicationStockEvent as the append-only
-- canonical ledger and store visit-only non-quantity context in a 1:1 sidecar.
-- Do not apply this migration to a live database without the human migration gate.

CREATE TYPE "MedicationStockObservationContextKind" AS ENUM (
  'visit_observation'
);

CREATE TYPE "MedicationStockUnobservedReasonCode" AS ENUM (
  'patient_refused',
  'caregiver_unavailable',
  'storage_inaccessible',
  'medication_not_present',
  'identity_uncertain',
  'visit_time_limited',
  'safety_priority',
  'other_institution_unconfirmed',
  'unknown'
);

CREATE TABLE "MedicationStockObservationContext" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "stock_event_id" TEXT NOT NULL,
  "context_kind" "MedicationStockObservationContextKind" NOT NULL DEFAULT 'visit_observation',
  "visit_record_id" TEXT,
  "observed_date_key_jst" VARCHAR(10),
  "last_used_at" TIMESTAMP(3),
  "last_used_date_key_jst" VARCHAR(10),
  "last_used_precision" VARCHAR(16),
  "unobserved_reason_code" "MedicationStockUnobservedReasonCode",
  "source_confidence" "MedicationStockSourceConfidence" NOT NULL DEFAULT 'unknown',
  "source_context_code" VARCHAR(48),
  "confirmation_level" VARCHAR(48),
  "idempotency_key_hash" TEXT NOT NULL,
  "request_fingerprint_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MedicationStockObservationContext_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationStockObservationContext_visit_record_required_chk"
    CHECK ("context_kind" <> 'visit_observation' OR "visit_record_id" IS NOT NULL),
  CONSTRAINT "MedicationStockObservationContext_observed_date_required_chk"
    CHECK ("context_kind" <> 'visit_observation' OR "observed_date_key_jst" IS NOT NULL),
  CONSTRAINT "MedicationStockObservationContext_observed_date_key_jst_chk"
    CHECK ("observed_date_key_jst" IS NULL OR "observed_date_key_jst" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT "MedicationStockObservationContext_last_used_date_key_jst_chk"
    CHECK ("last_used_date_key_jst" IS NULL OR "last_used_date_key_jst" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT "MedicationStockObservationContext_last_used_context_chk"
    CHECK (
      "last_used_at" IS NULL OR
      (
        "last_used_date_key_jst" IS NOT NULL AND
        "last_used_precision" IS NOT NULL
      )
    ),
  CONSTRAINT "MedicationStockObservationContext_last_used_precision_chk"
    CHECK (
      "last_used_precision" IS NULL OR
      "last_used_precision" IN ('exact_datetime', 'date_only', 'unknown')
    ),
  CONSTRAINT "MedicationStockObservationContext_source_context_code_chk"
    CHECK (
      "source_context_code" IS NULL OR
      "source_context_code" IN (
        'pharmacist_direct_observation',
        'patient_report',
        'caregiver_report',
        'facility_staff_report',
        'record_review',
        'unknown'
      )
    ),
  CONSTRAINT "MedicationStockObservationContext_confirmation_level_chk"
    CHECK (
      "confirmation_level" IS NULL OR
      "confirmation_level" IN (
        'counted_by_pharmacist',
        'photo_verified',
        'patient_reported',
        'caregiver_reported',
        'other_professional_reported',
        'other_institution_record',
        'unknown'
      )
    )
);

CREATE UNIQUE INDEX "MedicationStockObservationContext_org_id_display_id_key"
  ON "MedicationStockObservationContext"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;

CREATE UNIQUE INDEX "MedicationStockObservationContext_id_org_id_key"
  ON "MedicationStockObservationContext"("id", "org_id");

CREATE UNIQUE INDEX "MedicationStockObservationContext_org_stock_event_key"
  ON "MedicationStockObservationContext"("org_id", "stock_event_id");

CREATE UNIQUE INDEX "MedicationStockObservationContext_org_idempotency_key_hash_key"
  ON "MedicationStockObservationContext"("org_id", "idempotency_key_hash");

CREATE INDEX "MedicationStockObservationContext_org_id_idx"
  ON "MedicationStockObservationContext"("org_id");

CREATE INDEX "MedicationStockObservationContext_org_visit_idx"
  ON "MedicationStockObservationContext"("org_id", "visit_record_id");

CREATE INDEX "MedicationStockObservationContext_org_kind_created_idx"
  ON "MedicationStockObservationContext"("org_id", "context_kind", "created_at" DESC);

CREATE INDEX "MedicationStockObservationContext_org_reason_idx"
  ON "MedicationStockObservationContext"("org_id", "unobserved_reason_code");

ALTER TABLE "MedicationStockObservationContext"
  ADD CONSTRAINT "MedicationStockObservationContext_stock_event_fkey"
  FOREIGN KEY ("stock_event_id", "org_id")
  REFERENCES "MedicationStockEvent"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "MedicationStockObservationContext"
  ADD CONSTRAINT "MedicationStockObservationContext_visit_record_fkey"
  FOREIGN KEY ("visit_record_id", "org_id")
  REFERENCES "VisitRecord"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_medication_stock_observation_context_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MedicationStockObservationContext is append-only; write a correction event instead';
END;
$$;

CREATE TRIGGER "MedicationStockObservationContext_no_update"
  BEFORE UPDATE ON "MedicationStockObservationContext"
  FOR EACH ROW
  EXECUTE FUNCTION reject_medication_stock_observation_context_mutation();

CREATE TRIGGER "MedicationStockObservationContext_no_delete"
  BEFORE DELETE ON "MedicationStockObservationContext"
  FOR EACH ROW
  EXECUTE FUNCTION reject_medication_stock_observation_context_mutation();

ALTER TABLE "MedicationStockObservationContext" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MedicationStockObservationContext";
CREATE POLICY tenant_isolation ON "MedicationStockObservationContext"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "MedicationStockObservationContext" FORCE ROW LEVEL SECURITY;
