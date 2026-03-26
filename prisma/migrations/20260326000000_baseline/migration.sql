-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PayerBasis" AS ENUM ('medical', 'care', 'self_pay', 'non_billable');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('urgent', 'business', 'reminder', 'system');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('system', 'organization', 'site', 'user');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('email', 'fax', 'phone', 'in_person', 'postal', 'ses');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'sent', 'failed', 'confirmed', 'response_waiting');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('physician_report', 'care_manager_report', 'facility_handoff', 'nurse_share', 'family_share', 'internal_record');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('draft', 'sent', 'received', 'in_progress', 'responded', 'closed', 'escalated', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "TracingReportStatus" AS ENUM ('draft', 'sent', 'received', 'acknowledged');

-- CreateEnum
CREATE TYPE "InteractionSeverity" AS ENUM ('contraindicated', 'caution', 'minor');

-- CreateEnum
CREATE TYPE "InteractionSource" AS ENUM ('pmda_xml', 'kegg', 'manual');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('interaction', 'duplicate', 'allergy_cross', 'renal_dose', 'pim_elderly', 'high_risk', 'narcotic', 'max_days');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('critical', 'warning', 'info');

-- CreateEnum
CREATE TYPE "DocumentSourceFormat" AS ENUM ('xml', 'sgml', 'pdf');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('ssk', 'pmda', 'mhlw_price', 'mhlw_generic', 'hot');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('open', 'in_progress', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('dose_adjustment', 'drug_change', 'side_effect_management', 'adherence_support', 'prescriber_consultation', 'patient_education', 'other');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('urgent', 'high', 'normal', 'low');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk', 'driver', 'external_viewer');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('referral_received', 'assessment', 'active', 'on_hold', 'discharged', 'terminated');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('visit_medication_management', 'personal_info_handling', 'external_sharing', 'photo_capture');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('paper_scan', 'digital');

-- CreateEnum
CREATE TYPE "ContactRelation" AS ENUM ('self', 'spouse', 'child', 'parent', 'sibling', 'care_manager', 'physician', 'nurse', 'facility_staff', 'other');

-- CreateEnum
CREATE TYPE "PrescriptionSourceType" AS ENUM ('paper', 'fax', 'e_prescription', 'facility_batch', 'refill');

-- CreateEnum
CREATE TYPE "MedicationCycleStatus" AS ENUM ('intake_received', 'structuring', 'inquiry_pending', 'inquiry_resolved', 'ready_to_dispense', 'dispensing', 'dispensed', 'audit_pending', 'audited', 'setting', 'set_audited', 'visit_ready', 'visit_completed', 'reported', 'on_hold', 'cancelled');

-- CreateEnum
CREATE TYPE "DispenseAuditResult" AS ENUM ('approved', 'rejected', 'hold', 'emergency_approved');

-- CreateEnum
CREATE TYPE "SetAuditResult" AS ENUM ('approved', 'partial_approved', 'rejected');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('initial', 'regular', 'temporary', 'revisit', 'delivery_only', 'emergency', 'physician_co_visit');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed', 'cancelled', 'postponed', 'rescheduled', 'no_show');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('completed', 'revisit_needed', 'postponed', 'cancelled', 'delivery_only', 'completed_with_issue');

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRule" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "conditions" JSONB,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCandidate" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "billing_month" DATE NOT NULL,
    "billing_code" TEXT NOT NULL,
    "billing_name" TEXT NOT NULL,
    "points" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "exclusion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvidence" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "visit_record_id" TEXT NOT NULL,
    "payer_basis" "PayerBasis" NOT NULL,
    "claimable" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" TEXT,
    "order_ref" TEXT,
    "consent_ref" TEXT,
    "management_plan_ref" TEXT,
    "report_delivery_ref" TEXT,
    "visit_record_ref" TEXT,
    "monthly_count_snapshot" INTEGER,
    "same_month_exclusion_flags" JSONB,
    "validation_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationJob" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error_log" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "scope" "SettingScope" NOT NULL,
    "scope_id" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelDictionary" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label_ja" TEXT NOT NULL,
    "label_en" TEXT,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelDictionary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceOfTruthMatrix" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "source_of_truth" TEXT NOT NULL,
    "sync_direction" TEXT,
    "external_system" TEXT,
    "recovery_procedure" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceOfTruthMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationEvent" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT,
    "case_id" TEXT,
    "event_type" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" TEXT NOT NULL,
    "counterpart_name" TEXT,
    "counterpart_contact" TEXT,
    "subject" TEXT,
    "content" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationRequest" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT,
    "case_id" TEXT,
    "request_type" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'draft',
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationResponse" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "responder_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "responded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareReport" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "visit_record_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "case_id" TEXT,
    "report_type" "ReportType" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL,
    "template_id" TEXT,
    "pdf_url" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_contact" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceNote" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "case_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "participants" JSONB NOT NULL,
    "conference_date" TIMESTAMP(3) NOT NULL,
    "action_items" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRule" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "notify_role" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAccessGrant" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "otp_hash" TEXT,
    "granted_to_name" TEXT NOT NULL,
    "granted_to_contact" TEXT,
    "scope" JSONB NOT NULL,
    "accessed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TracingReport" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "case_id" TEXT,
    "issue_id" TEXT,
    "content" JSONB NOT NULL,
    "status" "TracingReportStatus" NOT NULL DEFAULT 'draft',
    "sent_to_physician" TEXT,
    "sent_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TracingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugMaster" (
    "id" TEXT NOT NULL,
    "yj_code" TEXT NOT NULL,
    "receipt_code" TEXT,
    "hot_code" TEXT,
    "jan_code" TEXT,
    "drug_name" TEXT NOT NULL,
    "drug_name_kana" TEXT,
    "generic_name" TEXT,
    "drug_price" DECIMAL(10,2),
    "unit" TEXT,
    "dosage_form" TEXT,
    "therapeutic_category" TEXT,
    "manufacturer" TEXT,
    "is_generic" BOOLEAN NOT NULL DEFAULT false,
    "is_narcotic" BOOLEAN NOT NULL DEFAULT false,
    "is_psychotropic" BOOLEAN NOT NULL DEFAULT false,
    "max_administration_days" INTEGER,
    "transitional_expiry_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugPackageInsert" (
    "id" TEXT NOT NULL,
    "drug_master_id" TEXT NOT NULL,
    "contraindications" JSONB,
    "interactions" JSONB,
    "adverse_effects" JSONB,
    "dosage_adjustment_renal" JSONB,
    "precautions_elderly" JSONB,
    "document_version" TEXT,
    "revised_at" TIMESTAMP(3),
    "source_format" "DocumentSourceFormat",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugPackageInsert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugInteraction" (
    "id" TEXT NOT NULL,
    "drug_a_id" TEXT NOT NULL,
    "drug_b_id" TEXT NOT NULL,
    "severity" "InteractionSeverity" NOT NULL,
    "mechanism" TEXT,
    "clinical_effect" TEXT,
    "source" "InteractionSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugAlertRule" (
    "id" TEXT NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "condition" JSONB NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyDrugStock" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "drug_master_id" TEXT NOT NULL,
    "is_stocked" BOOLEAN NOT NULL DEFAULT true,
    "stock_qty" INTEGER,
    "reorder_point" INTEGER,
    "last_dispensed_at" TIMESTAMP(3),
    "preferred_generic_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyDrugStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenericDrugMapping" (
    "id" TEXT NOT NULL,
    "generic_name" TEXT NOT NULL,
    "brand_drug_ids" JSONB NOT NULL,
    "price_comparison" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenericDrugMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugMasterImportLog" (
    "id" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "record_count" INTEGER NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "error_log" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugMasterImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationProfile" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "drug_master_id" TEXT,
    "drug_name" TEXT NOT NULL,
    "dose" TEXT,
    "frequency" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "prescriber" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidualMedication" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "visit_record_id" TEXT NOT NULL,
    "drug_name" TEXT NOT NULL,
    "drug_code" TEXT,
    "prescribed_quantity" DOUBLE PRECISION,
    "remaining_quantity" DOUBLE PRECISION NOT NULL,
    "remaining_days" INTEGER,
    "excess_days" INTEGER,
    "is_reduction_target" BOOLEAN NOT NULL DEFAULT false,
    "is_prohibited_reduction" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidualMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationIssue" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "case_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'open',
    "priority" "IssuePriority" NOT NULL DEFAULT 'medium',
    "category" TEXT,
    "identified_by" TEXT NOT NULL,
    "identified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "issue_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "type" "InterventionType" NOT NULL,
    "description" TEXT NOT NULL,
    "outcome" TEXT,
    "performed_by" TEXT NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "assigned_to" TEXT,
    "due_date" TIMESTAMP(3),
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirstVisitDocument" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "emergency_contacts" JSONB NOT NULL,
    "document_url" TEXT,
    "delivered_at" TIMESTAMP(3),
    "delivered_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirstVisitDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "corporate_number" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacySite" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "fax" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_health_support_pharmacy" BOOLEAN NOT NULL DEFAULT false,
    "is_regional_support" BOOLEAN NOT NULL DEFAULT false,
    "is_specialized_pharmacy" BOOLEAN NOT NULL DEFAULT false,
    "dispensing_fee_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacySite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cognito_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_kana" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "site_id" TEXT,
    "role" "MemberRole" NOT NULL,
    "can_dispense" BOOLEAN NOT NULL DEFAULT false,
    "can_audit_dispense" BOOLEAN NOT NULL DEFAULT false,
    "can_set" BOOLEAN NOT NULL DEFAULT false,
    "can_audit_set" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityStandardRegistration" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "standard_type" TEXT NOT NULL,
    "filed_date" TIMESTAMP(3) NOT NULL,
    "effective_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "renewal_alert_date" TIMESTAMP(3),
    "requirements_status" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityStandardRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacistCredential" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "certification_type" TEXT NOT NULL,
    "certification_number" TEXT,
    "issued_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "tenure_years" DOUBLE PRECISION,
    "weekly_work_hours" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacistCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacistShift" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "available_from" TIME,
    "available_to" TIME,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacistShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_kana" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "gender" TEXT NOT NULL,
    "phone" TEXT,
    "medical_insurance_number" TEXT,
    "care_insurance_number" TEXT,
    "billing_support_flag" BOOLEAN NOT NULL DEFAULT false,
    "allergy_info" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Residence" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "building_id" TEXT,
    "unit_name" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Residence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareCase" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'referral_received',
    "referral_source" TEXT,
    "referral_date" TIMESTAMP(3),
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "end_reason" TEXT,
    "primary_pharmacist_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactParty" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" "ContactRelation" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "fax" TEXT,
    "organization_name" TEXT,
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareTeamLink" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "fax" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareTeamLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "case_id" TEXT,
    "consent_type" "ConsentType" NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "obtained_date" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "revoked_date" TIMESTAMP(3),
    "document_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "access_restricted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementPlan" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "next_review_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationCycle" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "overall_status" "MedicationCycleStatus" NOT NULL,
    "visit_sub_status" TEXT,
    "readiness_sub_status" TEXT,
    "reporting_sub_status" TEXT,
    "exception_status" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionIntake" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "source_type" "PrescriptionSourceType" NOT NULL,
    "prescribed_date" TIMESTAMP(3) NOT NULL,
    "prescriber_name" TEXT,
    "prescriber_institution" TEXT,
    "original_document_url" TEXT,
    "refill_remaining_count" INTEGER,
    "refill_next_dispense_date" TIMESTAMP(3),
    "split_dispense_total" INTEGER,
    "split_dispense_current" INTEGER,
    "prescription_expiry_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionLine" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "intake_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "drug_name" TEXT NOT NULL,
    "drug_code" TEXT,
    "dosage_form" TEXT,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "is_generic" BOOLEAN NOT NULL DEFAULT false,
    "is_generic_name_prescription" BOOLEAN NOT NULL DEFAULT false,
    "packaging_instructions" TEXT,
    "notes" TEXT,
    "route" TEXT,
    "dispensing_method" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "line_id" TEXT,
    "reason" TEXT NOT NULL,
    "inquiry_to_physician" TEXT NOT NULL,
    "inquiry_content" TEXT NOT NULL,
    "result" TEXT,
    "change_detail" TEXT,
    "inquired_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseTask" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispenseTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseResult" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "actual_drug_name" TEXT NOT NULL,
    "actual_drug_code" TEXT,
    "actual_quantity" DOUBLE PRECISION NOT NULL,
    "actual_unit" TEXT,
    "discrepancy_reason" TEXT,
    "carry_type" TEXT NOT NULL,
    "special_notes" TEXT,
    "dispensed_by" TEXT NOT NULL,
    "dispensed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispenseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseAudit" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "result" "DispenseAuditResult" NOT NULL,
    "reject_reason" TEXT,
    "reject_detail" TEXT,
    "audited_by" TEXT NOT NULL,
    "audited_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispenseAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetPlan" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "target_period_start" TIMESTAMP(3) NOT NULL,
    "target_period_end" TIMESTAMP(3) NOT NULL,
    "set_method" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetBatch" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "carry_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetAudit" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "result" "SetAuditResult" NOT NULL,
    "approved_scope" JSONB,
    "reject_reason" TEXT,
    "audited_by" TEXT NOT NULL,
    "audited_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowException" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "exception_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitSchedule" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "case_id" TEXT NOT NULL,
    "visit_type" "VisitType" NOT NULL,
    "schedule_status" "ScheduleStatus" NOT NULL DEFAULT 'planned',
    "scheduled_date" DATE NOT NULL,
    "time_window_start" TIME,
    "time_window_end" TIME,
    "pharmacist_id" TEXT NOT NULL,
    "route_order" INTEGER,
    "carry_items" JSONB,
    "carry_items_status" TEXT,
    "pre_visit_checklist_completed" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_rule" TEXT,
    "recurrence_parent_id" TEXT,
    "facility_batch_id" TEXT,
    "time_constraint_start" TIME,
    "time_constraint_end" TIME,
    "medication_start_date" DATE,
    "medication_end_date" DATE,
    "visit_deadline_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityVisitBatch" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "pharmacist_id" TEXT NOT NULL,
    "patient_ids" JSONB NOT NULL,
    "estimated_duration" INTEGER,
    "route_from_pharmacy" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityVisitBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "pharmacist_id" TEXT NOT NULL,
    "visit_date" TIMESTAMP(3) NOT NULL,
    "outcome_status" "VisitOutcome" NOT NULL,
    "soap_subjective" TEXT,
    "soap_objective" TEXT,
    "soap_assessment" TEXT,
    "soap_plan" TEXT,
    "receipt_person_name" TEXT,
    "receipt_person_relation" TEXT,
    "receipt_at" TIMESTAMP(3),
    "next_visit_suggestion_date" DATE,
    "cancellation_reason" TEXT,
    "postpone_reason" TEXT,
    "revisit_reason" TEXT,
    "structured_soap" JSONB,
    "attachments" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitPreparation" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "medication_changes_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "carry_items_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "previous_issues_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "route_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "offline_synced" BOOLEAN NOT NULL DEFAULT false,
    "prepared_by" TEXT NOT NULL,
    "prepared_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationRule_org_id_idx" ON "NotificationRule"("org_id");

-- CreateIndex
CREATE INDEX "NotificationRule_event_type_idx" ON "NotificationRule"("event_type");

-- CreateIndex
CREATE INDEX "NotificationRule_enabled_idx" ON "NotificationRule"("enabled");

-- CreateIndex
CREATE INDEX "BillingRule_org_id_idx" ON "BillingRule"("org_id");

-- CreateIndex
CREATE INDEX "BillingRule_rule_type_idx" ON "BillingRule"("rule_type");

-- CreateIndex
CREATE INDEX "BillingRule_is_active_idx" ON "BillingRule"("is_active");

-- CreateIndex
CREATE INDEX "BillingCandidate_org_id_idx" ON "BillingCandidate"("org_id");

-- CreateIndex
CREATE INDEX "BillingCandidate_billing_month_idx" ON "BillingCandidate"("billing_month");

-- CreateIndex
CREATE INDEX "BillingCandidate_status_idx" ON "BillingCandidate"("status");

-- CreateIndex
CREATE INDEX "BillingEvidence_org_id_idx" ON "BillingEvidence"("org_id");

-- CreateIndex
CREATE INDEX "BillingEvidence_visit_record_id_idx" ON "BillingEvidence"("visit_record_id");

-- CreateIndex
CREATE INDEX "Notification_org_id_idx" ON "Notification"("org_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

-- CreateIndex
CREATE INDEX "Notification_is_read_idx" ON "Notification"("is_read");

-- CreateIndex
CREATE INDEX "AuditLog_org_id_idx" ON "AuditLog"("org_id");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");

-- CreateIndex
CREATE INDEX "AuditLog_target_type_idx" ON "AuditLog"("target_type");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "IntegrationJob_job_type_idx" ON "IntegrationJob"("job_type");

-- CreateIndex
CREATE INDEX "IntegrationJob_status_idx" ON "IntegrationJob"("status");

-- CreateIndex
CREATE INDEX "Template_org_id_idx" ON "Template"("org_id");

-- CreateIndex
CREATE INDEX "Template_template_type_idx" ON "Template"("template_type");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_scope_scope_id_key_key" ON "Setting"("scope", "scope_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "LabelDictionary_key_key" ON "LabelDictionary"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SourceOfTruthMatrix_org_id_entity_type_key" ON "SourceOfTruthMatrix"("org_id", "entity_type");

-- CreateIndex
CREATE INDEX "CommunicationEvent_org_id_idx" ON "CommunicationEvent"("org_id");

-- CreateIndex
CREATE INDEX "CommunicationEvent_patient_id_idx" ON "CommunicationEvent"("patient_id");

-- CreateIndex
CREATE INDEX "CommunicationEvent_event_type_idx" ON "CommunicationEvent"("event_type");

-- CreateIndex
CREATE INDEX "CommunicationRequest_org_id_idx" ON "CommunicationRequest"("org_id");

-- CreateIndex
CREATE INDEX "CommunicationRequest_status_idx" ON "CommunicationRequest"("status");

-- CreateIndex
CREATE INDEX "CommunicationResponse_org_id_idx" ON "CommunicationResponse"("org_id");

-- CreateIndex
CREATE INDEX "CommunicationResponse_request_id_idx" ON "CommunicationResponse"("request_id");

-- CreateIndex
CREATE INDEX "CareReport_org_id_idx" ON "CareReport"("org_id");

-- CreateIndex
CREATE INDEX "CareReport_patient_id_idx" ON "CareReport"("patient_id");

-- CreateIndex
CREATE INDEX "CareReport_status_idx" ON "CareReport"("status");

-- CreateIndex
CREATE INDEX "DeliveryRecord_org_id_idx" ON "DeliveryRecord"("org_id");

-- CreateIndex
CREATE INDEX "DeliveryRecord_status_idx" ON "DeliveryRecord"("status");

-- CreateIndex
CREATE INDEX "ConferenceNote_org_id_idx" ON "ConferenceNote"("org_id");

-- CreateIndex
CREATE INDEX "ConferenceNote_case_id_idx" ON "ConferenceNote"("case_id");

-- CreateIndex
CREATE INDEX "EscalationRule_org_id_idx" ON "EscalationRule"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAccessGrant_token_hash_key" ON "ExternalAccessGrant"("token_hash");

-- CreateIndex
CREATE INDEX "ExternalAccessGrant_org_id_idx" ON "ExternalAccessGrant"("org_id");

-- CreateIndex
CREATE INDEX "ExternalAccessGrant_token_hash_idx" ON "ExternalAccessGrant"("token_hash");

-- CreateIndex
CREATE INDEX "TracingReport_org_id_idx" ON "TracingReport"("org_id");

-- CreateIndex
CREATE INDEX "TracingReport_patient_id_idx" ON "TracingReport"("patient_id");

-- CreateIndex
CREATE INDEX "TracingReport_status_idx" ON "TracingReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DrugMaster_yj_code_key" ON "DrugMaster"("yj_code");

-- CreateIndex
CREATE INDEX "DrugMaster_yj_code_idx" ON "DrugMaster"("yj_code");

-- CreateIndex
CREATE INDEX "DrugMaster_receipt_code_idx" ON "DrugMaster"("receipt_code");

-- CreateIndex
CREATE INDEX "DrugMaster_drug_name_kana_idx" ON "DrugMaster"("drug_name_kana");

-- CreateIndex
CREATE INDEX "DrugMaster_therapeutic_category_idx" ON "DrugMaster"("therapeutic_category");

-- CreateIndex
CREATE INDEX "DrugPackageInsert_drug_master_id_idx" ON "DrugPackageInsert"("drug_master_id");

-- CreateIndex
CREATE INDEX "DrugInteraction_drug_a_id_idx" ON "DrugInteraction"("drug_a_id");

-- CreateIndex
CREATE INDEX "DrugInteraction_drug_b_id_idx" ON "DrugInteraction"("drug_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "DrugInteraction_drug_a_id_drug_b_id_source_key" ON "DrugInteraction"("drug_a_id", "drug_b_id", "source");

-- CreateIndex
CREATE INDEX "DrugAlertRule_alert_type_idx" ON "DrugAlertRule"("alert_type");

-- CreateIndex
CREATE INDEX "PharmacyDrugStock_org_id_idx" ON "PharmacyDrugStock"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyDrugStock_site_id_idx" ON "PharmacyDrugStock"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyDrugStock_site_id_drug_master_id_key" ON "PharmacyDrugStock"("site_id", "drug_master_id");

-- CreateIndex
CREATE INDEX "GenericDrugMapping_generic_name_idx" ON "GenericDrugMapping"("generic_name");

-- CreateIndex
CREATE INDEX "MedicationProfile_org_id_idx" ON "MedicationProfile"("org_id");

-- CreateIndex
CREATE INDEX "MedicationProfile_patient_id_idx" ON "MedicationProfile"("patient_id");

-- CreateIndex
CREATE INDEX "ResidualMedication_org_id_idx" ON "ResidualMedication"("org_id");

-- CreateIndex
CREATE INDEX "ResidualMedication_visit_record_id_idx" ON "ResidualMedication"("visit_record_id");

-- CreateIndex
CREATE INDEX "MedicationIssue_org_id_idx" ON "MedicationIssue"("org_id");

-- CreateIndex
CREATE INDEX "MedicationIssue_patient_id_idx" ON "MedicationIssue"("patient_id");

-- CreateIndex
CREATE INDEX "MedicationIssue_status_idx" ON "MedicationIssue"("status");

-- CreateIndex
CREATE INDEX "Intervention_org_id_idx" ON "Intervention"("org_id");

-- CreateIndex
CREATE INDEX "Intervention_patient_id_idx" ON "Intervention"("patient_id");

-- CreateIndex
CREATE INDEX "Task_org_id_idx" ON "Task"("org_id");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_assigned_to_idx" ON "Task"("assigned_to");

-- CreateIndex
CREATE INDEX "FirstVisitDocument_org_id_idx" ON "FirstVisitDocument"("org_id");

-- CreateIndex
CREATE INDEX "FirstVisitDocument_patient_id_idx" ON "FirstVisitDocument"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_corporate_number_key" ON "Organization"("corporate_number");

-- CreateIndex
CREATE INDEX "PharmacySite_org_id_idx" ON "PharmacySite"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_cognito_sub_key" ON "User"("cognito_sub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_org_id_idx" ON "User"("org_id");

-- CreateIndex
CREATE INDEX "User_cognito_sub_idx" ON "User"("cognito_sub");

-- CreateIndex
CREATE INDEX "Membership_org_id_idx" ON "Membership"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_user_id_org_id_site_id_key" ON "Membership"("user_id", "org_id", "site_id");

-- CreateIndex
CREATE INDEX "FacilityStandardRegistration_org_id_idx" ON "FacilityStandardRegistration"("org_id");

-- CreateIndex
CREATE INDEX "FacilityStandardRegistration_site_id_idx" ON "FacilityStandardRegistration"("site_id");

-- CreateIndex
CREATE INDEX "PharmacistCredential_org_id_idx" ON "PharmacistCredential"("org_id");

-- CreateIndex
CREATE INDEX "PharmacistCredential_user_id_idx" ON "PharmacistCredential"("user_id");

-- CreateIndex
CREATE INDEX "PharmacistShift_org_id_idx" ON "PharmacistShift"("org_id");

-- CreateIndex
CREATE INDEX "PharmacistShift_site_id_date_idx" ON "PharmacistShift"("site_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacistShift_user_id_date_key" ON "PharmacistShift"("user_id", "date");

-- CreateIndex
CREATE INDEX "Patient_org_id_idx" ON "Patient"("org_id");

-- CreateIndex
CREATE INDEX "Patient_name_kana_idx" ON "Patient"("name_kana");

-- CreateIndex
CREATE INDEX "Residence_org_id_idx" ON "Residence"("org_id");

-- CreateIndex
CREATE INDEX "Residence_patient_id_idx" ON "Residence"("patient_id");

-- CreateIndex
CREATE INDEX "CareCase_org_id_idx" ON "CareCase"("org_id");

-- CreateIndex
CREATE INDEX "CareCase_patient_id_idx" ON "CareCase"("patient_id");

-- CreateIndex
CREATE INDEX "CareCase_status_idx" ON "CareCase"("status");

-- CreateIndex
CREATE INDEX "ContactParty_org_id_idx" ON "ContactParty"("org_id");

-- CreateIndex
CREATE INDEX "ContactParty_patient_id_idx" ON "ContactParty"("patient_id");

-- CreateIndex
CREATE INDEX "CareTeamLink_org_id_idx" ON "CareTeamLink"("org_id");

-- CreateIndex
CREATE INDEX "CareTeamLink_case_id_idx" ON "CareTeamLink"("case_id");

-- CreateIndex
CREATE INDEX "ConsentRecord_org_id_idx" ON "ConsentRecord"("org_id");

-- CreateIndex
CREATE INDEX "ConsentRecord_patient_id_idx" ON "ConsentRecord"("patient_id");

-- CreateIndex
CREATE INDEX "ManagementPlan_org_id_idx" ON "ManagementPlan"("org_id");

-- CreateIndex
CREATE INDEX "ManagementPlan_case_id_idx" ON "ManagementPlan"("case_id");

-- CreateIndex
CREATE INDEX "MedicationCycle_org_id_idx" ON "MedicationCycle"("org_id");

-- CreateIndex
CREATE INDEX "MedicationCycle_case_id_idx" ON "MedicationCycle"("case_id");

-- CreateIndex
CREATE INDEX "MedicationCycle_overall_status_idx" ON "MedicationCycle"("overall_status");

-- CreateIndex
CREATE INDEX "PrescriptionIntake_org_id_idx" ON "PrescriptionIntake"("org_id");

-- CreateIndex
CREATE INDEX "PrescriptionIntake_cycle_id_idx" ON "PrescriptionIntake"("cycle_id");

-- CreateIndex
CREATE INDEX "PrescriptionLine_org_id_idx" ON "PrescriptionLine"("org_id");

-- CreateIndex
CREATE INDEX "PrescriptionLine_intake_id_idx" ON "PrescriptionLine"("intake_id");

-- CreateIndex
CREATE INDEX "InquiryRecord_org_id_idx" ON "InquiryRecord"("org_id");

-- CreateIndex
CREATE INDEX "InquiryRecord_cycle_id_idx" ON "InquiryRecord"("cycle_id");

-- CreateIndex
CREATE INDEX "DispenseTask_org_id_idx" ON "DispenseTask"("org_id");

-- CreateIndex
CREATE INDEX "DispenseTask_status_idx" ON "DispenseTask"("status");

-- CreateIndex
CREATE INDEX "DispenseResult_org_id_idx" ON "DispenseResult"("org_id");

-- CreateIndex
CREATE INDEX "DispenseResult_task_id_idx" ON "DispenseResult"("task_id");

-- CreateIndex
CREATE INDEX "DispenseAudit_org_id_idx" ON "DispenseAudit"("org_id");

-- CreateIndex
CREATE INDEX "DispenseAudit_task_id_idx" ON "DispenseAudit"("task_id");

-- CreateIndex
CREATE INDEX "SetPlan_org_id_idx" ON "SetPlan"("org_id");

-- CreateIndex
CREATE INDEX "SetPlan_cycle_id_idx" ON "SetPlan"("cycle_id");

-- CreateIndex
CREATE INDEX "SetBatch_org_id_idx" ON "SetBatch"("org_id");

-- CreateIndex
CREATE INDEX "SetBatch_plan_id_idx" ON "SetBatch"("plan_id");

-- CreateIndex
CREATE INDEX "SetAudit_org_id_idx" ON "SetAudit"("org_id");

-- CreateIndex
CREATE INDEX "SetAudit_plan_id_idx" ON "SetAudit"("plan_id");

-- CreateIndex
CREATE INDEX "WorkflowException_org_id_idx" ON "WorkflowException"("org_id");

-- CreateIndex
CREATE INDEX "WorkflowException_status_idx" ON "WorkflowException"("status");

-- CreateIndex
CREATE INDEX "VisitSchedule_org_id_idx" ON "VisitSchedule"("org_id");

-- CreateIndex
CREATE INDEX "VisitSchedule_scheduled_date_idx" ON "VisitSchedule"("scheduled_date");

-- CreateIndex
CREATE INDEX "VisitSchedule_pharmacist_id_idx" ON "VisitSchedule"("pharmacist_id");

-- CreateIndex
CREATE INDEX "VisitSchedule_schedule_status_idx" ON "VisitSchedule"("schedule_status");

-- CreateIndex
CREATE INDEX "VisitSchedule_case_id_idx" ON "VisitSchedule"("case_id");

-- CreateIndex
CREATE INDEX "FacilityVisitBatch_org_id_idx" ON "FacilityVisitBatch"("org_id");

-- CreateIndex
CREATE INDEX "FacilityVisitBatch_scheduled_date_idx" ON "FacilityVisitBatch"("scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "VisitRecord_schedule_id_key" ON "VisitRecord"("schedule_id");

-- CreateIndex
CREATE INDEX "VisitRecord_org_id_idx" ON "VisitRecord"("org_id");

-- CreateIndex
CREATE INDEX "VisitRecord_patient_id_idx" ON "VisitRecord"("patient_id");

-- CreateIndex
CREATE INDEX "VisitRecord_visit_date_idx" ON "VisitRecord"("visit_date");

-- CreateIndex
CREATE INDEX "VisitRecord_schedule_id_idx" ON "VisitRecord"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "VisitPreparation_schedule_id_key" ON "VisitPreparation"("schedule_id");

-- CreateIndex
CREATE INDEX "VisitPreparation_org_id_idx" ON "VisitPreparation"("org_id");

-- CreateIndex
CREATE INDEX "VisitPreparation_schedule_id_idx" ON "VisitPreparation"("schedule_id");

-- AddForeignKey
ALTER TABLE "CommunicationResponse" ADD CONSTRAINT "CommunicationResponse_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "CommunicationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "CareReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TracingReport" ADD CONSTRAINT "TracingReport_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "MedicationIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugPackageInsert" ADD CONSTRAINT "DrugPackageInsert_drug_master_id_fkey" FOREIGN KEY ("drug_master_id") REFERENCES "DrugMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugInteraction" ADD CONSTRAINT "DrugInteraction_drug_a_id_fkey" FOREIGN KEY ("drug_a_id") REFERENCES "DrugMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugInteraction" ADD CONSTRAINT "DrugInteraction_drug_b_id_fkey" FOREIGN KEY ("drug_b_id") REFERENCES "DrugMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyDrugStock" ADD CONSTRAINT "PharmacyDrugStock_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyDrugStock" ADD CONSTRAINT "PharmacyDrugStock_drug_master_id_fkey" FOREIGN KEY ("drug_master_id") REFERENCES "DrugMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyDrugStock" ADD CONSTRAINT "PharmacyDrugStock_preferred_generic_id_fkey" FOREIGN KEY ("preferred_generic_id") REFERENCES "DrugMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationProfile" ADD CONSTRAINT "MedicationProfile_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "MedicationIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySite" ADD CONSTRAINT "PharmacySite_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityStandardRegistration" ADD CONSTRAINT "FacilityStandardRegistration_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistCredential" ADD CONSTRAINT "PharmacistCredential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistShift" ADD CONSTRAINT "PharmacistShift_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistShift" ADD CONSTRAINT "PharmacistShift_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Residence" ADD CONSTRAINT "Residence_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCase" ADD CONSTRAINT "CareCase_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactParty" ADD CONSTRAINT "ContactParty_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTeamLink" ADD CONSTRAINT "CareTeamLink_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "CareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementPlan" ADD CONSTRAINT "ManagementPlan_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "CareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationCycle" ADD CONSTRAINT "MedicationCycle_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "CareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionIntake" ADD CONSTRAINT "PrescriptionIntake_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "PrescriptionIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryRecord" ADD CONSTRAINT "InquiryRecord_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryRecord" ADD CONSTRAINT "InquiryRecord_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "PrescriptionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseTask" ADD CONSTRAINT "DispenseTask_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseResult" ADD CONSTRAINT "DispenseResult_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "DispenseTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseResult" ADD CONSTRAINT "DispenseResult_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "PrescriptionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseAudit" ADD CONSTRAINT "DispenseAudit_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "DispenseTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetPlan" ADD CONSTRAINT "SetPlan_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetBatch" ADD CONSTRAINT "SetBatch_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "SetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetBatch" ADD CONSTRAINT "SetBatch_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "PrescriptionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAudit" ADD CONSTRAINT "SetAudit_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "SetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowException" ADD CONSTRAINT "WorkflowException_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSchedule" ADD CONSTRAINT "VisitSchedule_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSchedule" ADD CONSTRAINT "VisitSchedule_facility_batch_id_fkey" FOREIGN KEY ("facility_batch_id") REFERENCES "FacilityVisitBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitPreparation" ADD CONSTRAINT "VisitPreparation_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- RLS policies from baseline schema

-- =============================================================================
-- CareViaX: Row Level Security (RLS) Policies
-- Purpose: Tenant isolation by org_id for all multi-tenant tables
-- Usage: Run via psql or as a Prisma migration after schema creation
-- Prerequisite: Application connects with role 'app_user' (not superuser)
-- =============================================================================

-- Create application role if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- Grant usage to app_user on public schema
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- =============================================================================
-- Helper: Enable RLS + create tenant isolation policy for a table
-- Policy uses current_setting('app.current_org_id', true) which is set per
-- transaction via SET LOCAL in withOrgContext (src/lib/db/rls.ts)
-- =============================================================================

-- ─── Patient Domain ─────────────────────────────────────────────────────────

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Patient"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Residence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Residence"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CareCase" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareCase"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ContactParty" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ContactParty"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CareTeamLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareTeamLink"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ManagementPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ManagementPlan"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Prescription / Workflow Domain ─────────────────────────────────────────

ALTER TABLE "MedicationCycle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationCycle"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PrescriptionIntake" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PrescriptionIntake"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PrescriptionLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PrescriptionLine"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "InquiryRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InquiryRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispenseTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispenseTask"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispenseResult" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispenseResult"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DispenseAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DispenseAudit"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetPlan"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetBatch"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SetAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SetAudit"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "WorkflowException" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkflowException"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Visit Domain ───────────────────────────────────────────────────────────

ALTER TABLE "VisitSchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitSchedule"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "FacilityVisitBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FacilityVisitBatch"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "VisitRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "VisitPreparation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitPreparation"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Communication Domain ───────────────────────────────────────────────────

ALTER TABLE "CommunicationEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunicationEvent"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CommunicationRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunicationRequest"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CommunicationResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommunicationResponse"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "CareReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareReport"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "DeliveryRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeliveryRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ConferenceNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConferenceNote"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "EscalationRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EscalationRule"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ExternalAccessGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExternalAccessGrant"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "TracingReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TracingReport"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Medication Domain ──────────────────────────────────────────────────────

ALTER TABLE "MedicationProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationProfile"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "ResidualMedication" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ResidualMedication"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "MedicationIssue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationIssue"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Intervention" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Intervention"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "FirstVisitDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FirstVisitDocument"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Organization Domain ────────────────────────────────────────────────────

ALTER TABLE "PharmacySite" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacySite"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "FacilityStandardRegistration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FacilityStandardRegistration"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PharmacistCredential" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacistCredential"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "PharmacistShift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacistShift"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Admin Domain ───────────────────────────────────────────────────────────

ALTER TABLE "BillingCandidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingCandidate"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "BillingEvidence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingEvidence"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Template"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Setting"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

ALTER TABLE "SourceOfTruthMatrix" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SourceOfTruthMatrix"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── Drug Domain (org-scoped only) ─────────────────────────────────────────
-- Note: DrugMaster, DrugPackageInsert, DrugInteraction, DrugAlertRule,
-- GenericDrugMapping, DrugMasterImportLog are global (no org_id) = NO RLS

ALTER TABLE "PharmacyDrugStock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacyDrugStock"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ─── IntegrationJob (org_id is nullable) ────────────────────────────────────
-- IntegrationJob.org_id is String? (nullable) — skip RLS for safety
-- Jobs with null org_id are system-level and should be accessible regardless

-- ─── LabelDictionary (no org_id) ────────────────────────────────────────────
-- Global dictionary, no RLS needed

-- =============================================================================
-- Force RLS for app_user role (bypass for superuser/migration role)
-- =============================================================================
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Residence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareCase" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ContactParty" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareTeamLink" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ManagementPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MedicationCycle" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PrescriptionIntake" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PrescriptionLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InquiryRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispenseTask" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispenseResult" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DispenseAudit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SetAudit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowException" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitSchedule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FacilityVisitBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VisitPreparation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommunicationResponse" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CareReport" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConferenceNote" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EscalationRule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ExternalAccessGrant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TracingReport" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MedicationProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ResidualMedication" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MedicationIssue" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Intervention" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FirstVisitDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacySite" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FacilityStandardRegistration" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacistCredential" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacistShift" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BillingCandidate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BillingEvidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Template" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Setting" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SourceOfTruthMatrix" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PharmacyDrugStock" FORCE ROW LEVEL SECURITY;
