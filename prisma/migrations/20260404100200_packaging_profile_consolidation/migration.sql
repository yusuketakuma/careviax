-- Migration: Consolidate Patient.packaging_preferences → PatientPackagingProfile
-- Step 1: Add new columns to PatientPackagingProfile
ALTER TABLE "PatientPackagingProfile"
  ADD COLUMN "box_config"           JSONB,
  ADD COLUMN "special_instructions" TEXT,
  ADD COLUMN "cognitive_note"       TEXT;

-- Step 2: Backfill from Patient.packaging_preferences JSON into PatientPackagingProfile
-- For existing patients that have packaging_preferences, upsert the profile
INSERT INTO "PatientPackagingProfile" (
  "id", "org_id", "patient_id",
  "box_config", "special_instructions", "cognitive_note",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  p.org_id,
  p.id,
  CASE
    WHEN p.packaging_preferences IS NOT NULL AND (p.packaging_preferences->>'box_config') IS NOT NULL
    THEN (p.packaging_preferences->'box_config')
    ELSE NULL
  END,
  p.packaging_preferences->>'special_instructions',
  p.packaging_preferences->>'cognitive_note',
  NOW(),
  NOW()
FROM "Patient" p
WHERE
  p.packaging_preferences IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PatientPackagingProfile" pp WHERE pp.patient_id = p.id
  )
ON CONFLICT DO NOTHING;

-- For existing profiles, merge in missing fields from Patient.packaging_preferences
UPDATE "PatientPackagingProfile" pp
SET
  box_config = COALESCE(
    pp.box_config,
    CASE
      WHEN p.packaging_preferences IS NOT NULL AND (p.packaging_preferences->>'box_config') IS NOT NULL
      THEN (p.packaging_preferences->'box_config')
      ELSE NULL
    END
  ),
  special_instructions = COALESCE(
    pp.special_instructions,
    p.packaging_preferences->>'special_instructions'
  ),
  cognitive_note = COALESCE(
    pp.cognitive_note,
    p.packaging_preferences->>'cognitive_note'
  ),
  updated_at = NOW()
FROM "Patient" p
WHERE pp.patient_id = p.id
  AND p.packaging_preferences IS NOT NULL;

-- Step 3: Drop the old column from Patient
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "packaging_preferences";
