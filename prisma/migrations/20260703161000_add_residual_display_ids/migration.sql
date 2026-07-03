ALTER TABLE "MedicationProfile" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "MedicationProfile_org_id_display_id_key" ON "MedicationProfile"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ResidualMedication" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ResidualMedication_org_id_display_id_key" ON "ResidualMedication"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "MedicationIssue" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "MedicationIssue_org_id_display_id_key" ON "MedicationIssue"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Intervention" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Intervention_org_id_display_id_key" ON "Intervention"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FirstVisitDocument" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FirstVisitDocument_org_id_display_id_key" ON "FirstVisitDocument"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PackagingMethodMaster" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PackagingMethodMaster_org_id_display_id_key" ON "PackagingMethodMaster"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PcaPump" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PcaPump_org_id_display_id_key" ON "PcaPump"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PcaPumpMaintenanceEvent" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PcaPumpMaintenanceEvent_org_id_display_id_key" ON "PcaPumpMaintenanceEvent"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PcaPumpRental" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PcaPumpRental_org_id_display_id_key" ON "PcaPumpRental"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PcaPumpRentalAccessory" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PcaPumpRentalAccessory_org_id_display_id_key" ON "PcaPumpRentalAccessory"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Task" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Task_org_id_display_id_key" ON "Task"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "SavedView" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "SavedView_org_id_display_id_key" ON "SavedView"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "HandoffItem" ADD COLUMN "display_id" TEXT;
CREATE INDEX "HandoffItem_display_id_idx" ON "HandoffItem"("display_id") WHERE "display_id" IS NOT NULL;
