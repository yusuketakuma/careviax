-- PRE-RELEASE DESTRUCTIVE-READY FOUNDATION ONLY.
-- This migration authors the new yrese / JP Core / FHIR-ready integration spine.
-- It must not be applied to production or any persistent clinical database without an explicit gate.

CREATE TYPE "ClinicalExternalSystemType" AS ENUM (
  'yrese_fhir',
  'yrese_pharmacy_api',
  'yrese_webhook',
  'official_adapter',
  'bulk_export',
  'manual_import'
);

CREATE TYPE "ClinicalExternalSystemStatus" AS ENUM ('draft', 'active', 'paused', 'disabled');

CREATE TYPE "ClinicalFhirResourceType" AS ENUM (
  'patient',
  'coverage',
  'medication',
  'medication_request',
  'medication_dispense',
  'medication_statement',
  'practitioner',
  'practitioner_role',
  'organization',
  'allergy_intolerance',
  'condition',
  'observation',
  'care_plan',
  'task',
  'appointment',
  'communication',
  'document_reference',
  'audit_event',
  'provenance',
  'consent',
  'encounter',
  'care_team',
  'bundle',
  'other'
);

CREATE TYPE "ClinicalLocalResourceType" AS ENUM (
  'patient',
  'care_case',
  'prescription_intake',
  'prescription_line',
  'dispense_result',
  'medication_profile',
  'medication_stock_item',
  'medication_stock_event',
  'visit_schedule',
  'visit_record',
  'residual_medication_assessment',
  'followup_task',
  'care_report',
  'audit_log',
  'none',
  'other'
);

CREATE TYPE "ClinicalExternalReferenceStatus" AS ENUM (
  'candidate',
  'verified',
  'needs_review',
  'superseded',
  'rejected',
  'retired'
);

CREATE TYPE "ClinicalMatchConfidence" AS ENUM (
  'exact_identifier',
  'exact_resource_id',
  'verified_manual',
  'derived',
  'ambiguous',
  'none'
);

CREATE TYPE "ClinicalIntegrationDirection" AS ENUM ('inbound', 'outbound');

CREATE TYPE "ClinicalSyncStatus" AS ENUM (
  'local_only_unverified',
  'pending_yrese_sync',
  'pending_fhir_validation',
  'pending_external_reverify',
  'synced',
  'conflict_requires_review',
  'failed',
  'ignored'
);

CREATE TYPE "ClinicalFhirValidationStatus" AS ENUM (
  'not_validated',
  'valid',
  'invalid',
  'unsupported_profile',
  'skipped'
);

CREATE TYPE "ClinicalEventReceiptStatus" AS ENUM (
  'accepted',
  'held_for_review',
  'rejected',
  'failed',
  'ignored'
);

CREATE TYPE "ClinicalPayloadSensitivity" AS ENUM ('none', 'limited_phi', 'phi');

CREATE TYPE "ClinicalOutboxStatus" AS ENUM (
  'pending',
  'claimed',
  'sent',
  'failed',
  'dead_letter',
  'cancelled'
);

CREATE TYPE "ClinicalQueueStatus" AS ENUM (
  'pending',
  'running',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled',
  'conflict_requires_review'
);

CREATE TYPE "ClinicalPurposeOfUse" AS ENUM (
  'treatment',
  'care_coordination',
  'payment',
  'healthcare_operations',
  'patient_request',
  'legal_required',
  'break_glass',
  'test_synthetic'
);

CREATE TYPE "ClinicalRawVaultAccessPolicy" AS ENUM (
  'step_up_required',
  'system_replay_only',
  'legal_hold'
);

CREATE TYPE "HomeCarePatientStatus" AS ENUM ('candidate', 'active', 'paused', 'ended');
CREATE TYPE "HomeCareCareType" AS ENUM ('home', 'facility', 'online_followup');

CREATE TYPE "MedicationTimelineSourceKind" AS ENUM (
  'medication_request',
  'medication_dispense',
  'medication_statement',
  'residual_assessment',
  'adherence_assessment',
  'visit_execution',
  'followup'
);

CREATE TYPE "ResidualMedicationAssessmentResult" AS ENUM (
  'no_issue',
  'residual_exists',
  'overuse_suspected',
  'underuse_suspected',
  'needs_prescriber_contact'
);

CREATE TABLE "ClinicalExternalSystem" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "system_key" TEXT NOT NULL,
  "system_type" "ClinicalExternalSystemType" NOT NULL,
  "status" "ClinicalExternalSystemStatus" NOT NULL DEFAULT 'draft',
  "jp_core_version" TEXT,
  "fhir_version" TEXT,
  "base_url_hash" TEXT,
  "capabilities" JSONB,
  "last_verified_at" TIMESTAMP(3),
  "disabled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalExternalSystem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalExternalSystem_system_key_nonempty_chk" CHECK (length(trim("system_key")) > 0),
  CONSTRAINT "ClinicalExternalSystem_base_url_hash_chk" CHECK ("base_url_hash" IS NULL OR length(trim("base_url_hash")) >= 32),
  CONSTRAINT "ClinicalExternalSystem_capabilities_object_chk" CHECK ("capabilities" IS NULL OR jsonb_typeof("capabilities") = 'object')
);

CREATE TABLE "ClinicalExternalReference" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "external_system_id" TEXT NOT NULL,
  "resource_type" "ClinicalFhirResourceType" NOT NULL,
  "external_resource_id" TEXT NOT NULL,
  "external_version_id" TEXT,
  "identifier_system" TEXT,
  "identifier_value_hash" TEXT,
  "local_resource_type" "ClinicalLocalResourceType" NOT NULL,
  "local_resource_id" TEXT,
  "patient_id" TEXT,
  "case_id" TEXT,
  "status" "ClinicalExternalReferenceStatus" NOT NULL DEFAULT 'candidate',
  "confidence" "ClinicalMatchConfidence" NOT NULL DEFAULT 'none',
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMP(3),
  "verified_by" TEXT,
  "retired_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalExternalReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalExternalReference_external_resource_id_nonempty_chk" CHECK (length(trim("external_resource_id")) > 0),
  CONSTRAINT "ClinicalExternalReference_verified_requires_actor_chk" CHECK ("verified_at" IS NULL OR "verified_by" IS NOT NULL),
  CONSTRAINT "ClinicalExternalReference_local_resource_chk" CHECK (("local_resource_type" = 'none' AND "local_resource_id" IS NULL) OR ("local_resource_type" <> 'none' AND "local_resource_id" IS NOT NULL)),
  CONSTRAINT "ClinicalExternalReference_identifier_hash_chk" CHECK ("identifier_value_hash" IS NULL OR length(trim("identifier_value_hash")) >= 32)
);

