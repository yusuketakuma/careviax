-- ID-2-W4: Display ID wave 4 for organization-domain direct org-scoped tables.
-- The columns are nullable for expand/backfill rollout. Uniqueness is enforced
-- only for assigned IDs so existing rows can be migrated in batches.

ALTER TABLE "PharmacySite" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacySite_org_id_display_id_key" ON "PharmacySite"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ServiceArea" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ServiceArea_org_id_display_id_key" ON "ServiceArea"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacySiteInsuranceConfig" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacySiteInsuranceConfig_org_id_display_id_key" ON "PharmacySiteInsuranceConfig"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Membership" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Membership_org_id_display_id_key" ON "Membership"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FacilityStandardRegistration" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FacilityStandardRegistration_org_id_display_id_key" ON "FacilityStandardRegistration"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacistCredential" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacistCredential_org_id_display_id_key" ON "PharmacistCredential"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacistShift" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacistShift_org_id_display_id_key" ON "PharmacistShift"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacistShiftTemplate" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacistShiftTemplate_org_id_display_id_key" ON "PharmacistShiftTemplate"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "BusinessHoliday" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "BusinessHoliday_org_id_display_id_key" ON "BusinessHoliday"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyOperatingHours" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyOperatingHours_org_id_display_id_key" ON "PharmacyOperatingHours"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Facility" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Facility_org_id_display_id_key" ON "Facility"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FacilityUnit" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FacilityUnit_org_id_display_id_key" ON "FacilityUnit"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FacilityContact" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FacilityContact_org_id_display_id_key" ON "FacilityContact"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ExternalProfessional" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ExternalProfessional_org_id_display_id_key" ON "ExternalProfessional"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PrescriberInstitution" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PrescriberInstitution_org_id_display_id_key" ON "PrescriberInstitution"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
