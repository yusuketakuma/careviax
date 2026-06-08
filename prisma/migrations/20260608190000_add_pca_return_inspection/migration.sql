CREATE TYPE "PcaPumpReturnInspectionStatus" AS ENUM (
  'pending',
  'passed',
  'needs_maintenance'
);

ALTER TABLE "PcaPumpRental"
  ADD COLUMN "return_inspection_status" "PcaPumpReturnInspectionStatus",
  ADD COLUMN "return_inspection_notes" TEXT,
  ADD COLUMN "accessory_checklist" JSONB,
  ADD COLUMN "inspected_at" TIMESTAMP(3),
  ADD COLUMN "inspected_by" TEXT;

UPDATE "PcaPumpRental"
SET "return_inspection_status" = 'pending'
WHERE "status" = 'returned'
  AND "return_inspection_status" IS NULL;

ALTER TABLE "PcaPumpRental"
  ADD CONSTRAINT "PcaPumpRental_return_inspection_status_lifecycle_check"
    CHECK (
      ("status" = 'returned' AND "return_inspection_status" IS NOT NULL)
      OR ("status" <> 'returned' AND "return_inspection_status" IS NULL)
    ),
  ADD CONSTRAINT "PcaPumpRental_return_inspection_fields_returned_only_check"
    CHECK (
      "status" = 'returned'
      OR (
        "return_inspection_notes" IS NULL
        AND "accessory_checklist" IS NULL
        AND "inspected_at" IS NULL
        AND "inspected_by" IS NULL
      )
    ),
  ADD CONSTRAINT "PcaPumpRental_return_inspection_completed_audit_check"
    CHECK (
      "return_inspection_status" NOT IN ('passed', 'needs_maintenance')
      OR ("inspected_at" IS NOT NULL AND "inspected_by" IS NOT NULL)
    );

CREATE INDEX "PcaPumpRental_org_id_return_inspection_status_idx"
  ON "PcaPumpRental"("org_id", "return_inspection_status");