CREATE TABLE "ClinicalFhirResourceCache" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "external_system_id" TEXT NOT NULL,
  "external_reference_id" TEXT,
  "patient_id" TEXT,
  "case_id" TEXT,
  "resource_type" "ClinicalFhirResourceType" NOT NULL,
  "resource_id" TEXT NOT NULL,
  "version_id" TEXT,
  "profile_urls" TEXT[],
  "identifier_summary" JSONB,
  "normalized_summary" JSONB,
  "content_hash" TEXT NOT NULL,
  "etag_hash" TEXT,
  "last_modified_at" TIMESTAMP(3),
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "validation_status" "ClinicalFhirValidationStatus" NOT NULL DEFAULT 'not_validated',
  "validation_errors" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalFhirResourceCache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalFhirResourceCache_resource_id_nonempty_chk" CHECK (length(trim("resource_id")) > 0),
  CONSTRAINT "ClinicalFhirResourceCache_content_hash_nonempty_chk" CHECK (length(trim("content_hash")) >= 32),
  CONSTRAINT "ClinicalFhirResourceCache_etag_hash_chk" CHECK ("etag_hash" IS NULL OR length(trim("etag_hash")) >= 32),
  CONSTRAINT "ClinicalFhirResourceCache_identifier_summary_object_chk" CHECK ("identifier_summary" IS NULL OR jsonb_typeof("identifier_summary") = 'object'),
  CONSTRAINT "ClinicalFhirResourceCache_normalized_summary_object_chk" CHECK ("normalized_summary" IS NULL OR jsonb_typeof("normalized_summary") = 'object'),
  CONSTRAINT "ClinicalFhirResourceCache_validation_errors_array_chk" CHECK ("validation_errors" IS NULL OR jsonb_typeof("validation_errors") = 'array')
);

CREATE TABLE "ClinicalFhirRawResourceVault" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "cache_id" TEXT NOT NULL,
  "resource_hash" TEXT NOT NULL,
  "encryption_key_id" TEXT NOT NULL,
  "encrypted_payload" BYTEA NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "legal_hold_until" TIMESTAMP(3),
  "access_policy" "ClinicalRawVaultAccessPolicy" NOT NULL DEFAULT 'step_up_required',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalFhirRawResourceVault_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalFhirRawResourceVault_hash_nonempty_chk" CHECK (length(trim("resource_hash")) >= 32),
  CONSTRAINT "ClinicalFhirRawResourceVault_key_nonempty_chk" CHECK (length(trim("encryption_key_id")) > 0),
  CONSTRAINT "ClinicalFhirRawResourceVault_payload_nonempty_chk" CHECK (octet_length("encrypted_payload") > 0),
  CONSTRAINT "ClinicalFhirRawResourceVault_retention_chk" CHECK ("legal_hold_until" IS NULL OR "legal_hold_until" >= "expires_at")
);

CREATE TABLE "ClinicalDisclosureGrant" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "external_system_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "recipient_system_key" TEXT NOT NULL,
  "purpose_of_use" "ClinicalPurposeOfUse" NOT NULL,
  "consent_record_id" TEXT,
  "share_case_id" TEXT,
  "allowed_resource_types" "ClinicalFhirResourceType"[],
  "valid_from" TIMESTAMP(3) NOT NULL,
  "valid_until" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_by" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalDisclosureGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalDisclosureGrant_recipient_nonempty_chk" CHECK (length(trim("recipient_system_key")) > 0),
  CONSTRAINT "ClinicalDisclosureGrant_valid_window_chk" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from"),
  CONSTRAINT "ClinicalDisclosureGrant_revoked_requires_actor_chk" CHECK ("revoked_at" IS NULL OR "revoked_by" IS NOT NULL)
);

CREATE TABLE "YreseClinicalEvent" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "external_system_id" TEXT NOT NULL,
  "direction" "ClinicalIntegrationDirection" NOT NULL,
  "event_type" TEXT NOT NULL,
  "external_event_id" TEXT,
  "schema_version" TEXT NOT NULL,
  "resource_refs" TEXT[],
  "resource_hash" TEXT,
  "payload_hash" TEXT NOT NULL,
  "payload_profile" TEXT,
  "sensitivity" "ClinicalPayloadSensitivity" NOT NULL DEFAULT 'phi',
  "metadata" JSONB,
  "receipt_status" "ClinicalEventReceiptStatus" NOT NULL DEFAULT 'accepted',
  "occurred_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aggregate_type" "ClinicalLocalResourceType",
  "aggregate_id" TEXT,
  "external_reference_id" TEXT,
  "fhir_resource_cache_id" TEXT,
  "idempotency_key_hash" TEXT NOT NULL,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "YreseClinicalEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YreseClinicalEvent_event_type_nonempty_chk" CHECK (length(trim("event_type")) > 0),
  CONSTRAINT "YreseClinicalEvent_schema_version_nonempty_chk" CHECK (length(trim("schema_version")) > 0),
  CONSTRAINT "YreseClinicalEvent_payload_hash_nonempty_chk" CHECK (length(trim("payload_hash")) >= 32),
  CONSTRAINT "YreseClinicalEvent_idempotency_key_hash_nonempty_chk" CHECK (length(trim("idempotency_key_hash")) >= 32),
  CONSTRAINT "YreseClinicalEvent_resource_hash_chk" CHECK ("resource_hash" IS NULL OR length(trim("resource_hash")) >= 32),
  CONSTRAINT "YreseClinicalEvent_metadata_object_chk" CHECK ("metadata" IS NULL OR jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "YreseClinicalEvent_aggregate_chk" CHECK (("aggregate_type" IS NULL AND "aggregate_id" IS NULL) OR ("aggregate_type" IS NOT NULL AND "aggregate_id" IS NOT NULL))
);

