-- Enforce single current/active clinical-history rows under concurrent writes.
-- Keep the newest row active/current if historical duplicate rows already exist.

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "org_id", "patient_id", "field_key"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS rn
  FROM "PatientFieldRevision"
  WHERE "is_current" IS TRUE
)
UPDATE "PatientFieldRevision" revision
SET
  "is_current" = false,
  "valid_to" = COALESCE(revision."valid_to", revision."valid_from"),
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE revision."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX "PatientFieldRevision_one_current_field_idx"
  ON "PatientFieldRevision"("org_id", "patient_id", "field_key")
  WHERE "is_current" IS TRUE;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "org_id", "patient_id", "case_id", "procedure_type"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS rn
  FROM "PatientMedicalProcedure"
  WHERE "is_active" IS TRUE
)
UPDATE "PatientMedicalProcedure" procedure
SET
  "is_active" = false,
  "end_date" = COALESCE(procedure."end_date", procedure."start_date", CURRENT_DATE),
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE procedure."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX "PatientMedicalProcedure_one_active_type_idx"
  ON "PatientMedicalProcedure"("org_id", "patient_id", "case_id", "procedure_type")
  WHERE "is_active" IS TRUE;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "org_id", "patient_id", "case_id", "narcotic_kind"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS rn
  FROM "PatientNarcoticUse"
  WHERE "is_active" IS TRUE
)
UPDATE "PatientNarcoticUse" narcotic
SET
  "is_active" = false,
  "end_date" = COALESCE(narcotic."end_date", narcotic."start_date", CURRENT_DATE),
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE narcotic."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX "PatientNarcoticUse_one_active_kind_idx"
  ON "PatientNarcoticUse"("org_id", "patient_id", "case_id", "narcotic_kind")
  WHERE "is_active" IS TRUE;

