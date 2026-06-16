-- Enforce patient foundation primary-record invariants under concurrent writes.
-- Keep the newest primary row if historical duplicate rows already exist.

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "org_id", "patient_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "ContactParty"
  WHERE "is_primary" IS TRUE
)
UPDATE "ContactParty" contact
SET
  "is_primary" = false,
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE contact."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX "ContactParty_one_primary_per_patient_idx"
  ON "ContactParty"("org_id", "patient_id")
  WHERE "is_primary" IS TRUE;

UPDATE "CareTeamLink"
SET
  "role" = CASE
    WHEN "role" IN ('doctor', 'clinic', 'prescriber') THEN 'physician'
    WHEN "role" IN ('visiting_nurse', 'home_nurse') THEN 'nurse'
    WHEN "role" IN ('caremanager', 'cm') THEN 'care_manager'
    ELSE "role"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "role" IN (
  'doctor',
  'clinic',
  'prescriber',
  'visiting_nurse',
  'home_nurse',
  'caremanager',
  'cm'
);

ALTER TABLE "CareTeamLink"
ADD CONSTRAINT "CareTeamLink_role_canonical_check"
CHECK ("role" IN ('physician', 'nurse', 'care_manager', 'pharmacist', 'other'))
NOT VALID;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "org_id", "case_id", "role"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "CareTeamLink"
  WHERE "is_primary" IS TRUE
)
UPDATE "CareTeamLink" link
SET
  "is_primary" = false,
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE link."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX "CareTeamLink_one_primary_per_case_role_idx"
  ON "CareTeamLink"("org_id", "case_id", "role")
  WHERE "is_primary" IS TRUE;