CREATE TABLE "YreseOutboundEvent" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "external_system_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_profile" TEXT NOT NULL,
  "payload_version" TEXT NOT NULL,
  "resource_type" "ClinicalFhirResourceType",
  "resource_id" TEXT,
  "resource_version_id" TEXT,
  "resource_hash" TEXT,
  "patient_id" TEXT,
  "case_id" TEXT,
  "purpose_of_use" "ClinicalPurposeOfUse",
  "consent_record_id" TEXT,
  "payload_hash" TEXT NOT NULL,
  "idempotency_key_hash" TEXT NOT NULL,
  "status" "ClinicalOutboxStatus" NOT NULL DEFAULT 'pending',
  "next_attempt_at" TIMESTAMP(3),
  "claimed_at" TIMESTAMP(3),
  "claimed_by" TEXT,
  "sent_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "last_error_code" TEXT,
  "last_error_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YreseOutboundEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YreseOutboundEvent_event_type_nonempty_chk" CHECK (length(trim("event_type")) > 0),
  CONSTRAINT "YreseOutboundEvent_payload_profile_nonempty_chk" CHECK (length(trim("payload_profile")) > 0),
  CONSTRAINT "YreseOutboundEvent_payload_version_nonempty_chk" CHECK (length(trim("payload_version")) > 0),
  CONSTRAINT "YreseOutboundEvent_payload_hash_nonempty_chk" CHECK (length(trim("payload_hash")) >= 32),
  CONSTRAINT "YreseOutboundEvent_idempotency_key_hash_nonempty_chk" CHECK (length(trim("idempotency_key_hash")) >= 32),
  CONSTRAINT "YreseOutboundEvent_resource_hash_chk" CHECK ("resource_hash" IS NULL OR length(trim("resource_hash")) >= 32),
  CONSTRAINT "YreseOutboundEvent_attempts_chk" CHECK ("attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"),
  CONSTRAINT "YreseOutboundEvent_claimed_chk" CHECK ("status" <> 'claimed' OR ("claimed_at" IS NOT NULL AND "claimed_by" IS NOT NULL)),
  CONSTRAINT "YreseOutboundEvent_terminal_time_chk" CHECK ("status" NOT IN ('sent', 'dead_letter', 'cancelled') OR "sent_at" IS NOT NULL OR "status" <> 'sent'),
  CONSTRAINT "YreseOutboundEvent_last_error_metadata_object_chk" CHECK ("last_error_metadata" IS NULL OR jsonb_typeof("last_error_metadata") = 'object')
);

CREATE TABLE "ClinicalSyncQueueItem" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "external_system_id" TEXT NOT NULL,
  "direction" "ClinicalIntegrationDirection" NOT NULL,
  "operation" TEXT NOT NULL,
  "aggregate_type" "ClinicalLocalResourceType" NOT NULL,
  "aggregate_id" TEXT,
  "external_reference_id" TEXT,
  "yrese_event_id" TEXT,
  "fhir_resource_cache_id" TEXT,
  "status" "ClinicalQueueStatus" NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "idempotency_key_hash" TEXT NOT NULL,
  "request_fingerprint_hash" TEXT,
  "conflict_reference_id" TEXT,
  "metadata" JSONB,
  "last_error_code" TEXT,
  "last_error_metadata" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalSyncQueueItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalSyncQueueItem_operation_nonempty_chk" CHECK (length(trim("operation")) > 0),
  CONSTRAINT "ClinicalSyncQueueItem_idempotency_key_hash_nonempty_chk" CHECK (length(trim("idempotency_key_hash")) >= 32),
  CONSTRAINT "ClinicalSyncQueueItem_request_hash_chk" CHECK ("request_fingerprint_hash" IS NULL OR length(trim("request_fingerprint_hash")) >= 32),
  CONSTRAINT "ClinicalSyncQueueItem_priority_chk" CHECK ("priority" >= 0),
  CONSTRAINT "ClinicalSyncQueueItem_attempts_chk" CHECK ("attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"),
  CONSTRAINT "ClinicalSyncQueueItem_running_lock_chk" CHECK ("status" <> 'running' OR ("locked_at" IS NOT NULL AND "locked_by" IS NOT NULL)),
  CONSTRAINT "ClinicalSyncQueueItem_terminal_time_chk" CHECK ("status" NOT IN ('succeeded', 'dead_letter', 'cancelled') OR "completed_at" IS NOT NULL),
  CONSTRAINT "ClinicalSyncQueueItem_metadata_object_chk" CHECK ("metadata" IS NULL OR jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "ClinicalSyncQueueItem_last_error_metadata_object_chk" CHECK ("last_error_metadata" IS NULL OR jsonb_typeof("last_error_metadata") = 'object')
);

