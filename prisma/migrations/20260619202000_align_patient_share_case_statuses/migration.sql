ALTER TYPE "PatientShareCaseStatus" ADD VALUE IF NOT EXISTS 'consent_pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum enum_values
    JOIN pg_type enum_type ON enum_type.oid = enum_values.enumtypid
    WHERE enum_type.typname = 'PatientShareCaseStatus'
      AND enum_values.enumlabel = 'pending_partner'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum enum_values
    JOIN pg_type enum_type ON enum_type.oid = enum_values.enumtypid
    WHERE enum_type.typname = 'PatientShareCaseStatus'
      AND enum_values.enumlabel = 'partner_confirmation_pending'
  ) THEN
    ALTER TYPE "PatientShareCaseStatus" RENAME VALUE 'pending_partner' TO 'partner_confirmation_pending';
  END IF;
END $$;

ALTER TYPE "PatientShareCaseStatus" ADD VALUE IF NOT EXISTS 'partner_confirmation_pending';
ALTER TYPE "PatientShareCaseStatus" ADD VALUE IF NOT EXISTS 'declined';
