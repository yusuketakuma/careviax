-- INB-001 Phase 2: formal inbound interprofessional communication source tables.
--
-- This migration adds append-only-ish source records for information arriving
-- from other professions into the pharmacy workflow. Raw text is kept only in
-- InboundCommunicationEvent; list/timeline/notification/report DTOs must keep
-- using summary/signal presenters.

CREATE TYPE "InboundCommunicationSourceChannel" AS ENUM (
  'mcs',
  'phone',
  'fax',
  'email',
  'in_person',
  'patient_family',
  'facility_note',
  'external_api',
  'manual',
  'unknown'
);

CREATE TYPE "InboundCommunicationSenderRole" AS ENUM (
  'nurse',
  'care_manager',
  'physician',
  'dentist',
  'therapist',
  'facility_staff',
  'family',
  'patient',
  'pharmacist',
  'admin',
  'unknown'
);

CREATE TYPE "InboundCommunicationEventType" AS ENUM (
  'medication_stock_report',
  'medication_usage_report',
  'medication_question',
  'symptom_report',
  'side_effect_report',
  'adherence_problem',
  'care_update',
  'schedule_request',
  'prescription_instruction',
  'urgent_contact',
  'general_note'
);

CREATE TYPE "InboundCommunicationConfidence" AS ENUM ('high', 'medium', 'low', 'unknown');

CREATE TYPE "InboundCommunicationProcessingStatus" AS ENUM (
  'unprocessed',
  'signals_extracted',
  'reviewed',
  'converted_to_task',
  'linked_to_workflow',
  'ignored'
);

CREATE TYPE "InboundSignalDomain" AS ENUM (
  'medication_stock',
  'medication_safety',
  'adherence',
  'symptom',
  'schedule',
  'report',
  'care_coordination',
  'urgent',
  'other'
);

CREATE TYPE "InboundSignalType" AS ENUM (
  'observed_quantity',
  'usage_delta',
  'usage_frequency',
  'low_stock_text',
  'out_of_stock_text',
  'refill_request',
  'side_effect_suspected',
  'medication_not_taken',
  'medication_overuse',
  'medication_lost',
  'storage_issue',
  'schedule_change_request',
  'visit_request',
  'urgent_review_required',
  'unknown'
);

CREATE TYPE "InboundSignalSourceConfidence" AS ENUM (
  'structured_exact',
  'structured_partial',
  'text_parsed_high',
  'text_parsed_low',
  'manual',
  'unknown'
);

CREATE TYPE "InboundSignalReviewStatus" AS ENUM (
  'needs_review',
  'auto_accepted',
  'accepted',
  'rejected',
  'record_only',
  'superseded'
);

CREATE TYPE "InboundSignalActionStatus" AS ENUM (
  'not_linked',
  'linked_to_stock_event',
  'linked_to_task',
  'linked_to_schedule',
  'linked_to_report',
  'linked_to_visit_brief',
  'ignored'
);

CREATE TYPE "InboundCommunicationAttachmentType" AS ENUM (
  'mcs_image',
  'medication_photo',
  'fax_image',
  'document',
  'screenshot',
  'other'
);

CREATE TYPE "InboundSourceMappingStatus" AS ENUM ('active', 'needs_review', 'inactive');
CREATE TYPE "InboundSourceMappingConfidence" AS ENUM ('exact', 'probable', 'manual', 'unknown');

CREATE TABLE "InboundCommunicationEvent" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT,
  "case_id" TEXT,
  "source_channel" "InboundCommunicationSourceChannel" NOT NULL,
  "source_system" TEXT,
  "external_thread_id" TEXT,
  "external_message_id" TEXT,
  "external_url" TEXT,
  "direction" TEXT NOT NULL DEFAULT 'inbound',
  "sender_name" TEXT,
  "sender_role" "InboundCommunicationSenderRole" NOT NULL DEFAULT 'unknown',
  "sender_organization_name" TEXT,
  "sender_contact" TEXT,
  "event_type" "InboundCommunicationEventType" NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurred_at" TIMESTAMP(3),
  "raw_text" TEXT NOT NULL,
  "normalized_summary" TEXT,
  "attachment_count" INTEGER NOT NULL DEFAULT 0,
  "has_medication_stock_signal" BOOLEAN NOT NULL DEFAULT false,
  "has_patient_safety_signal" BOOLEAN NOT NULL DEFAULT false,
  "has_schedule_signal" BOOLEAN NOT NULL DEFAULT false,
  "has_report_signal" BOOLEAN NOT NULL DEFAULT false,
  "confidence" "InboundCommunicationConfidence" NOT NULL DEFAULT 'unknown',
  "processing_status" "InboundCommunicationProcessingStatus" NOT NULL DEFAULT 'unprocessed',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InboundCommunicationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InboundCommunicationEvent_direction_inbound_chk" CHECK ("direction" = 'inbound'),
  CONSTRAINT "InboundCommunicationEvent_attachment_count_nonnegative_chk" CHECK ("attachment_count" >= 0)
);