CREATE TABLE "ClinicalProvenanceRecord" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "subject_type" "ClinicalLocalResourceType" NOT NULL,
  "subject_id" TEXT NOT NULL,
  "activity" TEXT NOT NULL,
  "direction" "ClinicalIntegrationDirection" NOT NULL,
  "external_reference_id" TEXT,
  "fhir_resource_cache_id" TEXT,
  "yrese_event_id" TEXT,
  "audit_log_id" TEXT,
  "input_hash" TEXT,
  "output_hash" TEXT,
  "adapter_version" TEXT,
  "jp_core_version" TEXT,
  "fhir_version" TEXT,
  "transformation_summary" JSONB,
  "recorded_by" TEXT,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalProvenanceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalProvenanceRecord_subject_id_nonempty_chk" CHECK (length(trim("subject_id")) > 0),
  CONSTRAINT "ClinicalProvenanceRecord_activity_nonempty_chk" CHECK (length(trim("activity")) > 0),
  CONSTRAINT "ClinicalProvenanceRecord_hash_presence_chk" CHECK ("input_hash" IS NOT NULL OR "external_reference_id" IS NOT NULL OR "fhir_resource_cache_id" IS NOT NULL),
  CONSTRAINT "ClinicalProvenanceRecord_input_hash_chk" CHECK ("input_hash" IS NULL OR length(trim("input_hash")) >= 32),
  CONSTRAINT "ClinicalProvenanceRecord_output_hash_chk" CHECK ("output_hash" IS NULL OR length(trim("output_hash")) >= 32),
  CONSTRAINT "ClinicalProvenanceRecord_transformation_summary_object_chk" CHECK ("transformation_summary" IS NULL OR jsonb_typeof("transformation_summary") = 'object')
);

CREATE TABLE "HomeCarePatientProfile" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "yrese_patient_reference_id" TEXT,
  "fhir_patient_ref" TEXT,
  "status" "HomeCarePatientStatus" NOT NULL DEFAULT 'candidate',
  "care_type" "HomeCareCareType" NOT NULL,
  "primary_pharmacy_site_id" TEXT,
  "assigned_pharmacist_id" TEXT,
  "facility_id" TEXT,
  "consent_status" TEXT,
  "last_yrese_sync_at" TIMESTAMP(3),
  "last_fhir_validation_status" "ClinicalFhirValidationStatus" NOT NULL DEFAULT 'not_validated',
  "sync_status" "ClinicalSyncStatus" NOT NULL DEFAULT 'local_only_unverified',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeCarePatientProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeCarePatientProfile_external_ref_chk" CHECK ("yrese_patient_reference_id" IS NOT NULL OR "fhir_patient_ref" IS NOT NULL OR "status" = 'candidate')
);

CREATE TABLE "MedicationTimelineItem" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "source_kind" "MedicationTimelineSourceKind" NOT NULL,
  "source_reference_id" TEXT NOT NULL,
  "external_reference_id" TEXT,
  "fhir_resource_cache_id" TEXT,
  "medication_coding" JSONB,
  "medication_display" TEXT,
  "medication_text" TEXT,
  "status" TEXT,
  "authored_at" TIMESTAMP(3),
  "effective_at" TIMESTAMP(3),
  "dispensed_at" TIMESTAMP(3),
  "asserted_at" TIMESTAMP(3),
  "quantity_value" DECIMAL(12,4),
  "quantity_unit" TEXT,
  "dosage_text" TEXT,
  "derived_from_item_ids" TEXT[],
  "sync_status" "ClinicalSyncStatus" NOT NULL DEFAULT 'local_only_unverified',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicationTimelineItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationTimelineItem_source_reference_id_nonempty_chk" CHECK (length(trim("source_reference_id")) > 0),
  CONSTRAINT "MedicationTimelineItem_quantity_nonnegative_chk" CHECK ("quantity_value" IS NULL OR "quantity_value" >= 0),
  CONSTRAINT "MedicationTimelineItem_medication_coding_object_chk" CHECK ("medication_coding" IS NULL OR jsonb_typeof("medication_coding") = 'object')
);

CREATE TABLE "ResidualMedicationAssessment" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "display_id" TEXT,
  "patient_id" TEXT NOT NULL,
  "case_id" TEXT,
  "visit_record_id" TEXT,
  "medication_reference_ids" TEXT[],
  "result" "ResidualMedicationAssessmentResult" NOT NULL,
  "details" TEXT,
  "attachment_file_ids" TEXT[],
  "created_by" TEXT NOT NULL,
  "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sync_status" "ClinicalSyncStatus" NOT NULL DEFAULT 'local_only_unverified',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResidualMedicationAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResidualMedicationAssessment_created_by_nonempty_chk" CHECK (length(trim("created_by")) > 0)
);

CREATE UNIQUE INDEX "ClinicalExternalSystem_org_id_display_id_key"
  ON "ClinicalExternalSystem"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ClinicalExternalSystem_id_org_id_key" ON "ClinicalExternalSystem"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalExternalSystem_org_id_system_key_key" ON "ClinicalExternalSystem"("org_id", "system_key");
CREATE INDEX "ClinicalExternalSystem_org_id_idx" ON "ClinicalExternalSystem"("org_id");
CREATE INDEX "ClinicalExternalSystem_org_id_status_idx" ON "ClinicalExternalSystem"("org_id", "status");

CREATE UNIQUE INDEX "ClinicalExternalReference_org_id_display_id_key"
  ON "ClinicalExternalReference"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ClinicalExternalReference_id_org_id_key" ON "ClinicalExternalReference"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalExternalReference_org_system_resource_external_key"
  ON "ClinicalExternalReference"("org_id", "external_system_id", "resource_type", "external_resource_id");
CREATE UNIQUE INDEX "ClinicalExternalReference_org_entity_system_current_key"
  ON "ClinicalExternalReference"("org_id", "local_resource_type", "local_resource_id", "external_system_id", "resource_type")
  WHERE "retired_at" IS NULL AND "local_resource_id" IS NOT NULL;
CREATE INDEX "ClinicalExternalReference_org_id_idx" ON "ClinicalExternalReference"("org_id");
CREATE INDEX "ClinicalExternalReference_org_system_type_status_idx" ON "ClinicalExternalReference"("org_id", "external_system_id", "resource_type", "status");
CREATE INDEX "ClinicalExternalReference_org_local_resource_idx" ON "ClinicalExternalReference"("org_id", "local_resource_type", "local_resource_id");
CREATE INDEX "ClinicalExternalReference_org_patient_type_seen_idx" ON "ClinicalExternalReference"("org_id", "patient_id", "resource_type", "last_seen_at" DESC);
CREATE INDEX "ClinicalExternalReference_org_case_type_seen_idx" ON "ClinicalExternalReference"("org_id", "case_id", "resource_type", "last_seen_at" DESC);
CREATE INDEX "ClinicalExternalReference_org_status_updated_idx" ON "ClinicalExternalReference"("org_id", "status", "updated_at" DESC);

