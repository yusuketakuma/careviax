CREATE TYPE "PackagingMethod" AS ENUM (
  'none',
  'unit_dose',
  'morning_evening_unit_dose',
  'medication_box',
  'calendar_pack',
  'blister_pack',
  'crush_and_pack',
  'other'
);

ALTER TABLE "PrescriptionLine"
ADD COLUMN "packaging_method" "PackagingMethod";

ALTER TABLE "SetBatch"
ADD COLUMN "packaging_method_snapshot" "PackagingMethod",
ADD COLUMN "packaging_instructions_snapshot" TEXT;

CREATE TABLE "PatientPackagingProfile" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "default_packaging_method" "PackagingMethod",
  "medication_box_color" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientPackagingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientPackagingProfile_patient_id_key" ON "PatientPackagingProfile"("patient_id");
CREATE INDEX "PatientPackagingProfile_org_id_idx" ON "PatientPackagingProfile"("org_id");
CREATE INDEX "PatientPackagingProfile_patient_id_idx" ON "PatientPackagingProfile"("patient_id");

ALTER TABLE "PatientPackagingProfile"
ADD CONSTRAINT "PatientPackagingProfile_patient_id_fkey"
FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
