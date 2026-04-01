CREATE TYPE "PackagingInstructionTag" AS ENUM (
  'cold_storage',
  'narcotic',
  'half_tablet',
  'crush_prohibited',
  'separate_pack',
  'unit_dose',
  'staple_required',
  'label_required'
);

ALTER TABLE "PrescriptionLine"
ADD COLUMN "packaging_instruction_tags" "PackagingInstructionTag"[] DEFAULT ARRAY[]::"PackagingInstructionTag"[];

ALTER TABLE "SetPlan"
ADD COLUMN "packaging_method_id" TEXT,
ADD COLUMN "packaging_summary_snapshot" JSONB;

ALTER TABLE "SetBatch"
ADD COLUMN "packaging_instruction_tags_snapshot" "PackagingInstructionTag"[] DEFAULT ARRAY[]::"PackagingInstructionTag"[];

CREATE TABLE "SetBatchChangeLog" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "action" TEXT NOT NULL,
  "trigger_source" TEXT,
  "reason" TEXT,
  "line_ids" JSONB,
  "before_snapshot" JSONB NOT NULL,
  "after_snapshot" JSONB,
  "changed_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SetBatchChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SetPlan_packaging_method_id_idx" ON "SetPlan"("packaging_method_id");
CREATE INDEX "SetBatchChangeLog_org_id_idx" ON "SetBatchChangeLog"("org_id");
CREATE INDEX "SetBatchChangeLog_plan_id_created_at_idx" ON "SetBatchChangeLog"("plan_id", "created_at");
CREATE INDEX "SetBatchChangeLog_batch_id_idx" ON "SetBatchChangeLog"("batch_id");

ALTER TABLE "SetPlan"
ADD CONSTRAINT "SetPlan_packaging_method_id_fkey"
FOREIGN KEY ("packaging_method_id") REFERENCES "PackagingMethodMaster"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "SetBatchChangeLog"
ADD CONSTRAINT "SetBatchChangeLog_plan_id_fkey"
FOREIGN KEY ("plan_id") REFERENCES "SetPlan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "SetBatchChangeLog"
ADD CONSTRAINT "SetBatchChangeLog_batch_id_fkey"
FOREIGN KEY ("batch_id") REFERENCES "SetBatch"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