CREATE UNIQUE INDEX "ClinicalFhirResourceCache_org_id_display_id_key"
  ON "ClinicalFhirResourceCache"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ClinicalFhirResourceCache_id_org_id_key" ON "ClinicalFhirResourceCache"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalFhirResourceCache_org_source_resource_version_key"
  ON "ClinicalFhirResourceCache"("org_id", "external_system_id", "resource_type", "resource_id", "version_id");
CREATE UNIQUE INDEX "ClinicalFhirResourceCache_org_source_resource_current_key"
  ON "ClinicalFhirResourceCache"("org_id", "external_system_id", "resource_type", "resource_id")
  WHERE "is_current" = true;
CREATE INDEX "ClinicalFhirResourceCache_org_id_idx" ON "ClinicalFhirResourceCache"("org_id");
CREATE INDEX "ClinicalFhirResourceCache_org_system_resource_idx" ON "ClinicalFhirResourceCache"("org_id", "external_system_id", "resource_type", "resource_id");
CREATE INDEX "ClinicalFhirResourceCache_org_external_ref_idx" ON "ClinicalFhirResourceCache"("org_id", "external_reference_id");
CREATE INDEX "ClinicalFhirResourceCache_org_patient_type_fetched_idx" ON "ClinicalFhirResourceCache"("org_id", "patient_id", "resource_type", "fetched_at" DESC);
CREATE INDEX "ClinicalFhirResourceCache_org_case_type_fetched_idx" ON "ClinicalFhirResourceCache"("org_id", "case_id", "resource_type", "fetched_at" DESC);
CREATE INDEX "ClinicalFhirResourceCache_org_expiry_idx" ON "ClinicalFhirResourceCache"("org_id", "expires_at");
CREATE INDEX "ClinicalFhirResourceCache_org_validation_fetched_idx" ON "ClinicalFhirResourceCache"("org_id", "validation_status", "fetched_at" DESC);

CREATE UNIQUE INDEX "ClinicalFhirRawResourceVault_id_org_id_key" ON "ClinicalFhirRawResourceVault"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalFhirRawResourceVault_org_cache_key" ON "ClinicalFhirRawResourceVault"("org_id", "cache_id");
CREATE INDEX "ClinicalFhirRawResourceVault_org_id_idx" ON "ClinicalFhirRawResourceVault"("org_id");
CREATE INDEX "ClinicalFhirRawResourceVault_org_expiry_idx" ON "ClinicalFhirRawResourceVault"("org_id", "expires_at");
CREATE INDEX "ClinicalFhirRawResourceVault_org_resource_hash_idx" ON "ClinicalFhirRawResourceVault"("org_id", "resource_hash");

CREATE UNIQUE INDEX "ClinicalDisclosureGrant_org_id_display_id_key"
  ON "ClinicalDisclosureGrant"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ClinicalDisclosureGrant_id_org_id_key" ON "ClinicalDisclosureGrant"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalDisclosureGrant_org_patient_recipient_purpose_active_key"
  ON "ClinicalDisclosureGrant"("org_id", "patient_id", "recipient_system_key", "purpose_of_use")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "ClinicalDisclosureGrant_org_id_idx" ON "ClinicalDisclosureGrant"("org_id");
CREATE INDEX "ClinicalDisclosureGrant_org_patient_purpose_valid_idx" ON "ClinicalDisclosureGrant"("org_id", "patient_id", "purpose_of_use", "valid_from");
CREATE INDEX "ClinicalDisclosureGrant_org_case_purpose_valid_idx" ON "ClinicalDisclosureGrant"("org_id", "case_id", "purpose_of_use", "valid_from");
CREATE INDEX "ClinicalDisclosureGrant_org_system_recipient_idx" ON "ClinicalDisclosureGrant"("org_id", "external_system_id", "recipient_system_key");
CREATE INDEX "ClinicalDisclosureGrant_org_consent_idx" ON "ClinicalDisclosureGrant"("org_id", "consent_record_id");

CREATE UNIQUE INDEX "YreseClinicalEvent_org_id_display_id_key"
  ON "YreseClinicalEvent"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "YreseClinicalEvent_id_org_id_key" ON "YreseClinicalEvent"("id", "org_id");
CREATE UNIQUE INDEX "YreseClinicalEvent_org_system_external_event_key"
  ON "YreseClinicalEvent"("org_id", "external_system_id", "external_event_id")
  WHERE "external_event_id" IS NOT NULL;
CREATE UNIQUE INDEX "YreseClinicalEvent_org_idempotency_key_hash_key"
  ON "YreseClinicalEvent"("org_id", "idempotency_key_hash");
CREATE INDEX "YreseClinicalEvent_org_id_idx" ON "YreseClinicalEvent"("org_id");
CREATE INDEX "YreseClinicalEvent_org_system_event_received_idx" ON "YreseClinicalEvent"("org_id", "external_system_id", "event_type", "received_at" DESC);
CREATE INDEX "YreseClinicalEvent_org_status_received_idx" ON "YreseClinicalEvent"("org_id", "receipt_status", "received_at" DESC);
CREATE INDEX "YreseClinicalEvent_org_aggregate_idx" ON "YreseClinicalEvent"("org_id", "aggregate_type", "aggregate_id", "received_at" DESC);
CREATE INDEX "YreseClinicalEvent_org_external_ref_idx" ON "YreseClinicalEvent"("org_id", "external_reference_id");
CREATE INDEX "YreseClinicalEvent_org_fhir_cache_idx" ON "YreseClinicalEvent"("org_id", "fhir_resource_cache_id");

CREATE UNIQUE INDEX "YreseOutboundEvent_org_id_display_id_key"
  ON "YreseOutboundEvent"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "YreseOutboundEvent_id_org_id_key" ON "YreseOutboundEvent"("id", "org_id");
