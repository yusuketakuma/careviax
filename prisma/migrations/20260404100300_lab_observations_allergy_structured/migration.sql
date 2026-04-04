-- Migration: PatientLabObservation model + allergy_info structured backfill

-- CreateEnum
CREATE TYPE "LabAnalyteCode" AS ENUM (
  'wbc', 'neut', 'hb', 'plt', 'pt_inr',
  'ast', 'alt', 't_bil', 'scr', 'egfr', 'ck', 'crp',
  'k', 'hba1c', 'tp', 'alb', 'na', 'cl', 'bun', 'bnp',
  'nt_pro_bnp', 'blood_glucose'
);

-- CreateTable
CREATE TABLE "PatientLabObservation" (
    "id"                     TEXT NOT NULL,
    "org_id"                 TEXT NOT NULL,
    "patient_id"             TEXT NOT NULL,
    "analyte_code"           "LabAnalyteCode" NOT NULL,
    "measured_at"            TIMESTAMP(3) NOT NULL,
    "value_numeric"          DOUBLE PRECISION,
    "value_text"             TEXT,
    "unit"                   TEXT,
    "abnormal_flag"          TEXT,
    "reference_low"          DOUBLE PRECISION,
    "reference_high"         DOUBLE PRECISION,
    "source_type"            TEXT NOT NULL,
    "source_visit_record_id" TEXT,
    "note"                   TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientLabObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientLabObservation_org_id_idx" ON "PatientLabObservation"("org_id");
CREATE INDEX "PatientLabObservation_patient_id_analyte_code_measured_at_idx" ON "PatientLabObservation"("patient_id", "analyte_code", "measured_at");
CREATE INDEX "PatientLabObservation_source_visit_record_id_idx" ON "PatientLabObservation"("source_visit_record_id");

-- AddForeignKey
ALTER TABLE "PatientLabObservation" ADD CONSTRAINT "PatientLabObservation_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "PatientLabObservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientLabObservation"
    USING (org_id = current_setting('app.current_org_id', true))
    WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- Backfill: normalize allergy_info string[] → AllergyEntry[]
-- Convert existing string-array entries to structured AllergyEntry objects
UPDATE "Patient"
SET "allergy_info" = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'drug_name', elem,
      'category', 'drug',
      'severity', 'unknown'
    )
  )
  FROM jsonb_array_elements_text("allergy_info") AS elem
)
WHERE "allergy_info" IS NOT NULL
  AND jsonb_typeof("allergy_info") = 'array'
  AND jsonb_array_length("allergy_info") > 0
  AND (
    -- Only backfill if first element is a plain string (not already structured)
    jsonb_typeof("allergy_info" -> 0) = 'string'
  );
