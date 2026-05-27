-- =============================================================================
-- PH-OS: DB-side audit logging for critical workflow tables
-- Context is injected by withOrgContext() via set_config():
--   app.current_org_id
--   app.current_actor_id
--   app.current_member_role
--   app.current_ip_address
--   app.current_user_agent
-- =============================================================================

CREATE OR REPLACE FUNCTION ph_os_to_snake_case(input_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(leading '_' FROM lower(regexp_replace(input_text, '([A-Z])', '_\1', 'g')));
$$;

CREATE OR REPLACE FUNCTION ph_os_generate_audit_log_id()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'c' || substring(md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text), 1, 24);
$$;

CREATE OR REPLACE FUNCTION ph_os_write_audit_log()
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
      'after', to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', to_jsonb(OLD),
      'after', to_jsonb(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', to_jsonb(OLD)
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

DROP TRIGGER IF EXISTS audit_log_patient ON "Patient";
CREATE TRIGGER audit_log_patient
AFTER INSERT OR UPDATE OR DELETE ON "Patient"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_care_case ON "CareCase";
CREATE TRIGGER audit_log_care_case
AFTER INSERT OR UPDATE OR DELETE ON "CareCase"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_consent_record ON "ConsentRecord";
CREATE TRIGGER audit_log_consent_record
AFTER INSERT OR UPDATE OR DELETE ON "ConsentRecord"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_management_plan ON "ManagementPlan";
CREATE TRIGGER audit_log_management_plan
AFTER INSERT OR UPDATE OR DELETE ON "ManagementPlan"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_visit_schedule ON "VisitSchedule";
CREATE TRIGGER audit_log_visit_schedule
AFTER INSERT OR UPDATE OR DELETE ON "VisitSchedule"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_visit_record ON "VisitRecord";
CREATE TRIGGER audit_log_visit_record
AFTER INSERT OR UPDATE OR DELETE ON "VisitRecord"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_communication_request ON "CommunicationRequest";
CREATE TRIGGER audit_log_communication_request
AFTER INSERT OR UPDATE OR DELETE ON "CommunicationRequest"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_care_report ON "CareReport";
CREATE TRIGGER audit_log_care_report
AFTER INSERT OR UPDATE OR DELETE ON "CareReport"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_external_access_grant ON "ExternalAccessGrant";
CREATE TRIGGER audit_log_external_access_grant
AFTER INSERT OR UPDATE OR DELETE ON "ExternalAccessGrant"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_workflow_exception ON "WorkflowException";
CREATE TRIGGER audit_log_workflow_exception
AFTER INSERT OR UPDATE OR DELETE ON "WorkflowException"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_task ON "Task";
CREATE TRIGGER audit_log_task
AFTER INSERT OR UPDATE OR DELETE ON "Task"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
