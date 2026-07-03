-- AlterTable
ALTER TABLE "DrugMaster" ADD COLUMN     "display_id" TEXT;

-- AlterTable
ALTER TABLE "DrugPackage" ADD COLUMN     "display_id" TEXT;

-- AlterTable
ALTER TABLE "DrugPackageInsert" ADD COLUMN     "display_id" TEXT;

-- AlterTable
ALTER TABLE "DrugInteraction" ADD COLUMN     "display_id" TEXT;

-- AlterTable
ALTER TABLE "GenericDrugMapping" ADD COLUMN     "display_id" TEXT;

-- AlterTable
ALTER TABLE "DrugMasterImportLog" ADD COLUMN     "display_id" TEXT;

-- AlterTable
ALTER TABLE "DrugMasterChangeEvent" ADD COLUMN     "display_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DrugMaster_display_id_key" ON "DrugMaster"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugPackage_display_id_key" ON "DrugPackage"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugPackageInsert_display_id_key" ON "DrugPackageInsert"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugInteraction_display_id_key" ON "DrugInteraction"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "GenericDrugMapping_display_id_key" ON "GenericDrugMapping"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugMasterImportLog_display_id_key" ON "DrugMasterImportLog"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugMasterChangeEvent_display_id_key" ON "DrugMasterChangeEvent"("display_id");
