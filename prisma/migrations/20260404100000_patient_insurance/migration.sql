-- Migration: Add PatientInsurance model
-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('medical', 'care', 'public_subsidy');

-- CreateTable
CREATE TABLE "PatientInsurance" (
    "id"             TEXT NOT NULL,
    "org_id"         TEXT NOT NULL,
    "patient_id"     TEXT NOT NULL,
    "insurance_type" "InsuranceType" NOT NULL,
    "insurer_number" TEXT,
    "symbol"         TEXT,
    "number"         TEXT,
    "branch_number"  TEXT,
    "copay_ratio"    INTEGER,
    "valid_from"     DATE,
    "valid_until"    DATE,
    "is_active"      BOOLEAN NOT NULL DEFAULT true,
    "notes"          TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientInsurance_org_id_idx" ON "PatientInsurance"("org_id");
CREATE INDEX "PatientInsurance_patient_id_idx" ON "PatientInsurance"("patient_id");
CREATE INDEX "PatientInsurance_patient_id_insurance_type_is_active_idx" ON "PatientInsurance"("patient_id", "insurance_type", "is_active");

-- AddForeignKey
ALTER TABLE "PatientInsurance" ADD CONSTRAINT "PatientInsurance_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "PatientInsurance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientInsurance"
    USING (org_id = current_setting('app.current_org_id', true))
    WITH CHECK (org_id = current_setting('app.current_org_id', true));
