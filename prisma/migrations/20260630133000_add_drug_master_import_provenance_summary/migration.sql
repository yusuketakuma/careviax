ALTER TABLE "DrugMasterImportLog"
    ADD COLUMN "source_published_at" DATE,
    ADD COLUMN "import_mode" TEXT,
    ADD COLUMN "change_summary" JSONB;

CREATE INDEX "DrugMasterImportLog_source_source_published_at_idx"
    ON "DrugMasterImportLog"("source", "source_published_at");

CREATE INDEX "DrugMasterImportLog_source_import_mode_idx"
    ON "DrugMasterImportLog"("source", "import_mode");
