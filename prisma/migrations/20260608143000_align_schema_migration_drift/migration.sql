-- Align the migration-built database with the current Prisma schema.
-- The local E2E gate now uses migrate deploy instead of db push, so schema-only
-- drift must be represented by raw migrations as well.

-- Consent/template routing
ALTER TABLE "ConsentRecord"
  ADD COLUMN IF NOT EXISTS "template_id" TEXT,
  ADD COLUMN IF NOT EXISTS "template_version" INTEGER;

ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "target_role" TEXT,
  ADD COLUMN IF NOT EXISTS "format" TEXT NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "effective_from" DATE,
  ADD COLUMN IF NOT EXISTS "effective_to" DATE;

CREATE INDEX IF NOT EXISTS "Template_target_role_idx" ON "Template"("target_role");

ALTER TABLE "ConsentRecord"
  DROP CONSTRAINT IF EXISTS "ConsentRecord_template_id_fkey";
ALTER TABLE "ConsentRecord"
  ADD CONSTRAINT "ConsentRecord_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "Template"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Prescription intake classification
ALTER TABLE "PrescriptionIntake"
  ADD COLUMN IF NOT EXISTS "prescription_category" TEXT NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS "emergency_category" TEXT;

-- Document delivery settings
CREATE TABLE IF NOT EXISTS "DocumentDeliveryRule" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "target_role" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "fallback_channels" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentDeliveryRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DocumentDeliveryRule_org_id_idx" ON "DocumentDeliveryRule"("org_id");
CREATE INDEX IF NOT EXISTS "DocumentDeliveryRule_document_type_target_role_idx" ON "DocumentDeliveryRule"("document_type", "target_role");
CREATE INDEX IF NOT EXISTS "DocumentDeliveryRule_is_active_idx" ON "DocumentDeliveryRule"("is_active");

-- Push subscription storage
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_org_id_idx" ON "PushSubscription"("org_id");
CREATE INDEX IF NOT EXISTS "PushSubscription_user_id_idx" ON "PushSubscription"("user_id");

-- Internal comments and handoff board
CREATE TABLE IF NOT EXISTS "TaskComment" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TaskComment_org_id_idx" ON "TaskComment"("org_id");
CREATE INDEX IF NOT EXISTS "TaskComment_entity_type_entity_id_idx" ON "TaskComment"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "TaskComment_author_id_idx" ON "TaskComment"("author_id");

CREATE TABLE IF NOT EXISTS "HandoffBoard" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "shift_date" DATE NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffBoard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HandoffBoard_org_id_idx" ON "HandoffBoard"("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "HandoffBoard_org_id_shift_date_key" ON "HandoffBoard"("org_id", "shift_date");