CREATE TABLE "InboundCommunicationSignal" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT,
  "case_id" TEXT,
  "inbound_event_id" TEXT NOT NULL,
  "signal_index" INTEGER NOT NULL,
  "signal_domain" "InboundSignalDomain" NOT NULL,
  "signal_type" "InboundSignalType" NOT NULL,
  "extracted_text" TEXT,
  "extracted_medication_name" TEXT,
  "extracted_quantity" DOUBLE PRECISION,
  "extracted_unit" TEXT,
  "extracted_occurred_at" TIMESTAMP(3),
  "structured_payload" JSONB,
  "source_confidence" "InboundSignalSourceConfidence" NOT NULL DEFAULT 'unknown',
  "review_status" "InboundSignalReviewStatus" NOT NULL DEFAULT 'needs_review',
  "action_status" "InboundSignalActionStatus" NOT NULL DEFAULT 'not_linked',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InboundCommunicationSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InboundCommunicationSignal_signal_index_nonnegative_chk" CHECK ("signal_index" >= 0)
);

CREATE TABLE "InboundCommunicationAttachment" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "inbound_event_id" TEXT NOT NULL,
  "signal_id" TEXT,
  "file_asset_id" TEXT NOT NULL,
  "attachment_type" "InboundCommunicationAttachmentType" NOT NULL DEFAULT 'other',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InboundCommunicationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundSourceMapping" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "source_system" "InboundCommunicationSourceChannel" NOT NULL,
  "external_patient_label" TEXT,
  "external_thread_id" TEXT,
  "external_room_id" TEXT,
  "external_contact_name" TEXT,
  "external_contact_role" TEXT,
  "external_organization_name" TEXT,
  "mapping_status" "InboundSourceMappingStatus" NOT NULL DEFAULT 'needs_review',
  "confidence" "InboundSourceMappingConfidence" NOT NULL DEFAULT 'unknown',
  "created_by" TEXT NOT NULL,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InboundSourceMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundCommunicationEvent_org_id_display_id_key"
  ON "InboundCommunicationEvent"("org_id", "display_id");
CREATE UNIQUE INDEX "InboundCommunicationEvent_id_org_id_key"
  ON "InboundCommunicationEvent"("id", "org_id");
CREATE UNIQUE INDEX "InboundCommunicationEvent_org_source_message_key"
  ON "InboundCommunicationEvent"("org_id", "source_system", "external_message_id");
CREATE INDEX "InboundCommunicationEvent_org_id_idx" ON "InboundCommunicationEvent"("org_id");
CREATE INDEX "InboundCommunicationEvent_org_processing_received_idx"
  ON "InboundCommunicationEvent"("org_id", "processing_status", "received_at");
CREATE INDEX "InboundCommunicationEvent_org_patient_received_idx"
  ON "InboundCommunicationEvent"("org_id", "patient_id", "received_at");
CREATE INDEX "InboundCommunicationEvent_org_case_received_idx"
  ON "InboundCommunicationEvent"("org_id", "case_id", "received_at");
CREATE INDEX "InboundCommunicationEvent_org_source_received_idx"
  ON "InboundCommunicationEvent"("org_id", "source_channel", "received_at");
CREATE INDEX "InboundCommunicationEvent_org_type_received_idx"
  ON "InboundCommunicationEvent"("org_id", "event_type", "received_at");
CREATE INDEX "InboundCommunicationEvent_org_external_thread_idx"
  ON "InboundCommunicationEvent"("org_id", "external_thread_id");

CREATE UNIQUE INDEX "InboundCommunicationSignal_org_id_display_id_key"
  ON "InboundCommunicationSignal"("org_id", "display_id");
CREATE UNIQUE INDEX "InboundCommunicationSignal_id_org_id_key"
  ON "InboundCommunicationSignal"("id", "org_id");
CREATE UNIQUE INDEX "InboundCommunicationSignal_org_event_index_key"
  ON "InboundCommunicationSignal"("org_id", "inbound_event_id", "signal_index");
