ALTER TABLE "PrescriptionIntake"
ADD COLUMN "external_prescription_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PrescriptionIntake"
    WHERE "external_prescription_id" IS NOT NULL
    GROUP BY "org_id", "source_type", "external_prescription_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate electronic prescription intake external ids exist; resolve before adding uniqueness';
  END IF;
END $$;

CREATE UNIQUE INDEX "PrescriptionIntake_org_source_external_prescription_id_key"
ON "PrescriptionIntake"("org_id", "source_type", "external_prescription_id");
