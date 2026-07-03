-- ID-2-W1: Display ID wave 1 for patient-domain org-scoped tables.
-- The columns are nullable for expand/backfill rollout. Uniqueness is enforced
-- only for assigned IDs so existing rows can be migrated in batches.

ALTER TABLE "Patient" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Patient_org_id_display_id_key" ON "Patient"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Residence" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Residence_org_id_display_id_key" ON "Residence"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CareCase" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CareCase_org_id_display_id_key" ON "CareCase"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ContactParty" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ContactParty_org_id_display_id_key" ON "ContactParty"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CareTeamLink" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CareTeamLink_org_id_display_id_key" ON "CareTeamLink"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientCondition" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientCondition_org_id_display_id_key" ON "PatientCondition"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ConsentRecord" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ConsentRecord_org_id_display_id_key" ON "ConsentRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ManagementPlan" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ManagementPlan_org_id_display_id_key" ON "ManagementPlan"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientSchedulePreference" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientSchedulePreference_org_id_display_id_key" ON "PatientSchedulePreference"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientPackagingProfile" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientPackagingProfile_org_id_display_id_key" ON "PatientPackagingProfile"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientMcsLink" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientMcsLink_org_id_display_id_key" ON "PatientMcsLink"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientMcsSummary" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientMcsSummary_org_id_display_id_key" ON "PatientMcsSummary"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientInsurance" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientInsurance_org_id_display_id_key" ON "PatientInsurance"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientLabObservation" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientLabObservation_org_id_display_id_key" ON "PatientLabObservation"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientMcsMessage" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientMcsMessage_org_id_display_id_key" ON "PatientMcsMessage"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientFieldRevision" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientFieldRevision_org_id_display_id_key" ON "PatientFieldRevision"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientMedicalProcedure" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientMedicalProcedure_org_id_display_id_key" ON "PatientMedicalProcedure"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientNarcoticUse" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientNarcoticUse_org_id_display_id_key" ON "PatientNarcoticUse"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
