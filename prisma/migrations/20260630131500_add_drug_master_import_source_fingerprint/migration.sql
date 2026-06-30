ALTER TABLE "DrugMasterImportLog"
    ADD COLUMN "source_url" TEXT,
    ADD COLUMN "source_file_hash" TEXT;

CREATE INDEX "DrugMasterImportLog_source_source_file_hash_idx"
    ON "DrugMasterImportLog"("source", "source_file_hash");