CREATE UNIQUE INDEX "YreseOutboundEvent_org_idempotency_key_hash_key"
  ON "YreseOutboundEvent"("org_id", "idempotency_key_hash");
CREATE INDEX "YreseOutboundEvent_org_id_idx" ON "YreseOutboundEvent"("org_id");
CREATE INDEX "YreseOutboundEvent_org_system_status_next_idx" ON "YreseOutboundEvent"("org_id", "external_system_id", "status", "next_attempt_at");
CREATE INDEX "YreseOutboundEvent_org_patient_created_idx" ON "YreseOutboundEvent"("org_id", "patient_id", "created_at" DESC);
CREATE INDEX "YreseOutboundEvent_org_case_created_idx" ON "YreseOutboundEvent"("org_id", "case_id", "created_at" DESC);
CREATE INDEX "YreseOutboundEvent_org_resource_idx" ON "YreseOutboundEvent"("org_id", "resource_type", "resource_id");

CREATE UNIQUE INDEX "ClinicalSyncQueueItem_org_id_display_id_key"
  ON "ClinicalSyncQueueItem"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ClinicalSyncQueueItem_id_org_id_key" ON "ClinicalSyncQueueItem"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalSyncQueueItem_org_target_operation_idem_key"
  ON "ClinicalSyncQueueItem"("org_id", "external_system_id", "operation", "idempotency_key_hash");
CREATE INDEX "ClinicalSyncQueueItem_org_id_idx" ON "ClinicalSyncQueueItem"("org_id");
CREATE INDEX "ClinicalSyncQueueItem_claim_idx" ON "ClinicalSyncQueueItem"("org_id", "status", "next_attempt_at", "priority", "created_at");
CREATE INDEX "ClinicalSyncQueueItem_locked_idx" ON "ClinicalSyncQueueItem"("org_id", "locked_at") WHERE "status" = 'running';
CREATE INDEX "ClinicalSyncQueueItem_aggregate_idx" ON "ClinicalSyncQueueItem"("org_id", "aggregate_type", "aggregate_id", "created_at" DESC);
CREATE INDEX "ClinicalSyncQueueItem_external_ref_idx" ON "ClinicalSyncQueueItem"("org_id", "external_reference_id");
CREATE INDEX "ClinicalSyncQueueItem_yrese_event_idx" ON "ClinicalSyncQueueItem"("org_id", "yrese_event_id");
CREATE INDEX "ClinicalSyncQueueItem_fhir_cache_idx" ON "ClinicalSyncQueueItem"("org_id", "fhir_resource_cache_id");

CREATE UNIQUE INDEX "ClinicalProvenanceRecord_org_id_display_id_key"
  ON "ClinicalProvenanceRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ClinicalProvenanceRecord_id_org_id_key" ON "ClinicalProvenanceRecord"("id", "org_id");
CREATE UNIQUE INDEX "ClinicalProvenanceRecord_org_subject_activity_input_key"
  ON "ClinicalProvenanceRecord"("org_id", "subject_type", "subject_id", "activity", "input_hash");
CREATE INDEX "ClinicalProvenanceRecord_org_id_idx" ON "ClinicalProvenanceRecord"("org_id");
CREATE INDEX "ClinicalProvenanceRecord_org_subject_idx" ON "ClinicalProvenanceRecord"("org_id", "subject_type", "subject_id", "recorded_at" DESC);
CREATE INDEX "ClinicalProvenanceRecord_org_external_ref_idx" ON "ClinicalProvenanceRecord"("org_id", "external_reference_id");
CREATE INDEX "ClinicalProvenanceRecord_org_fhir_cache_idx" ON "ClinicalProvenanceRecord"("org_id", "fhir_resource_cache_id");
CREATE INDEX "ClinicalProvenanceRecord_org_yrese_event_idx" ON "ClinicalProvenanceRecord"("org_id", "yrese_event_id");
CREATE INDEX "ClinicalProvenanceRecord_org_audit_log_idx" ON "ClinicalProvenanceRecord"("org_id", "audit_log_id");

CREATE UNIQUE INDEX "HomeCarePatientProfile_org_id_display_id_key"
  ON "HomeCarePatientProfile"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "HomeCarePatientProfile_id_org_id_key" ON "HomeCarePatientProfile"("id", "org_id");
CREATE UNIQUE INDEX "HomeCarePatientProfile_org_id_patient_id_key" ON "HomeCarePatientProfile"("org_id", "patient_id");
CREATE UNIQUE INDEX "HomeCarePatientProfile_org_yrese_patient_active_key"
  ON "HomeCarePatientProfile"("org_id", "yrese_patient_reference_id")
  WHERE "yrese_patient_reference_id" IS NOT NULL AND "status" <> 'ended';
CREATE INDEX "HomeCarePatientProfile_org_id_idx" ON "HomeCarePatientProfile"("org_id");
CREATE INDEX "HomeCarePatientProfile_org_status_care_type_idx" ON "HomeCarePatientProfile"("org_id", "status", "care_type");
CREATE INDEX "HomeCarePatientProfile_org_case_idx" ON "HomeCarePatientProfile"("org_id", "case_id");
CREATE INDEX "HomeCarePatientProfile_org_facility_idx" ON "HomeCarePatientProfile"("org_id", "facility_id");
CREATE INDEX "HomeCarePatientProfile_org_yrese_patient_idx" ON "HomeCarePatientProfile"("org_id", "yrese_patient_reference_id");

CREATE UNIQUE INDEX "MedicationTimelineItem_org_id_display_id_key"
  ON "MedicationTimelineItem"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "MedicationTimelineItem_id_org_id_key" ON "MedicationTimelineItem"("id", "org_id");
