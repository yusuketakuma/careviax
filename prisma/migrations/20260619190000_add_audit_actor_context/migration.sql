-- Add structured actor/patient context to application audit events.
-- `actor_pharmacy_id` represents the PH-OS tenant pharmacy and is currently
-- equivalent to `org_id`; `actor_site_id` is the viewer's current PharmacySite
-- when known.

ALTER TABLE "AuditLog"
  ADD COLUMN "actor_pharmacy_id" TEXT,
  ADD COLUMN "actor_site_id" TEXT,
  ADD COLUMN "patient_id" TEXT;

UPDATE "AuditLog"
SET "actor_pharmacy_id" = "org_id"
WHERE "actor_pharmacy_id" IS NULL;

UPDATE "AuditLog"
SET "actor_site_id" = NULLIF("changes"->>'actor_site_id', '')
WHERE "actor_site_id" IS NULL
  AND "changes" IS NOT NULL
  AND jsonb_typeof("changes") = 'object'
  AND NULLIF("changes"->>'actor_site_id', '') IS NOT NULL;

UPDATE "AuditLog"
SET "patient_id" = COALESCE(
  NULLIF("changes"->>'patient_id', ''),
  NULLIF("changes"->>'base_patient_id', '')
)
WHERE "patient_id" IS NULL
  AND "changes" IS NOT NULL
  AND jsonb_typeof("changes") = 'object'
  AND COALESCE(NULLIF("changes"->>'patient_id', ''), NULLIF("changes"->>'base_patient_id', '')) IS NOT NULL;

CREATE INDEX "AuditLog_org_actor_site_created_idx"
  ON "AuditLog"("org_id", "actor_site_id", "created_at");

CREATE INDEX "AuditLog_org_patient_created_idx"
  ON "AuditLog"("org_id", "patient_id", "created_at");

CREATE OR REPLACE FUNCTION ph_os_write_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor_id TEXT := NULLIF(current_setting('app.current_actor_id', true), '');
  v_member_role TEXT := NULLIF(current_setting('app.current_member_role', true), '');
  v_actor_pharmacy_id TEXT := NULLIF(current_setting('app.current_actor_pharmacy_id', true), '');
  v_actor_site_id TEXT := NULLIF(current_setting('app.current_actor_site_id', true), '');
  v_ip_address TEXT := NULLIF(current_setting('app.current_ip_address', true), '');
  v_user_agent TEXT := NULLIF(current_setting('app.current_user_agent', true), '');
  v_target_type TEXT := ph_os_to_snake_case(TG_TABLE_NAME);
  v_target_id TEXT;
  v_org_id TEXT;
  v_patient_id TEXT;
  v_changes JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_patient_id := NULLIF(to_jsonb(NEW)->>'patient_id', '');
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
    v_patient_id := NULLIF(to_jsonb(NEW)->>'patient_id', '');
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', to_jsonb(OLD),
      'after', to_jsonb(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_patient_id := NULLIF(to_jsonb(OLD)->>'patient_id', '');
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
  )
  VALUES (
    ph_os_generate_audit_log_id(),
    v_org_id,
    COALESCE(v_actor_id, 'system'),
    COALESCE(v_actor_pharmacy_id, v_org_id),
    v_actor_site_id,
    v_patient_id,
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
