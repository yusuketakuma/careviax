-- Clear remaining Prisma schema drift after moving local E2E from db push to
-- migrate deploy.

DROP INDEX IF EXISTS "Patient_archived_at_idx";

ALTER TABLE "ExternalProfessional"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Facility"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FacilityContact"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FacilityUnit"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PrescriberInstitution"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
