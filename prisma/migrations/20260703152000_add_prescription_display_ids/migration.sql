-- Add nullable display IDs for prescription-domain wave 2 models.
-- Existing rows are backfilled by tools/scripts/backfill-display-ids.ts.

ALTER TABLE "MedicationCycle" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "MedicationCycle_org_id_display_id_key" ON "MedicationCycle"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CycleTransitionLog" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CycleTransitionLog_org_id_display_id_key" ON "CycleTransitionLog"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PrescriptionIntake" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PrescriptionIntake_org_id_display_id_key" ON "PrescriptionIntake"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PrescriptionLine" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PrescriptionLine_org_id_display_id_key" ON "PrescriptionLine"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "InquiryRecord" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "InquiryRecord_org_id_display_id_key" ON "InquiryRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "DispenseTask" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "DispenseTask_org_id_display_id_key" ON "DispenseTask"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "DispenseResult" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "DispenseResult_org_id_display_id_key" ON "DispenseResult"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "DispenseAudit" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "DispenseAudit_org_id_display_id_key" ON "DispenseAudit"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "DispensingDecision" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "DispensingDecision_org_id_display_id_key" ON "DispensingDecision"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "SetPlan" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "SetPlan_org_id_display_id_key" ON "SetPlan"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "SetBatch" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "SetBatch_org_id_display_id_key" ON "SetBatch"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "SetAudit" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "SetAudit_org_id_display_id_key" ON "SetAudit"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "SetBatchChangeLog" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "SetBatchChangeLog_org_id_display_id_key" ON "SetBatchChangeLog"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PackagingGroup" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PackagingGroup_org_id_display_id_key" ON "PackagingGroup"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CycleHold" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CycleHold_org_id_display_id_key" ON "CycleHold"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "WorkflowException" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "WorkflowException_org_id_display_id_key" ON "WorkflowException"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "QrScanDraft" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "QrScanDraft_org_id_display_id_key" ON "QrScanDraft"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "JahisSupplementalRecord" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "JahisSupplementalRecord_org_id_display_id_key" ON "JahisSupplementalRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
