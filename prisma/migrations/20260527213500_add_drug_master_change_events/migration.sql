-- Store import-time master deltas that can be reviewed against adopted drugs.
CREATE TABLE "DrugMasterChangeEvent" (
  "id" TEXT NOT NULL,
  "import_log_id" TEXT,
  "source" "ImportSource" NOT NULL,
  "yj_code" TEXT NOT NULL,
  "drug_master_id" TEXT,
  "change_type" TEXT NOT NULL,
  "previous_value" JSONB,
  "current_value" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DrugMasterChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DrugMasterChangeEvent_source_created_at_idx"
  ON "DrugMasterChangeEvent"("source", "created_at");

CREATE INDEX "DrugMasterChangeEvent_yj_code_idx"
  ON "DrugMasterChangeEvent"("yj_code");

CREATE INDEX "DrugMasterChangeEvent_change_type_idx"
  ON "DrugMasterChangeEvent"("change_type");