CREATE UNIQUE INDEX "MedicationTimelineItem_org_source_reference_key" ON "MedicationTimelineItem"("org_id", "source_kind", "source_reference_id");
CREATE INDEX "MedicationTimelineItem_org_id_idx" ON "MedicationTimelineItem"("org_id");
CREATE INDEX "MedicationTimelineItem_org_patient_effective_idx" ON "MedicationTimelineItem"("org_id", "patient_id", "effective_at" DESC);
CREATE INDEX "MedicationTimelineItem_org_case_effective_idx" ON "MedicationTimelineItem"("org_id", "case_id", "effective_at" DESC);
CREATE INDEX "MedicationTimelineItem_org_external_ref_idx" ON "MedicationTimelineItem"("org_id", "external_reference_id");
CREATE INDEX "MedicationTimelineItem_org_fhir_cache_idx" ON "MedicationTimelineItem"("org_id", "fhir_resource_cache_id");
CREATE INDEX "MedicationTimelineItem_org_sync_updated_idx" ON "MedicationTimelineItem"("org_id", "sync_status", "updated_at" DESC);

CREATE UNIQUE INDEX "ResidualMedicationAssessment_org_id_display_id_key"
  ON "ResidualMedicationAssessment"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
CREATE UNIQUE INDEX "ResidualMedicationAssessment_id_org_id_key" ON "ResidualMedicationAssessment"("id", "org_id");
CREATE INDEX "ResidualMedicationAssessment_org_id_idx" ON "ResidualMedicationAssessment"("org_id");
CREATE INDEX "ResidualMedicationAssessment_org_patient_assessed_idx" ON "ResidualMedicationAssessment"("org_id", "patient_id", "assessed_at" DESC);
CREATE INDEX "ResidualMedicationAssessment_org_case_assessed_idx" ON "ResidualMedicationAssessment"("org_id", "case_id", "assessed_at" DESC);
CREATE INDEX "ResidualMedicationAssessment_org_visit_record_idx" ON "ResidualMedicationAssessment"("org_id", "visit_record_id");
CREATE INDEX "ResidualMedicationAssessment_org_sync_updated_idx" ON "ResidualMedicationAssessment"("org_id", "sync_status", "updated_at" DESC);

