-- 患者項目の業務差分履歴(変更履歴 層b)+時点管理(層c)。
-- AuditLog(層a: 行単位 before/after をDBトリガが自動記録)とは別レイヤ。
-- ContactParty/Residence/PatientCondition は audit トリガ対象外のため、本表が唯一の変更履歴となる。
CREATE TABLE "PatientFieldRevision" (
    "id"                     TEXT NOT NULL,
    "org_id"                 TEXT NOT NULL,
    "patient_id"             TEXT NOT NULL,
    "case_id"                TEXT,
    "category"               TEXT NOT NULL,
    "field_key"              TEXT NOT NULL,
    "field_label"            TEXT,
    "old_value"              JSONB,
    "new_value"              JSONB,
    "value_label"            TEXT,
    "source"                 TEXT NOT NULL DEFAULT 'patient_detail_edit',
    "source_visit_record_id" TEXT,
    "confirmed_by"           TEXT,
    "confirmed_at"           TIMESTAMP(3),
    "valid_from"             DATE NOT NULL,
    "valid_to"               DATE,
    "is_current"             BOOLEAN NOT NULL DEFAULT true,
    "change_reason"          TEXT,
    "importance"             TEXT NOT NULL DEFAULT 'normal',
    "updated_by"             TEXT NOT NULL,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientFieldRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientFieldRevision_org_id_idx"
    ON "PatientFieldRevision"("org_id");

CREATE INDEX "PatientFieldRevision_patient_id_field_key_valid_from_idx"
    ON "PatientFieldRevision"("patient_id", "field_key", "valid_from" DESC);

CREATE INDEX "PatientFieldRevision_patient_id_is_current_idx"
    ON "PatientFieldRevision"("patient_id", "is_current");

CREATE INDEX "PatientFieldRevision_source_visit_record_id_idx"
    ON "PatientFieldRevision"("source_visit_record_id");

-- RLS: org_id によるテナント分離(withOrgContext の SET LOCAL app.current_org_id と対)
ALTER TABLE "PatientFieldRevision" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientFieldRevision";
CREATE POLICY tenant_isolation ON "PatientFieldRevision"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientFieldRevision" FORCE ROW LEVEL SECURITY;
