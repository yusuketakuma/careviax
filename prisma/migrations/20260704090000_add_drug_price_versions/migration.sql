-- CreateTable
CREATE TABLE "DrugPriceVersion" (
    "id" TEXT NOT NULL,
    "display_id" TEXT NOT NULL,
    "drug_master_id" TEXT NOT NULL,
    "import_log_id" TEXT,
    "source" "ImportSource" NOT NULL DEFAULT 'mhlw_price',
    "source_url" TEXT,
    "source_file_hash" TEXT,
    "source_published_at" DATE,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "drug_price" DECIMAL(12,2),
    "transitional_expiry_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugPriceVersion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "DispenseResult" ADD COLUMN     "drug_price_version_id" TEXT,
ADD COLUMN     "drug_price_snapshot" DECIMAL(12,2),
ADD COLUMN     "drug_price_effective_from_snapshot" DATE,
ADD COLUMN     "drug_price_source_snapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "DrugPriceVersion_display_id_key" ON "DrugPriceVersion"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugPriceVersion_drug_master_id_effective_from_key" ON "DrugPriceVersion"("drug_master_id", "effective_from");

-- CreateIndex
CREATE INDEX "DrugPriceVersion_drug_master_id_effective_from_effective_to_idx" ON "DrugPriceVersion"("drug_master_id", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "DrugPriceVersion_source_effective_from_idx" ON "DrugPriceVersion"("source", "effective_from");

-- CreateIndex
CREATE INDEX "DrugPriceVersion_source_file_hash_idx" ON "DrugPriceVersion"("source_file_hash");

-- CreateIndex
CREATE INDEX "DrugPriceVersion_import_log_id_idx" ON "DrugPriceVersion"("import_log_id");

-- CreateIndex
CREATE INDEX "DispenseResult_drug_price_version_id_idx" ON "DispenseResult"("drug_price_version_id");

-- AddForeignKey
ALTER TABLE "DrugPriceVersion" ADD CONSTRAINT "DrugPriceVersion_drug_master_id_fkey" FOREIGN KEY ("drug_master_id") REFERENCES "DrugMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugPriceVersion" ADD CONSTRAINT "DrugPriceVersion_import_log_id_fkey" FOREIGN KEY ("import_log_id") REFERENCES "DrugMasterImportLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseResult" ADD CONSTRAINT "DispenseResult_drug_price_version_id_fkey" FOREIGN KEY ("drug_price_version_id") REFERENCES "DrugPriceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
