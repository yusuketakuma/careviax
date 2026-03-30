CREATE TYPE "FacilityTypeEnum" AS ENUM (
  'nursing_home',
  'group_home',
  'assisted_living',
  'clinic',
  'hospital',
  'day_service',
  'home',
  'other'
);

CREATE TYPE "ProfessionTypeEnum" AS ENUM (
  'physician',
  'nurse',
  'care_manager',
  'medical_social_worker',
  'physical_therapist',
  'occupational_therapist',
  'speech_therapist',
  'registered_dietitian',
  'dentist',
  'dental_hygienist',
  'home_helper',
  'care_staff',
  'other'
);

CREATE TABLE "Facility" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "facility_type" "FacilityTypeEnum" NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "fax" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FacilityContact" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "facility_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "fax" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacilityContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalProfessional" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "profession_type" "ProfessionTypeEnum" NOT NULL,
  "name" TEXT NOT NULL,
  "organization_name" TEXT,
  "department" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "fax" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalProfessional_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CareTeamLink"
  ADD COLUMN "external_professional_id" TEXT;

CREATE UNIQUE INDEX "Facility_org_id_name_key" ON "Facility"("org_id", "name");
CREATE INDEX "Facility_org_id_idx" ON "Facility"("org_id");
CREATE INDEX "FacilityContact_org_id_idx" ON "FacilityContact"("org_id");
CREATE INDEX "FacilityContact_facility_id_idx" ON "FacilityContact"("facility_id");
CREATE INDEX "ExternalProfessional_org_id_idx" ON "ExternalProfessional"("org_id");
CREATE INDEX "ExternalProfessional_profession_type_idx" ON "ExternalProfessional"("profession_type");
CREATE INDEX "CareTeamLink_external_professional_id_idx" ON "CareTeamLink"("external_professional_id");

ALTER TABLE "Facility"
  ADD CONSTRAINT "Facility_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacilityContact"
  ADD CONSTRAINT "FacilityContact_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalProfessional"
  ADD CONSTRAINT "ExternalProfessional_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareTeamLink"
  ADD CONSTRAINT "CareTeamLink_external_professional_id_fkey" FOREIGN KEY ("external_professional_id") REFERENCES "ExternalProfessional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Facility"
  USING ("org_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true));

ALTER TABLE "FacilityContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FacilityContact"
  USING ("org_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true));

ALTER TABLE "ExternalProfessional" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExternalProfessional"
  USING ("org_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true));

ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FacilityContact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ExternalProfessional" FORCE ROW LEVEL SECURITY;
