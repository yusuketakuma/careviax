ALTER TYPE "PharmacyVisitRequestStatus" RENAME TO "PharmacyVisitRequestStatus_old";

CREATE TYPE "PharmacyVisitRequestStatus" AS ENUM (
  'draft',
  'requested',
  'accepted',
  'declined',
  'scheduled',
  'visited',
  'recording',
  'submitted',
  'base_reviewing',
  'returned',
  'confirmed',
  'physician_report_created',
  'claim_checked',
  'completed'
);

ALTER TABLE "PharmacyVisitRequest" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "PharmacyVisitRequest"
  ALTER COLUMN "status" TYPE "PharmacyVisitRequestStatus"
  USING (
    CASE "status"::text
      WHEN 'cancelled' THEN 'declined'
      WHEN 'expired' THEN 'declined'
      ELSE "status"::text
    END
  )::"PharmacyVisitRequestStatus";

ALTER TABLE "PharmacyVisitRequest" ALTER COLUMN "status" SET DEFAULT 'draft';

DROP TYPE "PharmacyVisitRequestStatus_old";
