-- Redact patient-share consent row snapshots from DB-triggered audit rows.
-- App-level events keep searchable business metadata; this trigger prevents
-- consent person names, scope JSON, and linked document identifiers from
-- entering generic AuditLog exports.

CREATE OR REPLACE FUNCTION ph_os_redact_patient_share_consent_audit_row(row_data JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    row_data
      - 'consent_person'
      - 'consent_date'
      - 'scope'
      - 'file_asset_id'
      - 'consent_record_id'
      - 'valid_until'
      - 'revoked_at'
      || jsonb_build_object(
        'consent_person_length', length(coalesce(row_data->>'consent_person', '')),
        'has_consent_date', row_data->>'consent_date' IS NOT NULL,
        'scope_key_count',
          (
            SELECT count(*)
            FROM jsonb_object_keys(coalesce(row_data->'scope', '{}'::jsonb)) AS scope_key(key)
          ),
        'scope_keys',
          coalesce(
            (
              SELECT jsonb_agg(key ORDER BY key)
              FROM jsonb_object_keys(coalesce(row_data->'scope', '{}'::jsonb)) AS scope_key(key)
            ),
            '[]'::jsonb
          ),
        'has_file_asset', coalesce(row_data->>'file_asset_id', '') <> '',
        'has_consent_record', coalesce(row_data->>'consent_record_id', '') <> '',
        'has_valid_until', row_data->>'valid_until' IS NOT NULL,
        'has_revoked_at', row_data->>'revoked_at' IS NOT NULL
      )
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_patient_share_consent_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor_id TEXT := NULLIF(current_setting('app.current_actor_id', true), '');
  v_member_role TEXT := NULLIF(current_setting('app.current_member_role', true), '');
  v_ip_address TEXT := NULLIF(current_setting('app.current_ip_address', true), '');
  v_user_agent TEXT := NULLIF(current_setting('app.current_user_agent', true), '');
  v_target_type TEXT := ph_os_to_snake_case(TG_TABLE_NAME);
  v_target_id TEXT;
  v_org_id TEXT;
  v_changes JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'INSERT',
      'after', ph_os_redact_patient_share_consent_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_patient_share_consent_audit_row(to_jsonb(OLD)),
      'after', ph_os_redact_patient_share_consent_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_patient_share_consent_audit_row(to_jsonb(OLD))
    );
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_org_id IS NULL OR v_target_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO "AuditLog" (
    "id",
    "org_id",
    "actor_id",
    "action",
    "target_type",
    "target_id",
    "changes",
    "ip_address",
    "user_agent",
    "created_at",
    "updated_at"
  )
  VALUES (
    ph_os_generate_audit_log_id(),
    v_org_id,
    COALESCE(v_actor_id, 'system'),
    v_target_type || '.' ||
      CASE TG_OP
        WHEN 'INSERT' THEN 'create'
        WHEN 'UPDATE' THEN 'update'
        WHEN 'DELETE' THEN 'delete'
      END,
    v_target_type,
    v_target_id,
    jsonb_strip_nulls(v_changes || jsonb_build_object('actor_role', v_member_role)),
    v_ip_address,
    v_user_agent,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_log_patient_share_consent ON "PatientShareConsent";
CREATE TRIGGER audit_log_patient_share_consent
AFTER INSERT OR UPDATE OR DELETE ON "PatientShareConsent"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_patient_share_consent_audit_log();
