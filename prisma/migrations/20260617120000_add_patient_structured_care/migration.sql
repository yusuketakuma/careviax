-- 在宅医療処置/麻薬の構造化テーブル。
-- 移行期は home_visit_intake(JSON)が SoT で、本表は今後の書込を反映する追加レイヤ。
-- patient_id は IncidentReport 同様 FK を張らず org_id + RLS でテナント分離する。
CREATE TABLE "PatientMedicalProcedure" (
    "id"             TEXT NOT NULL,
    "org_id"         TEXT NOT NULL,
    "patient_id"     TEXT NOT NULL,
    "case_id"        TEXT,
    "procedure_type" TEXT NOT NULL,
    "is_active"      BOOLEAN NOT NULL DEFAULT true,
    "start_date"     DATE,
    "end_date"       DATE,
    "source"         TEXT NOT NULL DEFAULT 'patient_detail_edit',
    "confirmed_by"   TEXT,
    "confirmed_at"   TIMESTAMP(3),
    "notes"          TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientMedicalProcedure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientMedicalProcedure_org_id_idx" ON "PatientMedicalProcedure"("org_id");
CREATE INDEX "PatientMedicalProcedure_patient_id_is_active_idx" ON "PatientMedicalProcedure"("patient_id", "is_active");
CREATE INDEX "PatientMedicalProcedure_patient_id_procedure_type_idx" ON "PatientMedicalProcedure"("patient_id", "procedure_type");

CREATE TABLE "PatientNarcoticUse" (
    "id"            TEXT NOT NULL,
    "org_id"        TEXT NOT NULL,
    "patient_id"    TEXT NOT NULL,
    "case_id"       TEXT,
    "narcotic_kind" TEXT NOT NULL,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    "start_date"    DATE,
    "end_date"      DATE,
    "source"        TEXT NOT NULL DEFAULT 'patient_detail_edit',
    "confirmed_by"  TEXT,
    "confirmed_at"  TIMESTAMP(3),
    "notes"         TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientNarcoticUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientNarcoticUse_org_id_idx" ON "PatientNarcoticUse"("org_id");
CREATE INDEX "PatientNarcoticUse_patient_id_is_active_idx" ON "PatientNarcoticUse"("patient_id", "is_active");

-- RLS: org_id によるテナント分離(withOrgContext の SET LOCAL app.current_org_id と対)
ALTER TABLE "PatientMedicalProcedure" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientMedicalProcedure";
CREATE POLICY tenant_isolation ON "PatientMedicalProcedure"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientMedicalProcedure" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientNarcoticUse" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientNarcoticUse";
CREATE POLICY tenant_isolation ON "PatientNarcoticUse"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientNarcoticUse" FORCE ROW LEVEL SECURITY;