CREATE TABLE IF NOT EXISTS "HandoffItem" (
    "id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_by" TEXT[],
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HandoffItem_board_id_idx" ON "HandoffItem"("board_id");

ALTER TABLE "HandoffItem"
  DROP CONSTRAINT IF EXISTS "HandoffItem_board_id_fkey";
ALTER TABLE "HandoffItem"
  ADD CONSTRAINT "HandoffItem_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "HandoffBoard"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Service areas
CREATE TABLE IF NOT EXISTS "ServiceArea" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area_type" TEXT NOT NULL,
    "geo_data" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ServiceArea_org_id_idx" ON "ServiceArea"("org_id");
CREATE INDEX IF NOT EXISTS "ServiceArea_site_id_idx" ON "ServiceArea"("site_id");
CREATE INDEX IF NOT EXISTS "ServiceArea_area_type_idx" ON "ServiceArea"("area_type");

ALTER TABLE "ServiceArea"
  DROP CONSTRAINT IF EXISTS "ServiceArea_org_id_fkey";
ALTER TABLE "ServiceArea"
  ADD CONSTRAINT "ServiceArea_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceArea"
  DROP CONSTRAINT IF EXISTS "ServiceArea_site_id_fkey";
ALTER TABLE "ServiceArea"
  ADD CONSTRAINT "ServiceArea_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Facility and professional alignment
ALTER TABLE "FacilityVisitBatch"
  ADD COLUMN IF NOT EXISTS "notes" TEXT;
CREATE INDEX IF NOT EXISTS "FacilityVisitBatch_facility_unit_id_idx" ON "FacilityVisitBatch"("facility_unit_id");

ALTER TABLE "FacilityContact"
  DROP CONSTRAINT IF EXISTS "FacilityContact_facility_id_fkey";
ALTER TABLE "FacilityContact"
  ADD CONSTRAINT "FacilityContact_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "Facility"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalProfessional"
  ADD COLUMN IF NOT EXISTS "facility_id" TEXT;
CREATE INDEX IF NOT EXISTS "ExternalProfessional_facility_id_idx" ON "ExternalProfessional"("facility_id");

ALTER TABLE "ExternalProfessional"
  DROP CONSTRAINT IF EXISTS "ExternalProfessional_facility_id_fkey";
ALTER TABLE "ExternalProfessional"
  ADD CONSTRAINT "ExternalProfessional_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "Facility"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Care report relation used by patient/detail and delivery flows
CREATE INDEX IF NOT EXISTS "CareReport_case_id_idx" ON "CareReport"("case_id");

ALTER TABLE "CareReport"
  DROP CONSTRAINT IF EXISTS "CareReport_case_id_fkey";
ALTER TABLE "CareReport"
  ADD CONSTRAINT "CareReport_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "CareCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Workflow transition log
CREATE TABLE IF NOT EXISTS "CycleTransitionLog" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleTransitionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CycleTransitionLog_org_id_idx" ON "CycleTransitionLog"("org_id");
CREATE INDEX IF NOT EXISTS "CycleTransitionLog_cycle_id_created_at_idx" ON "CycleTransitionLog"("cycle_id", "created_at");

ALTER TABLE "CycleTransitionLog"
  DROP CONSTRAINT IF EXISTS "CycleTransitionLog_cycle_id_fkey";
ALTER TABLE "CycleTransitionLog"
  ADD CONSTRAINT "CycleTransitionLog_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dispensing decision
CREATE TABLE IF NOT EXISTS "DispensingDecision" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "dispensing_method" TEXT,
    "packaging_method" "PackagingMethod",
    "packaging_instructions" TEXT,
    "packaging_instruction_tags" "PackagingInstructionTag"[] DEFAULT ARRAY[]::"PackagingInstructionTag"[],
    "packaging_group_id" TEXT,
    "carry_type_override" TEXT,
    "special_handling_notes" TEXT,
    "temperature_category" TEXT,
    "decided_by" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispensingDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DispensingDecision_task_id_line_id_key" ON "DispensingDecision"("task_id", "line_id");
CREATE INDEX IF NOT EXISTS "DispensingDecision_org_id_idx" ON "DispensingDecision"("org_id");
CREATE INDEX IF NOT EXISTS "DispensingDecision_task_id_idx" ON "DispensingDecision"("task_id");
CREATE INDEX IF NOT EXISTS "DispensingDecision_line_id_idx" ON "DispensingDecision"("line_id");

ALTER TABLE "DispensingDecision"
  DROP CONSTRAINT IF EXISTS "DispensingDecision_task_id_fkey";
ALTER TABLE "DispensingDecision"
  ADD CONSTRAINT "DispensingDecision_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "DispenseTask"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispensingDecision"
  DROP CONSTRAINT IF EXISTS "DispensingDecision_line_id_fkey";
ALTER TABLE "DispensingDecision"
  ADD CONSTRAINT "DispensingDecision_line_id_fkey"
  FOREIGN KEY ("line_id") REFERENCES "PrescriptionLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Performance indexes present in schema but missing from migration-built DB.
CREATE INDEX IF NOT EXISTS "VisitSchedule_org_id_scheduled_date_schedule_status_idx"
  ON "VisitSchedule"("org_id", "scheduled_date", "schedule_status");
CREATE INDEX IF NOT EXISTS "VisitSchedule_org_id_pharmacist_id_scheduled_date_idx"
  ON "VisitSchedule"("org_id", "pharmacist_id", "scheduled_date");

-- Keep expected generated index name for Prisma 7.
ALTER INDEX IF EXISTS "PharmacySiteInsuranceConfig_org_site_type_rev_key"
  RENAME TO "PharmacySiteInsuranceConfig_org_id_site_id_insurance_type_r_key";

-- Tenant isolation for newly materialized tables.
ALTER TABLE "DocumentDeliveryRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DocumentDeliveryRule";
CREATE POLICY tenant_isolation ON "DocumentDeliveryRule"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "DocumentDeliveryRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PushSubscription";
CREATE POLICY tenant_isolation ON "PushSubscription"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;

ALTER TABLE "TaskComment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TaskComment";
CREATE POLICY tenant_isolation ON "TaskComment"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "TaskComment" FORCE ROW LEVEL SECURITY;

ALTER TABLE "HandoffBoard" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HandoffBoard";
CREATE POLICY tenant_isolation ON "HandoffBoard"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "HandoffBoard" FORCE ROW LEVEL SECURITY;

ALTER TABLE "HandoffItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HandoffItem";
CREATE POLICY tenant_isolation ON "HandoffItem"
  USING (
    EXISTS (
      SELECT 1
      FROM "HandoffBoard"
      WHERE "HandoffBoard"."id" = "HandoffItem"."board_id"
        AND "HandoffBoard"."org_id" = public.app_enforced_org_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "HandoffBoard"
      WHERE "HandoffBoard"."id" = "HandoffItem"."board_id"
        AND "HandoffBoard"."org_id" = public.app_enforced_org_id()
    )
  );
ALTER TABLE "HandoffItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ServiceArea" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ServiceArea";
CREATE POLICY tenant_isolation ON "ServiceArea"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "ServiceArea" FORCE ROW LEVEL SECURITY;
