-- Preserve previous-prescription reuse provenance for newly created lines.
-- Existing rows stay NULL; source boundary validation is enforced in the write service.
ALTER TABLE "PrescriptionLine"
  ADD COLUMN "source_intake_id" TEXT,
  ADD COLUMN "source_line_id" TEXT,
  ADD COLUMN "source_intake_updated_at_snapshot" TIMESTAMP(3),
  ADD COLUMN "source_line_updated_at_snapshot" TIMESTAMP(3);

CREATE INDEX "PrescriptionLine_source_intake_id_idx"
  ON "PrescriptionLine"("source_intake_id");

CREATE INDEX "PrescriptionLine_source_line_id_idx"
  ON "PrescriptionLine"("source_line_id");
