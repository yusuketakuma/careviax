CREATE TYPE "PatientConditionType" AS ENUM (
    'disease',
    'problem'
);

CREATE TABLE "PatientCondition" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "condition_type" "PatientConditionType" NOT NULL,
    "name" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "noted_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientCondition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientCondition_org_id_idx" ON "PatientCondition"("org_id");
CREATE INDEX "PatientCondition_patient_id_idx" ON "PatientCondition"("patient_id");
CREATE INDEX "PatientCondition_condition_type_idx" ON "PatientCondition"("condition_type");

ALTER TABLE "PatientCondition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientCondition"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientCondition" FORCE ROW LEVEL SECURITY;
