-- Migration: gender String → Gender enum
-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- AlterTable: convert existing string values, normalizing 'unknown' → 'other'
ALTER TABLE "Patient"
  ALTER COLUMN "gender" TYPE "Gender"
  USING (
    CASE gender
      WHEN 'male'    THEN 'male'::"Gender"
      WHEN 'female'  THEN 'female'::"Gender"
      ELSE                'other'::"Gender"
    END
  );
