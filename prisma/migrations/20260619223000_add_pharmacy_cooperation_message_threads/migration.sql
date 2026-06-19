-- Add v0.2 pharmacy cooperation message threads for patient-share cases and
-- visit requests. Message bodies are stored for authenticated in-app viewing
-- only; DB-triggered audit rows redact bodies to lengths/flags.

CREATE TYPE "PharmacyCooperationMessageThreadStatus" AS ENUM ('open', 'closed');
CREATE TYPE "PharmacyCooperationMessageContextType" AS ENUM ('patient_share_case', 'visit_request');
CREATE TYPE "PharmacyCooperationMessageSenderSide" AS ENUM ('base_pharmacy', 'partner_pharmacy');

CREATE TABLE "PharmacyCooperationMessageThread" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "share_case_id" TEXT NOT NULL,
  "visit_request_id" TEXT,
  "context_type" "PharmacyCooperationMessageContextType" NOT NULL DEFAULT 'patient_share_case',
  "status" "PharmacyCooperationMessageThreadStatus" NOT NULL DEFAULT 'open',
  "created_by" TEXT NOT NULL,
  "last_message_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PharmacyCooperationMessageThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyCooperationMessageThread_context_check" CHECK (
    ("context_type" = 'patient_share_case' AND "visit_request_id" IS NULL)
    OR ("context_type" = 'visit_request' AND "visit_request_id" IS NOT NULL)
  )
);

CREATE TABLE "PharmacyCooperationMessage" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "sender_user_id" TEXT NOT NULL,
  "sender_side" "PharmacyCooperationMessageSenderSide" NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PharmacyCooperationMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyCooperationMessage_body_length_check" CHECK (
    char_length(btrim("body")) BETWEEN 1 AND 4000
  )
);

CREATE UNIQUE INDEX "PharmacyCooperationMessageThread_id_org_id_key"
  ON "PharmacyCooperationMessageThread"("id", "org_id");

CREATE UNIQUE INDEX "PharmacyCooperationMessageThread_org_share_case_general_key"
  ON "PharmacyCooperationMessageThread"("org_id", "share_case_id")
  WHERE "visit_request_id" IS NULL;

CREATE UNIQUE INDEX "PharmacyCooperationMessageThread_org_visit_request_key"
  ON "PharmacyCooperationMessageThread"("org_id", "visit_request_id")
  WHERE "visit_request_id" IS NOT NULL;

CREATE INDEX "PharmacyCooperationMessageThread_org_id_idx"
  ON "PharmacyCooperationMessageThread"("org_id");

CREATE INDEX "PharmacyCooperationMessageThread_org_id_share_case_id_idx"
  ON "PharmacyCooperationMessageThread"("org_id", "share_case_id");

CREATE INDEX "PharmacyCooperationMessageThread_org_id_visit_request_id_idx"
  ON "PharmacyCooperationMessageThread"("org_id", "visit_request_id");

CREATE INDEX "PharmacyCooperationMessageThread_org_id_status_idx"
  ON "PharmacyCooperationMessageThread"("org_id", "status");

CREATE UNIQUE INDEX "PharmacyCooperationMessage_id_org_id_key"
  ON "PharmacyCooperationMessage"("id", "org_id");

CREATE INDEX "PharmacyCooperationMessage_org_id_idx"
  ON "PharmacyCooperationMessage"("org_id");

CREATE INDEX "PharmacyCooperationMessage_org_id_thread_id_created_at_idx"
  ON "PharmacyCooperationMessage"("org_id", "thread_id", "created_at");

CREATE INDEX "PharmacyCooperationMessage_org_id_sender_user_id_idx"
  ON "PharmacyCooperationMessage"("org_id", "sender_user_id");

