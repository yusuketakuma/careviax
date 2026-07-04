-- W3-B2: VisitInstruction + SpecialPatientStatus skeleton.
-- Additive only: new org-scoped tables, required create-time display IDs, and
-- fail-closed RLS backstops. No existing rows or tables are rewritten.

CREATE TYPE "SpecialPatientStatusType" AS ENUM (
  'terminal_cancer',
  'injectable_narcotic',
  'home_central_venous_nutrition',
  'heart_failure',
  'respiratory_failure',
  'other'
);

CREATE TABLE "VisitInstruction" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "schedule_id" TEXT,
  "physician_id" TEXT,
  "physician_name" TEXT NOT NULL,
  "medical_institution" TEXT NOT NULL,
  "instruction_date" DATE NOT NULL,
  "instruction_content" TEXT NOT NULL,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "source_type" TEXT,
  "source_ref" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VisitInstruction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SpecialPatientStatus" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "source_visit_record_id" TEXT,
  "status_type" "SpecialPatientStatusType" NOT NULL,
  "evidence_summary" TEXT NOT NULL,
  "set_by" TEXT,
  "set_at" TIMESTAMP(3) NOT NULL,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "source_ref" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpecialPatientStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitInstruction_org_id_display_id_key"
  ON "VisitInstruction"("org_id", "display_id");
CREATE UNIQUE INDEX "VisitInstruction_id_org_id_key"
  ON "VisitInstruction"("id", "org_id");
CREATE INDEX "VisitInstruction_org_id_idx" ON "VisitInstruction"("org_id");
CREATE INDEX "VisitInstruction_patient_id_idx" ON "VisitInstruction"("patient_id");
CREATE INDEX "VisitInstruction_case_id_idx" ON "VisitInstruction"("case_id");
CREATE INDEX "VisitInstruction_schedule_id_idx" ON "VisitInstruction"("schedule_id");
CREATE INDEX "VisitInstruction_org_id_patient_id_valid_from_valid_to_idx"
  ON "VisitInstruction"("org_id", "patient_id", "valid_from", "valid_to");

CREATE UNIQUE INDEX "SpecialPatientStatus_org_id_display_id_key"
  ON "SpecialPatientStatus"("org_id", "display_id");
CREATE UNIQUE INDEX "SpecialPatientStatus_id_org_id_key"
  ON "SpecialPatientStatus"("id", "org_id");
CREATE INDEX "SpecialPatientStatus_org_id_idx" ON "SpecialPatientStatus"("org_id");
CREATE INDEX "SpecialPatientStatus_patient_id_idx" ON "SpecialPatientStatus"("patient_id");
CREATE INDEX "SpecialPatientStatus_case_id_idx" ON "SpecialPatientStatus"("case_id");
CREATE INDEX "SpecialPatientStatus_source_visit_record_id_idx"
  ON "SpecialPatientStatus"("source_visit_record_id");
CREATE INDEX "SpecialPatientStatus_org_id_patient_id_status_type_valid_from_valid_to_idx"
  ON "SpecialPatientStatus"("org_id", "patient_id", "status_type", "valid_from", "valid_to");

ALTER TABLE "VisitInstruction"
  ADD CONSTRAINT "VisitInstruction_patient_id_org_id_fkey"
  FOREIGN KEY ("patient_id", "org_id") REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitInstruction"
  ADD CONSTRAINT "VisitInstruction_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "CareCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitInstruction"
  ADD CONSTRAINT "VisitInstruction_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "VisitSchedule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SpecialPatientStatus"
  ADD CONSTRAINT "SpecialPatientStatus_patient_id_org_id_fkey"
  FOREIGN KEY ("patient_id", "org_id") REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpecialPatientStatus"
  ADD CONSTRAINT "SpecialPatientStatus_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "CareCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpecialPatientStatus"
  ADD CONSTRAINT "SpecialPatientStatus_source_visit_record_id_fkey"
  FOREIGN KEY ("source_visit_record_id") REFERENCES "VisitRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisitInstruction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitInstruction"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitInstruction" FORCE ROW LEVEL SECURITY;

ALTER TABLE "SpecialPatientStatus" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SpecialPatientStatus"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "SpecialPatientStatus" FORCE ROW LEVEL SECURITY;
