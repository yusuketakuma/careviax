-- DispenseResult: add version for optimistic locking
ALTER TABLE "DispenseResult" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- PrescriptionLine: add packaging group
ALTER TABLE "PrescriptionLine" ADD COLUMN "packaging_group_id" TEXT;

-- SetBatch: add packaging group
ALTER TABLE "SetBatch" ADD COLUMN "packaging_group_id" TEXT;