ALTER TABLE "PharmacyCooperationMessageThread"
  ADD CONSTRAINT "PharmacyCooperationMessageThread_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PharmacyCooperationMessageThread"
  ADD CONSTRAINT "PharmacyCooperationMessageThread_share_case_id_org_id_fkey"
  FOREIGN KEY ("share_case_id", "org_id") REFERENCES "PatientShareCase"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PharmacyCooperationMessageThread"
  ADD CONSTRAINT "PharmacyCooperationMessageThread_visit_request_id_org_id_fkey"
  FOREIGN KEY ("visit_request_id", "org_id") REFERENCES "PharmacyVisitRequest"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PharmacyCooperationMessage"
  ADD CONSTRAINT "PharmacyCooperationMessage_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PharmacyCooperationMessage"
  ADD CONSTRAINT "PharmacyCooperationMessage_thread_id_org_id_fkey"
  FOREIGN KEY ("thread_id", "org_id") REFERENCES "PharmacyCooperationMessageThread"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PharmacyCooperationMessageThread" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyCooperationMessageThread";
CREATE POLICY tenant_isolation ON "PharmacyCooperationMessageThread"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyCooperationMessageThread" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyCooperationMessage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyCooperationMessage";
CREATE POLICY tenant_isolation ON "PharmacyCooperationMessage"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyCooperationMessage" FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ph_os_redact_pharmacy_cooperation_message_audit_row(
  audit_table_name TEXT,
  row_data JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    CASE audit_table_name
      WHEN 'PharmacyCooperationMessage' THEN
        row_data
          - 'body'
          || jsonb_build_object(
            'body_length', length(coalesce(row_data->>'body', '')),
            'has_body', coalesce(row_data->>'body', '') <> ''
          )
      ELSE row_data
    END
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_pharmacy_cooperation_message_audit_log()
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
  v_thread_id TEXT;
  v_share_case_id TEXT;
  v_patient_id TEXT;
  v_changes JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_thread_id := NULLIF(to_jsonb(NEW)->>'thread_id', '');
    v_share_case_id := NULLIF(to_jsonb(NEW)->>'share_case_id', '');
    v_changes := jsonb_build_object(
      'operation', 'INSERT',
      'after', ph_os_redact_pharmacy_cooperation_message_audit_row(TG_TABLE_NAME, to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_thread_id := NULLIF(to_jsonb(NEW)->>'thread_id', '');
    v_share_case_id := NULLIF(to_jsonb(NEW)->>'share_case_id', '');
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_pharmacy_cooperation_message_audit_row(TG_TABLE_NAME, to_jsonb(OLD)),
      'after', ph_os_redact_pharmacy_cooperation_message_audit_row(TG_TABLE_NAME, to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_thread_id := NULLIF(to_jsonb(OLD)->>'thread_id', '');
    v_share_case_id := NULLIF(to_jsonb(OLD)->>'share_case_id', '');
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_pharmacy_cooperation_message_audit_row(TG_TABLE_NAME, to_jsonb(OLD))
    );
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_org_id IS NULL OR v_target_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_share_case_id IS NULL AND v_thread_id IS NOT NULL THEN
    SELECT "share_case_id"
    INTO v_share_case_id
    FROM "PharmacyCooperationMessageThread"
    WHERE "id" = v_thread_id
      AND "org_id" = v_org_id;
  END IF;

  IF v_share_case_id IS NOT NULL THEN
    SELECT "base_patient_id"
    INTO v_patient_id
    FROM "PatientShareCase"
    WHERE "id" = v_share_case_id
      AND "org_id" = v_org_id;
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

DROP TRIGGER IF EXISTS audit_log_pharmacy_cooperation_message_thread ON "PharmacyCooperationMessageThread";
CREATE TRIGGER audit_log_pharmacy_cooperation_message_thread
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyCooperationMessageThread"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_cooperation_message_audit_log();

DROP TRIGGER IF EXISTS audit_log_pharmacy_cooperation_message ON "PharmacyCooperationMessage";
CREATE TRIGGER audit_log_pharmacy_cooperation_message
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyCooperationMessage"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_cooperation_message_audit_log();
