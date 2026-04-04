-- Migration: Patient soft-delete (archive) columns

ALTER TABLE "Patient"
    ADD COLUMN "archived_at" TIMESTAMP(3),
    ADD COLUMN "archived_by" TEXT;

-- Index for efficient filtering of active patients
CREATE INDEX "Patient_archived_at_idx" ON "Patient"("archived_at");