CREATE INDEX "InboundCommunicationSignal_org_id_idx" ON "InboundCommunicationSignal"("org_id");
CREATE INDEX "InboundCommunicationSignal_org_review_created_idx"
  ON "InboundCommunicationSignal"("org_id", "review_status", "created_at");
CREATE INDEX "InboundCommunicationSignal_org_action_created_idx"
  ON "InboundCommunicationSignal"("org_id", "action_status", "created_at");
CREATE INDEX "InboundCommunicationSignal_org_patient_created_idx"
  ON "InboundCommunicationSignal"("org_id", "patient_id", "created_at");
CREATE INDEX "InboundCommunicationSignal_org_case_created_idx"
  ON "InboundCommunicationSignal"("org_id", "case_id", "created_at");
CREATE INDEX "InboundCommunicationSignal_org_domain_review_idx"
  ON "InboundCommunicationSignal"("org_id", "signal_domain", "review_status");
CREATE INDEX "InboundCommunicationSignal_org_type_review_idx"
  ON "InboundCommunicationSignal"("org_id", "signal_type", "review_status");

CREATE UNIQUE INDEX "InboundCommunicationAttachment_id_org_id_key"
  ON "InboundCommunicationAttachment"("id", "org_id");
CREATE INDEX "InboundCommunicationAttachment_org_id_idx" ON "InboundCommunicationAttachment"("org_id");
CREATE INDEX "InboundCommunicationAttachment_org_event_idx"
  ON "InboundCommunicationAttachment"("org_id", "inbound_event_id");
CREATE INDEX "InboundCommunicationAttachment_org_signal_idx"
  ON "InboundCommunicationAttachment"("org_id", "signal_id");
CREATE INDEX "InboundCommunicationAttachment_org_file_asset_idx"
  ON "InboundCommunicationAttachment"("org_id", "file_asset_id");

CREATE UNIQUE INDEX "InboundSourceMapping_org_id_display_id_key"
  ON "InboundSourceMapping"("org_id", "display_id");
CREATE INDEX "InboundSourceMapping_org_id_idx" ON "InboundSourceMapping"("org_id");
CREATE INDEX "InboundSourceMapping_org_patient_idx" ON "InboundSourceMapping"("org_id", "patient_id");
CREATE INDEX "InboundSourceMapping_org_case_idx" ON "InboundSourceMapping"("org_id", "case_id");
CREATE INDEX "InboundSourceMapping_org_source_thread_idx"
  ON "InboundSourceMapping"("org_id", "source_system", "external_thread_id");
CREATE INDEX "InboundSourceMapping_org_source_room_idx"
  ON "InboundSourceMapping"("org_id", "source_system", "external_room_id");
CREATE INDEX "InboundSourceMapping_org_status_idx"
  ON "InboundSourceMapping"("org_id", "mapping_status");

ALTER TABLE "InboundCommunicationSignal"
  ADD CONSTRAINT "InboundCommunicationSignal_event_fkey"
  FOREIGN KEY ("inbound_event_id", "org_id")
  REFERENCES "InboundCommunicationEvent"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundCommunicationAttachment"
  ADD CONSTRAINT "InboundCommunicationAttachment_event_fkey"
  FOREIGN KEY ("inbound_event_id", "org_id")
  REFERENCES "InboundCommunicationEvent"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundCommunicationAttachment"
  ADD CONSTRAINT "InboundCommunicationAttachment_signal_fkey"
  FOREIGN KEY ("signal_id")
  REFERENCES "InboundCommunicationSignal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InboundCommunicationEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InboundCommunicationEvent";
CREATE POLICY tenant_isolation ON "InboundCommunicationEvent"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "InboundCommunicationEvent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "InboundCommunicationSignal" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InboundCommunicationSignal";
CREATE POLICY tenant_isolation ON "InboundCommunicationSignal"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "InboundCommunicationSignal" FORCE ROW LEVEL SECURITY;

ALTER TABLE "InboundCommunicationAttachment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InboundCommunicationAttachment";
CREATE POLICY tenant_isolation ON "InboundCommunicationAttachment"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "InboundCommunicationAttachment" FORCE ROW LEVEL SECURITY;

ALTER TABLE "InboundSourceMapping" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InboundSourceMapping";
CREATE POLICY tenant_isolation ON "InboundSourceMapping"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "InboundSourceMapping" FORCE ROW LEVEL SECURITY;
