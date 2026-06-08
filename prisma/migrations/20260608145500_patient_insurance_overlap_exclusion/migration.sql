-- Serialize PatientInsurance active validity overlap at the database level.
-- The trigger gives a readable error, while this exclusion constraint closes
-- the concurrent insert/update race that trigger-only checks cannot see.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  overlap_count integer;
BEGIN
  SELECT COUNT(*)::int
    INTO overlap_count
  FROM "PatientInsurance" AS a
  JOIN "PatientInsurance" AS b
    ON a.id < b.id
   AND a.org_id = b.org_id
   AND a.patient_id = b.patient_id
   AND a.insurance_type = b.insurance_type
   AND COALESCE(a.public_program_code, '') = COALESCE(b.public_program_code, '')
   AND a.is_active IS TRUE
   AND b.is_active IS TRUE
   AND daterange(
     COALESCE(a.valid_from, '-infinity'::date),
     COALESCE(a.valid_until, 'infinity'::date),
     '[]'
   ) && daterange(
     COALESCE(b.valid_from, '-infinity'::date),
     COALESCE(b.valid_until, 'infinity'::date),
     '[]'
   );

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'Cannot add PatientInsurance overlap exclusion constraint; % overlapping active rows exist', overlap_count
      USING ERRCODE = '23P01';
  END IF;
END;
$$;

ALTER TABLE "PatientInsurance"
ADD CONSTRAINT "PatientInsurance_active_validity_no_overlap"
EXCLUDE USING gist (
  org_id WITH =,
  patient_id WITH =,
  insurance_type WITH =,
  (COALESCE(public_program_code, '')) WITH =,
  (daterange(
    COALESCE(valid_from, '-infinity'::date),
    COALESCE(valid_until, 'infinity'::date),
    '[]'
  )) WITH &&
)
WHERE (is_active IS TRUE);
