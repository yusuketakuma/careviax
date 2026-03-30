ALTER TYPE "PatientContactStatus" ADD VALUE IF NOT EXISTS 'change_requested';

ALTER TABLE "VisitScheduleContactLog"
ADD COLUMN "contact_method" TEXT;
