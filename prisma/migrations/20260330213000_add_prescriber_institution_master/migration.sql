-- PrescriberInstitution master
CREATE TABLE "PrescriberInstitution" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution_code" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriberInstitution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrescriberInstitution_org_id_name_key"
    ON "PrescriberInstitution"("org_id", "name");
CREATE INDEX "PrescriberInstitution_org_id_idx"
    ON "PrescriberInstitution"("org_id");
CREATE INDEX "PrescriberInstitution_institution_code_idx"
    ON "PrescriberInstitution"("institution_code");

ALTER TABLE "PrescriberInstitution"
    ADD CONSTRAINT "PrescriberInstitution_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PrescriptionIntake: master reference to PrescriberInstitution
ALTER TABLE "PrescriptionIntake"
    ADD COLUMN "prescriber_institution_id" TEXT;

CREATE INDEX "PrescriptionIntake_prescriber_institution_id_idx"
    ON "PrescriptionIntake"("prescriber_institution_id");

ALTER TABLE "PrescriptionIntake"
    ADD CONSTRAINT "PrescriptionIntake_prescriber_institution_id_fkey"
    FOREIGN KEY ("prescriber_institution_id")
    REFERENCES "PrescriberInstitution"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
