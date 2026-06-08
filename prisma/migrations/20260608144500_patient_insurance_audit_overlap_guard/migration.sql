-- Patient insurance drives billing eligibility. Guard auditability and prevent
-- concurrent active overlap that app-layer checks cannot fully serialize.

DROP TRIGGER IF EXISTS audit_log_patient_insurance ON "PatientInsurance";
CREATE TRIGGER audit_log_patient_insurance
AFTER INSERT OR UPDATE OR DELETE ON "PatientInsurance"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

CREATE OR REPLACE FUNCTION ph_os_prevent_patient_insurance_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_id TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT existing.id
    INTO conflicting_id
  FROM "PatientInsurance" AS existing
  WHERE existing.id <> NEW.id
    AND existing.org_id = NEW.org_id
    AND existing.patient_id = NEW.patient_id
    AND existing.insurance_type = NEW.insurance_type
    AND existing.is_active IS TRUE
    AND COALESCE(existing.public_program_code, '') = COALESCE(NEW.public_program_code, '')
    AND daterange(
      COALESCE(existing.valid_from, '-infinity'::date),
      COALESCE(existing.valid_until, 'infinity'::date),
      '[]'
    ) && daterange(
      COALESCE(NEW.valid_from, '-infinity'::date),
      COALESCE(NEW.valid_until, 'infinity'::date),
      '[]'
    )
  LIMIT 1;

  IF conflicting_id IS NOT NULL THEN
    RAISE EXCEPTION 'PatientInsurance active validity periods must not overlap'
      USING
        ERRCODE = '23P01',
        DETAIL = format('conflicting PatientInsurance id: %s', conflicting_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_patient_insurance_overlap ON "PatientInsurance";
CREATE TRIGGER prevent_patient_insurance_overlap
BEFORE INSERT OR UPDATE OF
  org_id,
  patient_id,
  insurance_type,
  public_program_code,
  valid_from,
  valid_until,
  is_active
ON "PatientInsurance"
FOR EACH ROW EXECUTE FUNCTION ph_os_prevent_patient_insurance_overlap();
