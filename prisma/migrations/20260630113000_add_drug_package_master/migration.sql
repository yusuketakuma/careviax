-- Add a package-level drug master table for GS1 GTIN/JAN evidence.
-- Existing DrugMaster.jan_code stays as a compatibility fallback during migration.
CREATE TABLE "DrugPackage" (
    "id" TEXT NOT NULL,
    "drug_master_id" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "jan_code" TEXT,
    "package_level" TEXT,
    "package_quantity" DECIMAL(12,4),
    "package_quantity_unit" TEXT,
    "manufacturer" TEXT,
    "source" "ImportSource",
    "source_file_hash" TEXT,
    "source_record_id" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DrugPackage_gtin_key" ON "DrugPackage"("gtin");
CREATE INDEX "DrugPackage_drug_master_id_idx" ON "DrugPackage"("drug_master_id");
CREATE INDEX "DrugPackage_jan_code_idx" ON "DrugPackage"("jan_code");
CREATE INDEX "DrugPackage_package_level_idx" ON "DrugPackage"("package_level");
CREATE INDEX "DrugPackage_is_active_idx" ON "DrugPackage"("is_active");
CREATE INDEX "DrugPackage_source_source_file_hash_idx" ON "DrugPackage"("source", "source_file_hash");

ALTER TABLE "DrugPackage"
    ADD CONSTRAINT "DrugPackage_drug_master_id_fkey"
    FOREIGN KEY ("drug_master_id") REFERENCES "DrugMaster"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