ALTER TABLE "ClinicalExternalReference"
  ADD CONSTRAINT "ClinicalExternalReference_external_system_fkey"
  FOREIGN KEY ("external_system_id", "org_id")
  REFERENCES "ClinicalExternalSystem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalExternalReference"
  ADD CONSTRAINT "ClinicalExternalReference_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalExternalReference"
  ADD CONSTRAINT "ClinicalExternalReference_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ClinicalFhirResourceCache"
  ADD CONSTRAINT "ClinicalFhirResourceCache_external_system_fkey"
  FOREIGN KEY ("external_system_id", "org_id")
  REFERENCES "ClinicalExternalSystem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalFhirResourceCache"
  ADD CONSTRAINT "ClinicalFhirResourceCache_external_reference_fkey"
  FOREIGN KEY ("external_reference_id", "org_id")
  REFERENCES "ClinicalExternalReference"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalFhirResourceCache"
  ADD CONSTRAINT "ClinicalFhirResourceCache_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalFhirResourceCache"
  ADD CONSTRAINT "ClinicalFhirResourceCache_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ClinicalFhirRawResourceVault"
  ADD CONSTRAINT "ClinicalFhirRawResourceVault_cache_fkey"
  FOREIGN KEY ("cache_id", "org_id")
  REFERENCES "ClinicalFhirResourceCache"("id", "org_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ClinicalDisclosureGrant"
  ADD CONSTRAINT "ClinicalDisclosureGrant_external_system_fkey"
  FOREIGN KEY ("external_system_id", "org_id")
  REFERENCES "ClinicalExternalSystem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalDisclosureGrant"
  ADD CONSTRAINT "ClinicalDisclosureGrant_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalDisclosureGrant"
  ADD CONSTRAINT "ClinicalDisclosureGrant_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalDisclosureGrant"
  ADD CONSTRAINT "ClinicalDisclosureGrant_consent_fkey"
  FOREIGN KEY ("consent_record_id", "org_id")
  REFERENCES "ConsentRecord"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "YreseClinicalEvent"
  ADD CONSTRAINT "YreseClinicalEvent_external_system_fkey"
  FOREIGN KEY ("external_system_id", "org_id")
  REFERENCES "ClinicalExternalSystem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "YreseClinicalEvent"
  ADD CONSTRAINT "YreseClinicalEvent_external_reference_fkey"
  FOREIGN KEY ("external_reference_id", "org_id")
  REFERENCES "ClinicalExternalReference"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "YreseClinicalEvent"
  ADD CONSTRAINT "YreseClinicalEvent_fhir_cache_fkey"
  FOREIGN KEY ("fhir_resource_cache_id", "org_id")
  REFERENCES "ClinicalFhirResourceCache"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "YreseOutboundEvent"
  ADD CONSTRAINT "YreseOutboundEvent_external_system_fkey"
  FOREIGN KEY ("external_system_id", "org_id")
  REFERENCES "ClinicalExternalSystem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "YreseOutboundEvent"
  ADD CONSTRAINT "YreseOutboundEvent_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "YreseOutboundEvent"
  ADD CONSTRAINT "YreseOutboundEvent_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "YreseOutboundEvent"
  ADD CONSTRAINT "YreseOutboundEvent_consent_fkey"
  FOREIGN KEY ("consent_record_id", "org_id")
  REFERENCES "ConsentRecord"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ClinicalSyncQueueItem"
  ADD CONSTRAINT "ClinicalSyncQueueItem_external_system_fkey"
  FOREIGN KEY ("external_system_id", "org_id")
  REFERENCES "ClinicalExternalSystem"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalSyncQueueItem"
  ADD CONSTRAINT "ClinicalSyncQueueItem_external_reference_fkey"
  FOREIGN KEY ("external_reference_id", "org_id")
  REFERENCES "ClinicalExternalReference"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalSyncQueueItem"
  ADD CONSTRAINT "ClinicalSyncQueueItem_yrese_event_fkey"
  FOREIGN KEY ("yrese_event_id", "org_id")
  REFERENCES "YreseClinicalEvent"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalSyncQueueItem"
  ADD CONSTRAINT "ClinicalSyncQueueItem_fhir_cache_fkey"
  FOREIGN KEY ("fhir_resource_cache_id", "org_id")
  REFERENCES "ClinicalFhirResourceCache"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ClinicalProvenanceRecord"
  ADD CONSTRAINT "ClinicalProvenanceRecord_external_reference_fkey"
  FOREIGN KEY ("external_reference_id", "org_id")
  REFERENCES "ClinicalExternalReference"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalProvenanceRecord"
  ADD CONSTRAINT "ClinicalProvenanceRecord_fhir_cache_fkey"
  FOREIGN KEY ("fhir_resource_cache_id", "org_id")
  REFERENCES "ClinicalFhirResourceCache"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalProvenanceRecord"
  ADD CONSTRAINT "ClinicalProvenanceRecord_yrese_event_fkey"
  FOREIGN KEY ("yrese_event_id", "org_id")
  REFERENCES "YreseClinicalEvent"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "ClinicalProvenanceRecord"
  ADD CONSTRAINT "ClinicalProvenanceRecord_audit_log_fkey"
  FOREIGN KEY ("audit_log_id", "org_id")
  REFERENCES "AuditLog"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "HomeCarePatientProfile"
  ADD CONSTRAINT "HomeCarePatientProfile_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "HomeCarePatientProfile"
  ADD CONSTRAINT "HomeCarePatientProfile_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "MedicationTimelineItem"
  ADD CONSTRAINT "MedicationTimelineItem_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "MedicationTimelineItem"
  ADD CONSTRAINT "MedicationTimelineItem_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "MedicationTimelineItem"
  ADD CONSTRAINT "MedicationTimelineItem_external_reference_fkey"
  FOREIGN KEY ("external_reference_id", "org_id")
  REFERENCES "ClinicalExternalReference"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
ALTER TABLE "MedicationTimelineItem"
  ADD CONSTRAINT "MedicationTimelineItem_fhir_cache_fkey"
  FOREIGN KEY ("fhir_resource_cache_id", "org_id")
  REFERENCES "ClinicalFhirResourceCache"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ResidualMedicationAssessment"
  ADD CONSTRAINT "ResidualMedicationAssessment_patient_fkey"
  FOREIGN KEY ("patient_id", "org_id")
  REFERENCES "Patient"("id", "org_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
ALTER TABLE "ResidualMedicationAssessment"
  ADD CONSTRAINT "ResidualMedicationAssessment_case_fkey"
  FOREIGN KEY ("case_id", "org_id")
  REFERENCES "CareCase"("id", "org_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_standard_clinical_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Standard clinical integration ledger rows are append-only; write a correction row instead';
END;
$$;

CREATE TRIGGER "YreseClinicalEvent_no_update"
  BEFORE UPDATE ON "YreseClinicalEvent"
  FOR EACH ROW
  EXECUTE FUNCTION reject_standard_clinical_immutable_mutation();

CREATE TRIGGER "YreseClinicalEvent_no_delete"
  BEFORE DELETE ON "YreseClinicalEvent"
  FOR EACH ROW
  EXECUTE FUNCTION reject_standard_clinical_immutable_mutation();

CREATE TRIGGER "ClinicalProvenanceRecord_no_update"
  BEFORE UPDATE ON "ClinicalProvenanceRecord"
  FOR EACH ROW
  EXECUTE FUNCTION reject_standard_clinical_immutable_mutation();

CREATE TRIGGER "ClinicalProvenanceRecord_no_delete"
  BEFORE DELETE ON "ClinicalProvenanceRecord"
  FOR EACH ROW
  EXECUTE FUNCTION reject_standard_clinical_immutable_mutation();

ALTER TABLE "ClinicalExternalSystem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalExternalSystem";
CREATE POLICY tenant_isolation ON "ClinicalExternalSystem"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalExternalSystem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClinicalExternalReference" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalExternalReference";
CREATE POLICY tenant_isolation ON "ClinicalExternalReference"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalExternalReference" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClinicalFhirResourceCache" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalFhirResourceCache";
CREATE POLICY tenant_isolation ON "ClinicalFhirResourceCache"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalFhirResourceCache" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClinicalFhirRawResourceVault" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalFhirRawResourceVault";
CREATE POLICY tenant_isolation ON "ClinicalFhirRawResourceVault"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalFhirRawResourceVault" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClinicalDisclosureGrant" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalDisclosureGrant";
CREATE POLICY tenant_isolation ON "ClinicalDisclosureGrant"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalDisclosureGrant" FORCE ROW LEVEL SECURITY;

ALTER TABLE "YreseClinicalEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "YreseClinicalEvent";
CREATE POLICY tenant_isolation ON "YreseClinicalEvent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "YreseClinicalEvent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "YreseOutboundEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "YreseOutboundEvent";
CREATE POLICY tenant_isolation ON "YreseOutboundEvent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "YreseOutboundEvent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClinicalSyncQueueItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalSyncQueueItem";
CREATE POLICY tenant_isolation ON "ClinicalSyncQueueItem"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalSyncQueueItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClinicalProvenanceRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClinicalProvenanceRecord";
CREATE POLICY tenant_isolation ON "ClinicalProvenanceRecord"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClinicalProvenanceRecord" FORCE ROW LEVEL SECURITY;

ALTER TABLE "HomeCarePatientProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HomeCarePatientProfile";
CREATE POLICY tenant_isolation ON "HomeCarePatientProfile"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "HomeCarePatientProfile" FORCE ROW LEVEL SECURITY;

ALTER TABLE "MedicationTimelineItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MedicationTimelineItem";
CREATE POLICY tenant_isolation ON "MedicationTimelineItem"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "MedicationTimelineItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ResidualMedicationAssessment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ResidualMedicationAssessment";
CREATE POLICY tenant_isolation ON "ResidualMedicationAssessment"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ResidualMedicationAssessment" FORCE ROW LEVEL SECURITY;
