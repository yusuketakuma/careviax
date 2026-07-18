-- Replace the generic full-row ManagementPlan audit trigger with a PHI-minimized projection.
-- This migration is forward-only: never restore ph_os_write_audit_log() for ManagementPlan.

CREATE OR REPLACE FUNCTION ph_os_write_management_plan_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_old JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_org_id TEXT := v_row->>'org_id';
  v_case_id TEXT := v_row->>'case_id';
  v_target_id TEXT := v_row->>'id';
  v_patient_id TEXT;
  v_actor_id TEXT := NULLIF(current_setting('app.current_actor_id', true), '');
  v_member_role TEXT := NULLIF(current_setting('app.current_member_role', true), '');
  v_actor_pharmacy_id TEXT := NULLIF(current_setting('app.current_actor_pharmacy_id', true), '');
  v_actor_site_id TEXT := NULLIF(current_setting('app.current_actor_site_id', true), '');
  v_ip_address TEXT := NULLIF(current_setting('app.current_ip_address', true), '');
  v_user_agent TEXT := NULLIF(current_setting('app.current_user_agent', true), '');
  v_request_id TEXT := NULLIF(current_setting('app.current_request_id', true), '');
  v_correlation_id TEXT := NULLIF(current_setting('app.current_correlation_id', true), '');
  v_action TEXT;
  v_changed_fields JSONB := '[]'::jsonb;
  v_changes JSONB;
BEGIN
  SELECT "patient_id"
  INTO v_patient_id
  FROM "CareCase"
  WHERE "id" = v_case_id
    AND "org_id" = v_org_id;

  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'ManagementPlan audit patient resolution failed';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'management_plan.create';
    v_changed_fields := '["title","summary","content","effective_from","next_review_date","status"]'::jsonb;
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_old IS NOT DISTINCT FROM v_new THEN
      RETURN NEW;
    END IF;
    v_action := CASE
      WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'archived'
        THEN 'management_plan.archive'
      ELSE 'management_plan.update'
    END;
    SELECT COALESCE(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
    INTO v_changed_fields
    FROM unnest(ARRAY[
      'title', 'summary', 'content', 'effective_from', 'next_review_date', 'status'
    ]) AS fields(field_name)
    WHERE v_old->field_name IS DISTINCT FROM v_new->field_name;
  ELSE
    v_action := 'management_plan.delete';
  END IF;

  v_changes := jsonb_strip_nulls(jsonb_build_object(
    'operation', TG_OP,
    'actor_role', v_member_role,
    'case_id', v_case_id,
    'version', (v_row->>'version')::integer,
    'status_before', v_old->>'status',
    'status_after', v_new->>'status',
    'changed_fields', v_changed_fields,
    'updated_at_before', v_old->>'updated_at',
    'updated_at_after', v_new->>'updated_at',
    'request_trace', CASE
      WHEN v_request_id IS NULL AND v_correlation_id IS NULL THEN NULL
      ELSE jsonb_strip_nulls(jsonb_build_object(
        'request_id', v_request_id,
        'correlation_id', v_correlation_id
      ))
    END
  ));

  INSERT INTO "AuditLog" (
    "id",
    "org_id",
    "actor_id",
    "actor_pharmacy_id",
    "actor_site_id",
    "patient_id",
    "action",
    "target_type",
    "target_id",
    "changes",
    "ip_address",
    "user_agent",
    "created_at",
    "updated_at"
  ) VALUES (
    ph_os_generate_audit_log_id(),
    v_org_id,
    COALESCE(v_actor_id, 'system'),
    COALESCE(v_actor_pharmacy_id, v_org_id),
    v_actor_site_id,
    v_patient_id,
    v_action,
    'management_plan',
    v_target_id,
    v_changes,
    v_ip_address,
    v_user_agent,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_log_management_plan ON "ManagementPlan";
CREATE TRIGGER audit_log_management_plan
AFTER INSERT OR UPDATE OR DELETE ON "ManagementPlan"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_management_plan_audit_log();
