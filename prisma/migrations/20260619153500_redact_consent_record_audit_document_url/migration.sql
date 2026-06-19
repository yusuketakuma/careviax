-- Redact consent document URLs from DB-triggered ConsentRecord audit rows.
-- App-level consent audit events carry the searchable business metadata; this
-- trigger remains a compact row-change safety net without document links.

CREATE OR REPLACE FUNCTION ph_os_redact_consent_record_audit_row(row_data JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    row_data
      - 'document_url'
      - 'obtained_date'
      - 'expiry_date'
      - 'revoked_date'
      || jsonb_build_object(
        'has_document_url', coalesce(row_data->>'document_url', '') <> '',
        'document_url_audited',
          coalesce(row_data->>'document_url', '') LIKE '/api/files/%/presigned-download%',
        'document_url_redacted', coalesce(row_data->>'document_url', '') <> '',
        'document_source',
          CASE
            WHEN coalesce(row_data->>'document_url', '') = '' THEN 'none'
            WHEN coalesce(row_data->>'document_url', '') LIKE '/api/files/%/presigned-download%' THEN 'audited_url'
            ELSE 'legacy_redacted'
          END,
        'has_obtained_date', row_data->>'obtained_date' IS NOT NULL,
        'has_expiry_date', row_data->>'expiry_date' IS NOT NULL,
        'has_revoked_date', row_data->>'revoked_date' IS NOT NULL
      )
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_consent_record_audit_log()
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
      'after', ph_os_redact_consent_record_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_consent_record_audit_row(to_jsonb(OLD)),
      'after', ph_os_redact_consent_record_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_consent_record_audit_row(to_jsonb(OLD))
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

DROP TRIGGER IF EXISTS audit_log_consent_record ON "ConsentRecord";
CREATE TRIGGER audit_log_consent_record
AFTER INSERT OR UPDATE OR DELETE ON "ConsentRecord"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_consent_record_audit_log();
