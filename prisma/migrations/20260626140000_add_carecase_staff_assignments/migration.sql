-- Add primary/backup staff assignment columns to CareCase.
-- Nullable TEXT, mirroring the existing primary_pharmacist_id / backup_pharmacist_id columns.
-- Non-destructive: existing rows default to NULL (no assignment).
ALTER TABLE "CareCase" ADD COLUMN IF NOT EXISTS "primary_staff_id" TEXT;
ALTER TABLE "CareCase" ADD COLUMN IF NOT EXISTS "backup_staff_id" TEXT;
