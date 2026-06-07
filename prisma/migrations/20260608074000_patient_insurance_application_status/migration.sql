CREATE TYPE "InsuranceApplicationStatus" AS ENUM (
  'confirmed',
  'applying',
  'change_pending',
  'not_applicable'
);

ALTER TABLE "PatientInsurance"
  ADD COLUMN "application_status" "InsuranceApplicationStatus" NOT NULL DEFAULT 'confirmed',
  ADD COLUMN "public_program_code" TEXT,
  ADD COLUMN "application_submitted_at" DATE,
  ADD COLUMN "decision_at" DATE,
  ADD COLUMN "previous_care_level" TEXT,
  ADD COLUMN "provisional_care_level" TEXT,
  ADD COLUMN "confirmed_care_level" TEXT;

CREATE INDEX "PatientInsurance_patient_id_application_status_is_active_idx"
  ON "PatientInsurance"("patient_id", "application_status", "is_active");
