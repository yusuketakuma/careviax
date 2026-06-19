-- CreateEnum
CREATE TYPE "PartnerPharmacyStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "PharmacyPartnershipStatus" AS ENUM ('draft', 'active', 'suspended', 'ended');

-- CreateEnum
CREATE TYPE "PatientShareCaseStatus" AS ENUM ('draft', 'pending_partner', 'active', 'suspended', 'revoked', 'ended');

-- CreateEnum
CREATE TYPE "PatientLinkStatus" AS ENUM ('pending', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "PatientShareCorrectionTargetOwner" AS ENUM ('base_pharmacy', 'partner_pharmacy');

-- CreateEnum
CREATE TYPE "PatientShareCorrectionStatus" AS ENUM ('open', 'responded', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "PharmacyVisitRequestStatus" AS ENUM ('draft', 'requested', 'accepted', 'declined', 'cancelled', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "PartnerVisitRecordStatus" AS ENUM ('draft', 'submitted', 'confirmed', 'returned', 'superseded');

-- CreateEnum
CREATE TYPE "PharmacyContractStatus" AS ENUM ('draft', 'pending_base_approval', 'pending_partner_approval', 'active', 'suspended', 'ended', 'archived');

-- CreateEnum
CREATE TYPE "PharmacyBillingModel" AS ENUM ('free', 'fixed_per_visit', 'per_visit_with_addon', 'expense_reimbursement');

-- CreateEnum
CREATE TYPE "PharmacyTaxCategory" AS ENUM ('taxable', 'tax_exempt', 'non_taxable', 'out_of_scope', 'tax_pending');

-- CreateEnum
CREATE TYPE "VisitBillingStatus" AS ENUM ('candidate', 'confirmed', 'excluded', 'invoiced', 'voided');

-- CreateEnum
CREATE TYPE "PharmacyInvoiceStatus" AS ENUM ('draft', 'issued', 'sent', 'received', 'payment_scheduled', 'paid', 'voided', 'cancelled');

-- CreateEnum
CREATE TYPE "PharmacyInvoiceDocumentKind" AS ENUM ('invoice', 'free_cooperation_report');

-- CreateTable
CREATE TABLE "PartnerPharmacy" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "pharmacy_code" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "tel" TEXT,
    "fax" TEXT,
    "emergency_tel" TEXT,
    "on_call_tel" TEXT,
    "contact_name" TEXT,
    "contact_channels" JSONB,
    "available_services" JSONB NOT NULL DEFAULT '[]',
    "service_hours" JSONB,
    "status" "PartnerPharmacyStatus" NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyPartnership" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "base_site_id" TEXT NOT NULL,
    "partner_pharmacy_id" TEXT NOT NULL,
    "status" "PharmacyPartnershipStatus" NOT NULL DEFAULT 'draft',
    "available_services" JSONB NOT NULL DEFAULT '[]',
    "contact_snapshot" JSONB,
    "effective_from" DATE,
    "effective_to" DATE,
    "approved_by_base" TEXT,
    "approved_by_partner" TEXT,
    "approved_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_reason" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyPartnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientShareCase" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "partnership_id" TEXT NOT NULL,
    "base_patient_id" TEXT NOT NULL,
    "base_case_id" TEXT,
    "status" "PatientShareCaseStatus" NOT NULL DEFAULT 'draft',
    "share_scope" JSONB NOT NULL DEFAULT '{}',
    "shared_management_plan_id" TEXT,
    "shared_management_plan_version" INTEGER,
    "consent_verified_at" TIMESTAMP(3),
    "starts_at" DATE,
    "ends_at" DATE,
    "base_pharmacy_approved_by" TEXT,
    "base_pharmacy_approved_at" TIMESTAMP(3),
    "partner_pharmacy_approved_by" TEXT,
    "partner_pharmacy_approved_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientShareCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientShareConsent" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "share_case_id" TEXT NOT NULL,
    "consent_record_id" TEXT,
    "consent_date" DATE NOT NULL,
    "consent_person" TEXT NOT NULL,
    "consent_method" "ConsentMethod" NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "file_asset_id" TEXT,
    "valid_until" DATE,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientShareConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientLink" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "share_case_id" TEXT NOT NULL,
    "base_patient_id" TEXT NOT NULL,
    "partner_patient_id" TEXT,
    "match_status" "PatientLinkStatus" NOT NULL DEFAULT 'pending',
    "base_patient_snapshot" JSONB NOT NULL,
    "partner_patient_snapshot" JSONB,
    "approved_by_base" TEXT,
    "approved_by_partner" TEXT,
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientShareCorrectionRequest" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "share_case_id" TEXT NOT NULL,
    "target_owner" "PatientShareCorrectionTargetOwner" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "field_path" TEXT,
    "request_type" TEXT NOT NULL DEFAULT 'correction',
    "reason" TEXT NOT NULL,
    "proposed_value" JSONB,
    "status" "PatientShareCorrectionStatus" NOT NULL DEFAULT 'open',
    "requested_by" TEXT NOT NULL,
    "responded_by" TEXT,
    "response_note" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientShareCorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyVisitRequest" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "share_case_id" TEXT NOT NULL,
    "partnership_id" TEXT NOT NULL,
    "partner_pharmacy_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "desired_start_at" TIMESTAMP(3),
    "desired_end_at" TIMESTAMP(3),
    "visit_type" "VisitType",
    "status" "PharmacyVisitRequestStatus" NOT NULL DEFAULT 'draft',
    "request_reason" TEXT NOT NULL,
    "physician_instruction" TEXT,
    "carry_items" JSONB,
    "patient_home_notes" TEXT,
    "contract_id" TEXT,
    "contract_version_id" TEXT,
    "estimated_amount" INTEGER,
    "estimated_snapshot" JSONB,
    "accepted_by" TEXT,
    "accepted_at" TIMESTAMP(3),
    "declined_by" TEXT,
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyVisitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerVisitRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "visit_request_id" TEXT NOT NULL,
    "share_case_id" TEXT NOT NULL,
    "owner_partner_pharmacy_id" TEXT NOT NULL,
    "source_visit_record_id" TEXT,
    "revision_no" INTEGER NOT NULL DEFAULT 1,
    "status" "PartnerVisitRecordStatus" NOT NULL DEFAULT 'draft',
    "pharmacist_id" TEXT,
    "pharmacist_name" TEXT,
    "visit_at" TIMESTAMP(3) NOT NULL,
    "record_content" JSONB NOT NULL,
    "attachments" JSONB,
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "returned_at" TIMESTAMP(3),
    "returned_by" TEXT,
    "returned_reason" TEXT,
    "base_confirmation_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerVisitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimCooperationNote" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "partner_visit_record_id" TEXT NOT NULL,
    "partner_pharmacy_name" TEXT NOT NULL,
    "visit_date" DATE NOT NULL,
    "prescription_received_by" TEXT,
    "dispensing_pharmacy_id" TEXT,
    "dispensing_pharmacy_name" TEXT,
    "claim_status" TEXT NOT NULL DEFAULT 'pending',
    "claim_note_text" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimCooperationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyContract" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "partnership_id" TEXT NOT NULL,
    "status" "PharmacyContractStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE,
    "effective_to" DATE,
    "closing_day" INTEGER,
    "payment_due_rule" JSONB,
    "base_approved_by" TEXT,
    "base_approved_at" TIMESTAMP(3),
    "partner_approved_by" TEXT,
    "partner_approved_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyContractVersion" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "document_file_id" TEXT,
    "change_reason" TEXT,
    "terms_snapshot" JSONB NOT NULL DEFAULT '{}',
    "approved_by_base" TEXT,
    "approved_by_partner" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyContractFeeRule" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contract_version_id" TEXT NOT NULL,
    "billing_model" "PharmacyBillingModel" NOT NULL DEFAULT 'free',
    "unit_price" INTEGER,
    "addon_rules" JSONB,
    "expense_rules" JSONB,
    "tax_category" "PharmacyTaxCategory" NOT NULL DEFAULT 'tax_pending',
    "tax_rate_bp" INTEGER,
    "rounding_rule" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyContractFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitBillingCandidate" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "partner_visit_record_id" TEXT NOT NULL,
    "contract_version_id" TEXT,
    "billing_month" DATE NOT NULL,
    "billing_status" "VisitBillingStatus" NOT NULL DEFAULT 'candidate',
    "is_billable" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" TEXT,
    "amount_snapshot" JSONB NOT NULL DEFAULT '{}',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitBillingCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyInvoice" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "document_kind" "PharmacyInvoiceDocumentKind" NOT NULL DEFAULT 'invoice',
    "invoice_no" TEXT,
    "billing_month" DATE NOT NULL,
    "issuer_snapshot" JSONB NOT NULL DEFAULT '{}',
    "recipient_snapshot" JSONB NOT NULL DEFAULT '{}',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "status" "PharmacyInvoiceStatus" NOT NULL DEFAULT 'draft',
    "pdf_file_id" TEXT,
    "issued_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyInvoiceItem" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "visit_billing_candidate_id" TEXT,
    "visit_date" DATE,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "tax_category" "PharmacyTaxCategory" NOT NULL DEFAULT 'tax_pending',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDocument" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version_id" TEXT,
    "template_id" TEXT,
    "file_id" TEXT,
    "document_type" TEXT NOT NULL DEFAULT 'basic_contract',
    "hash_value" TEXT,
    "signed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDocument_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CareReport" ADD COLUMN "partner_visit_record_id" TEXT;

-- CreateIndex
CREATE INDEX "PartnerPharmacy_org_id_idx" ON "PartnerPharmacy"("org_id");

-- CreateIndex
CREATE INDEX "PartnerPharmacy_status_idx" ON "PartnerPharmacy"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPharmacy_id_org_id_key" ON "PartnerPharmacy"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPharmacy_org_id_pharmacy_code_key" ON "PartnerPharmacy"("org_id", "pharmacy_code");

-- CreateIndex
CREATE INDEX "PharmacyPartnership_org_id_idx" ON "PharmacyPartnership"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyPartnership_org_id_base_site_id_idx" ON "PharmacyPartnership"("org_id", "base_site_id");

-- CreateIndex
CREATE INDEX "PharmacyPartnership_org_id_partner_pharmacy_id_idx" ON "PharmacyPartnership"("org_id", "partner_pharmacy_id");

-- CreateIndex
CREATE INDEX "PharmacyPartnership_status_idx" ON "PharmacyPartnership"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyPartnership_id_org_id_key" ON "PharmacyPartnership"("id", "org_id");

-- CreateIndex
CREATE INDEX "PatientShareCase_org_id_idx" ON "PatientShareCase"("org_id");

-- CreateIndex
CREATE INDEX "PatientShareCase_org_id_partnership_id_idx" ON "PatientShareCase"("org_id", "partnership_id");

-- CreateIndex
CREATE INDEX "PatientShareCase_org_id_base_patient_id_idx" ON "PatientShareCase"("org_id", "base_patient_id");

-- CreateIndex
CREATE INDEX "PatientShareCase_org_id_base_case_id_idx" ON "PatientShareCase"("org_id", "base_case_id");

-- CreateIndex
CREATE INDEX "PatientShareCase_status_idx" ON "PatientShareCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientShareCase_id_org_id_key" ON "PatientShareCase"("id", "org_id");

-- CreateIndex
CREATE INDEX "PatientShareConsent_org_id_idx" ON "PatientShareConsent"("org_id");

-- CreateIndex
CREATE INDEX "PatientShareConsent_org_id_share_case_id_idx" ON "PatientShareConsent"("org_id", "share_case_id");

-- CreateIndex
CREATE INDEX "PatientShareConsent_org_id_consent_record_id_idx" ON "PatientShareConsent"("org_id", "consent_record_id");

-- CreateIndex
CREATE INDEX "PatientShareConsent_revoked_at_idx" ON "PatientShareConsent"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "PatientShareConsent_id_org_id_key" ON "PatientShareConsent"("id", "org_id");

-- CreateIndex
CREATE INDEX "PatientLink_org_id_idx" ON "PatientLink"("org_id");

-- CreateIndex
CREATE INDEX "PatientLink_org_id_base_patient_id_idx" ON "PatientLink"("org_id", "base_patient_id");

-- CreateIndex
CREATE INDEX "PatientLink_match_status_idx" ON "PatientLink"("match_status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientLink_id_org_id_key" ON "PatientLink"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "PatientLink_share_case_id_org_id_key" ON "PatientLink"("share_case_id", "org_id");

-- CreateIndex
CREATE INDEX "PatientShareCorrectionRequest_org_id_idx" ON "PatientShareCorrectionRequest"("org_id");

-- CreateIndex
CREATE INDEX "PatientShareCorrectionRequest_org_id_share_case_id_idx" ON "PatientShareCorrectionRequest"("org_id", "share_case_id");

-- CreateIndex
CREATE INDEX "PatientShareCorrectionRequest_target_owner_idx" ON "PatientShareCorrectionRequest"("target_owner");

-- CreateIndex
CREATE INDEX "PatientShareCorrectionRequest_status_idx" ON "PatientShareCorrectionRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientShareCorrectionRequest_id_org_id_key" ON "PatientShareCorrectionRequest"("id", "org_id");

-- CreateIndex
CREATE INDEX "PharmacyVisitRequest_org_id_idx" ON "PharmacyVisitRequest"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyVisitRequest_org_id_share_case_id_idx" ON "PharmacyVisitRequest"("org_id", "share_case_id");

-- CreateIndex
CREATE INDEX "PharmacyVisitRequest_org_id_partnership_id_idx" ON "PharmacyVisitRequest"("org_id", "partnership_id");

-- CreateIndex
CREATE INDEX "PharmacyVisitRequest_org_id_partner_pharmacy_id_idx" ON "PharmacyVisitRequest"("org_id", "partner_pharmacy_id");

-- CreateIndex
CREATE INDEX "PharmacyVisitRequest_status_idx" ON "PharmacyVisitRequest"("status");

-- CreateIndex
CREATE INDEX "PharmacyVisitRequest_desired_start_at_idx" ON "PharmacyVisitRequest"("desired_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyVisitRequest_id_org_id_key" ON "PharmacyVisitRequest"("id", "org_id");

-- CreateIndex
CREATE INDEX "PartnerVisitRecord_org_id_idx" ON "PartnerVisitRecord"("org_id");

-- CreateIndex
CREATE INDEX "PartnerVisitRecord_org_id_share_case_id_idx" ON "PartnerVisitRecord"("org_id", "share_case_id");

-- CreateIndex
CREATE INDEX "PartnerVisitRecord_org_id_owner_partner_pharmacy_id_idx" ON "PartnerVisitRecord"("org_id", "owner_partner_pharmacy_id");

-- CreateIndex
CREATE INDEX "PartnerVisitRecord_status_idx" ON "PartnerVisitRecord"("status");

-- CreateIndex
CREATE INDEX "PartnerVisitRecord_visit_at_idx" ON "PartnerVisitRecord"("visit_at");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerVisitRecord_id_org_id_key" ON "PartnerVisitRecord"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerVisitRecord_org_id_visit_request_id_revision_no_key" ON "PartnerVisitRecord"("org_id", "visit_request_id", "revision_no");

-- CreateIndex
CREATE INDEX "CareReport_org_id_partner_visit_record_id_idx" ON "CareReport"("org_id", "partner_visit_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "CareReport_org_partner_visit_report_type_key" ON "CareReport"("org_id", "partner_visit_record_id", "report_type");

-- CreateIndex
CREATE INDEX "ClaimCooperationNote_org_id_idx" ON "ClaimCooperationNote"("org_id");

-- CreateIndex
CREATE INDEX "ClaimCooperationNote_claim_status_idx" ON "ClaimCooperationNote"("claim_status");

-- CreateIndex
CREATE INDEX "ClaimCooperationNote_visit_date_idx" ON "ClaimCooperationNote"("visit_date");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimCooperationNote_id_org_id_key" ON "ClaimCooperationNote"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimCooperationNote_partner_visit_record_id_org_id_key" ON "ClaimCooperationNote"("partner_visit_record_id", "org_id");

-- CreateIndex
CREATE INDEX "PharmacyContract_org_id_idx" ON "PharmacyContract"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyContract_org_id_partnership_id_idx" ON "PharmacyContract"("org_id", "partnership_id");

-- CreateIndex
CREATE INDEX "PharmacyContract_status_idx" ON "PharmacyContract"("status");

-- CreateIndex
CREATE INDEX "PharmacyContract_effective_from_effective_to_idx" ON "PharmacyContract"("effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyContract_id_org_id_key" ON "PharmacyContract"("id", "org_id");

-- CreateIndex
CREATE INDEX "PharmacyContractVersion_org_id_idx" ON "PharmacyContractVersion"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyContractVersion_org_id_contract_id_idx" ON "PharmacyContractVersion"("org_id", "contract_id");

-- CreateIndex
CREATE INDEX "PharmacyContractVersion_effective_from_effective_to_idx" ON "PharmacyContractVersion"("effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyContractVersion_id_org_id_key" ON "PharmacyContractVersion"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyContractVersion_org_id_contract_id_version_no_key" ON "PharmacyContractVersion"("org_id", "contract_id", "version_no");

-- CreateIndex
CREATE INDEX "PharmacyContractFeeRule_org_id_idx" ON "PharmacyContractFeeRule"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyContractFeeRule_org_id_contract_version_id_idx" ON "PharmacyContractFeeRule"("org_id", "contract_version_id");

-- CreateIndex
CREATE INDEX "PharmacyContractFeeRule_billing_model_idx" ON "PharmacyContractFeeRule"("billing_model");

-- CreateIndex
CREATE INDEX "PharmacyContractFeeRule_is_active_idx" ON "PharmacyContractFeeRule"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyContractFeeRule_id_org_id_key" ON "PharmacyContractFeeRule"("id", "org_id");

-- CreateIndex
CREATE INDEX "VisitBillingCandidate_org_id_idx" ON "VisitBillingCandidate"("org_id");

-- CreateIndex
CREATE INDEX "VisitBillingCandidate_org_id_billing_month_idx" ON "VisitBillingCandidate"("org_id", "billing_month");

-- CreateIndex
CREATE INDEX "VisitBillingCandidate_org_id_contract_version_id_idx" ON "VisitBillingCandidate"("org_id", "contract_version_id");

-- CreateIndex
CREATE INDEX "VisitBillingCandidate_billing_status_idx" ON "VisitBillingCandidate"("billing_status");

-- CreateIndex
CREATE UNIQUE INDEX "VisitBillingCandidate_id_org_id_key" ON "VisitBillingCandidate"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "VisitBillingCandidate_org_id_partner_visit_record_id_key" ON "VisitBillingCandidate"("org_id", "partner_visit_record_id");

-- CreateIndex
CREATE INDEX "PharmacyInvoice_org_id_idx" ON "PharmacyInvoice"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyInvoice_org_id_contract_id_idx" ON "PharmacyInvoice"("org_id", "contract_id");

-- CreateIndex
CREATE INDEX "PharmacyInvoice_org_id_billing_month_idx" ON "PharmacyInvoice"("org_id", "billing_month");

-- CreateIndex
CREATE INDEX "PharmacyInvoice_org_id_billing_month_document_kind_idx" ON "PharmacyInvoice"("org_id", "billing_month", "document_kind");

-- CreateIndex
CREATE INDEX "PharmacyInvoice_status_idx" ON "PharmacyInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyInvoice_id_org_id_key" ON "PharmacyInvoice"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyInvoice_org_id_invoice_no_key" ON "PharmacyInvoice"("org_id", "invoice_no");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyInvoice_active_document_unique_idx" ON "PharmacyInvoice"("org_id", "contract_id", "billing_month", "document_kind") WHERE "status" IN ('draft', 'issued', 'sent', 'received', 'payment_scheduled', 'paid');

-- CreateIndex
CREATE INDEX "PharmacyInvoiceItem_org_id_idx" ON "PharmacyInvoiceItem"("org_id");

-- CreateIndex
CREATE INDEX "PharmacyInvoiceItem_org_id_invoice_id_idx" ON "PharmacyInvoiceItem"("org_id", "invoice_id");

-- CreateIndex
CREATE INDEX "PharmacyInvoiceItem_org_id_visit_billing_candidate_id_idx" ON "PharmacyInvoiceItem"("org_id", "visit_billing_candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyInvoiceItem_org_id_visit_billing_candidate_id_key" ON "PharmacyInvoiceItem"("org_id", "visit_billing_candidate_id");

-- CreateIndex
CREATE INDEX "PharmacyInvoiceItem_visit_date_idx" ON "PharmacyInvoiceItem"("visit_date");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyInvoiceItem_id_org_id_key" ON "PharmacyInvoiceItem"("id", "org_id");

-- CreateIndex
CREATE INDEX "ContractDocument_org_id_idx" ON "ContractDocument"("org_id");

-- CreateIndex
CREATE INDEX "ContractDocument_org_id_contract_id_idx" ON "ContractDocument"("org_id", "contract_id");

-- CreateIndex
CREATE INDEX "ContractDocument_org_id_version_id_idx" ON "ContractDocument"("org_id", "version_id");

-- CreateIndex
CREATE INDEX "ContractDocument_document_type_idx" ON "ContractDocument"("document_type");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDocument_id_org_id_key" ON "ContractDocument"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_id_org_id_key" ON "Patient"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "CareCase_id_org_id_key" ON "CareCase"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_id_org_id_key" ON "ConsentRecord"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "VisitRecord_id_org_id_key" ON "VisitRecord"("id", "org_id");

-- AddForeignKey
ALTER TABLE "PartnerPharmacy" ADD CONSTRAINT "PartnerPharmacy_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPartnership" ADD CONSTRAINT "PharmacyPartnership_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPartnership" ADD CONSTRAINT "PharmacyPartnership_base_site_id_org_id_fkey" FOREIGN KEY ("base_site_id", "org_id") REFERENCES "PharmacySite"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPartnership" ADD CONSTRAINT "PharmacyPartnership_partner_pharmacy_id_org_id_fkey" FOREIGN KEY ("partner_pharmacy_id", "org_id") REFERENCES "PartnerPharmacy"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareCase" ADD CONSTRAINT "PatientShareCase_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareCase" ADD CONSTRAINT "PatientShareCase_partnership_id_org_id_fkey" FOREIGN KEY ("partnership_id", "org_id") REFERENCES "PharmacyPartnership"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareCase" ADD CONSTRAINT "PatientShareCase_base_patient_id_org_id_fkey" FOREIGN KEY ("base_patient_id", "org_id") REFERENCES "Patient"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareCase" ADD CONSTRAINT "PatientShareCase_base_case_id_org_id_fkey" FOREIGN KEY ("base_case_id", "org_id") REFERENCES "CareCase"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareConsent" ADD CONSTRAINT "PatientShareConsent_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareConsent" ADD CONSTRAINT "PatientShareConsent_share_case_id_org_id_fkey" FOREIGN KEY ("share_case_id", "org_id") REFERENCES "PatientShareCase"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareConsent" ADD CONSTRAINT "PatientShareConsent_consent_record_id_org_id_fkey" FOREIGN KEY ("consent_record_id", "org_id") REFERENCES "ConsentRecord"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLink" ADD CONSTRAINT "PatientLink_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLink" ADD CONSTRAINT "PatientLink_share_case_id_org_id_fkey" FOREIGN KEY ("share_case_id", "org_id") REFERENCES "PatientShareCase"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareCorrectionRequest" ADD CONSTRAINT "PatientShareCorrectionRequest_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientShareCorrectionRequest" ADD CONSTRAINT "PatientShareCorrectionRequest_share_case_id_org_id_fkey" FOREIGN KEY ("share_case_id", "org_id") REFERENCES "PatientShareCase"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyVisitRequest" ADD CONSTRAINT "PharmacyVisitRequest_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyVisitRequest" ADD CONSTRAINT "PharmacyVisitRequest_share_case_id_org_id_fkey" FOREIGN KEY ("share_case_id", "org_id") REFERENCES "PatientShareCase"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyVisitRequest" ADD CONSTRAINT "PharmacyVisitRequest_partnership_id_org_id_fkey" FOREIGN KEY ("partnership_id", "org_id") REFERENCES "PharmacyPartnership"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyVisitRequest" ADD CONSTRAINT "PharmacyVisitRequest_partner_pharmacy_id_org_id_fkey" FOREIGN KEY ("partner_pharmacy_id", "org_id") REFERENCES "PartnerPharmacy"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVisitRecord" ADD CONSTRAINT "PartnerVisitRecord_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVisitRecord" ADD CONSTRAINT "PartnerVisitRecord_visit_request_id_org_id_fkey" FOREIGN KEY ("visit_request_id", "org_id") REFERENCES "PharmacyVisitRequest"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVisitRecord" ADD CONSTRAINT "PartnerVisitRecord_share_case_id_org_id_fkey" FOREIGN KEY ("share_case_id", "org_id") REFERENCES "PatientShareCase"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVisitRecord" ADD CONSTRAINT "PartnerVisitRecord_owner_partner_pharmacy_id_org_id_fkey" FOREIGN KEY ("owner_partner_pharmacy_id", "org_id") REFERENCES "PartnerPharmacy"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVisitRecord" ADD CONSTRAINT "PartnerVisitRecord_source_visit_record_id_org_id_fkey" FOREIGN KEY ("source_visit_record_id", "org_id") REFERENCES "VisitRecord"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_partner_visit_record_id_org_id_fkey" FOREIGN KEY ("partner_visit_record_id", "org_id") REFERENCES "PartnerVisitRecord"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimCooperationNote" ADD CONSTRAINT "ClaimCooperationNote_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimCooperationNote" ADD CONSTRAINT "ClaimCooperationNote_partner_visit_record_id_org_id_fkey" FOREIGN KEY ("partner_visit_record_id", "org_id") REFERENCES "PartnerVisitRecord"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContract" ADD CONSTRAINT "PharmacyContract_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContract" ADD CONSTRAINT "PharmacyContract_partnership_id_org_id_fkey" FOREIGN KEY ("partnership_id", "org_id") REFERENCES "PharmacyPartnership"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContractVersion" ADD CONSTRAINT "PharmacyContractVersion_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContractVersion" ADD CONSTRAINT "PharmacyContractVersion_contract_id_org_id_fkey" FOREIGN KEY ("contract_id", "org_id") REFERENCES "PharmacyContract"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContractFeeRule" ADD CONSTRAINT "PharmacyContractFeeRule_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContractFeeRule" ADD CONSTRAINT "PharmacyContractFeeRule_contract_version_id_org_id_fkey" FOREIGN KEY ("contract_version_id", "org_id") REFERENCES "PharmacyContractVersion"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitBillingCandidate" ADD CONSTRAINT "VisitBillingCandidate_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitBillingCandidate" ADD CONSTRAINT "VisitBillingCandidate_partner_visit_record_id_org_id_fkey" FOREIGN KEY ("partner_visit_record_id", "org_id") REFERENCES "PartnerVisitRecord"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitBillingCandidate" ADD CONSTRAINT "VisitBillingCandidate_contract_version_id_org_id_fkey" FOREIGN KEY ("contract_version_id", "org_id") REFERENCES "PharmacyContractVersion"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyInvoice" ADD CONSTRAINT "PharmacyInvoice_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyInvoice" ADD CONSTRAINT "PharmacyInvoice_contract_id_org_id_fkey" FOREIGN KEY ("contract_id", "org_id") REFERENCES "PharmacyContract"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyInvoiceItem" ADD CONSTRAINT "PharmacyInvoiceItem_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyInvoiceItem" ADD CONSTRAINT "PharmacyInvoiceItem_invoice_id_org_id_fkey" FOREIGN KEY ("invoice_id", "org_id") REFERENCES "PharmacyInvoice"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyInvoiceItem" ADD CONSTRAINT "PharmacyInvoiceItem_visit_billing_candidate_id_org_id_fkey" FOREIGN KEY ("visit_billing_candidate_id", "org_id") REFERENCES "VisitBillingCandidate"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDocument" ADD CONSTRAINT "ContractDocument_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDocument" ADD CONSTRAINT "ContractDocument_contract_id_org_id_fkey" FOREIGN KEY ("contract_id", "org_id") REFERENCES "PharmacyContract"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDocument" ADD CONSTRAINT "ContractDocument_version_id_org_id_fkey" FOREIGN KEY ("version_id", "org_id") REFERENCES "PharmacyContractVersion"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: pharmacy partnership foundation tables carry org_id and must be isolated
-- through the same failsafe helper used by newer patient/visit write models.
ALTER TABLE "PartnerPharmacy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PartnerPharmacy";
CREATE POLICY tenant_isolation ON "PartnerPharmacy"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PartnerPharmacy" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyPartnership" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyPartnership";
CREATE POLICY tenant_isolation ON "PharmacyPartnership"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyPartnership" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientShareCase" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientShareCase";
CREATE POLICY tenant_isolation ON "PatientShareCase"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientShareCase" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientShareConsent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientShareConsent";
CREATE POLICY tenant_isolation ON "PatientShareConsent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientShareConsent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientLink" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientLink";
CREATE POLICY tenant_isolation ON "PatientLink"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientLink" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PatientShareCorrectionRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientShareCorrectionRequest";
CREATE POLICY tenant_isolation ON "PatientShareCorrectionRequest"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientShareCorrectionRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyVisitRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyVisitRequest";
CREATE POLICY tenant_isolation ON "PharmacyVisitRequest"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyVisitRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PartnerVisitRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PartnerVisitRecord";
CREATE POLICY tenant_isolation ON "PartnerVisitRecord"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PartnerVisitRecord" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ClaimCooperationNote" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClaimCooperationNote";
CREATE POLICY tenant_isolation ON "ClaimCooperationNote"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ClaimCooperationNote" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyContract" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyContract";
CREATE POLICY tenant_isolation ON "PharmacyContract"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyContract" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyContractVersion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyContractVersion";
CREATE POLICY tenant_isolation ON "PharmacyContractVersion"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyContractVersion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyContractFeeRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyContractFeeRule";
CREATE POLICY tenant_isolation ON "PharmacyContractFeeRule"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyContractFeeRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VisitBillingCandidate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitBillingCandidate";
CREATE POLICY tenant_isolation ON "VisitBillingCandidate"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "VisitBillingCandidate" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyInvoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyInvoice";
CREATE POLICY tenant_isolation ON "PharmacyInvoice"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyInvoice" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacyInvoiceItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyInvoiceItem";
CREATE POLICY tenant_isolation ON "PharmacyInvoiceItem"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyInvoiceItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ContractDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ContractDocument";
CREATE POLICY tenant_isolation ON "ContractDocument"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "ContractDocument" FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS audit_log_partner_pharmacy ON "PartnerPharmacy";
CREATE TRIGGER audit_log_partner_pharmacy
AFTER INSERT OR UPDATE OR DELETE ON "PartnerPharmacy"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_pharmacy_partnership ON "PharmacyPartnership";
CREATE TRIGGER audit_log_pharmacy_partnership
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyPartnership"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_patient_share_case ON "PatientShareCase";
CREATE TRIGGER audit_log_patient_share_case
AFTER INSERT OR UPDATE OR DELETE ON "PatientShareCase"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_patient_share_consent ON "PatientShareConsent";
CREATE TRIGGER audit_log_patient_share_consent
AFTER INSERT OR UPDATE OR DELETE ON "PatientShareConsent"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

CREATE OR REPLACE FUNCTION ph_os_redact_patient_link_audit_row(row_data JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    row_data
      - 'base_patient_snapshot'
      - 'partner_patient_snapshot'
      - 'decline_reason'
      || jsonb_build_object(
        'has_base_patient_snapshot', row_data ? 'base_patient_snapshot',
        'has_partner_patient_snapshot', row_data ? 'partner_patient_snapshot',
        'decline_reason_length', length(coalesce(row_data->>'decline_reason', ''))
      )
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_patient_link_audit_log()
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
      'after', ph_os_redact_patient_link_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_patient_link_audit_row(to_jsonb(OLD)),
      'after', ph_os_redact_patient_link_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_patient_link_audit_row(to_jsonb(OLD))
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

DROP TRIGGER IF EXISTS audit_log_patient_link ON "PatientLink";
CREATE TRIGGER audit_log_patient_link
AFTER INSERT OR UPDATE OR DELETE ON "PatientLink"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_patient_link_audit_log();

CREATE OR REPLACE FUNCTION ph_os_redact_patient_share_correction_request_audit_row(row_data JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    row_data
      - 'reason'
      - 'proposed_value'
      - 'response_note'
      || jsonb_build_object(
        'reason_length', length(coalesce(row_data->>'reason', '')),
        'has_proposed_value', row_data ? 'proposed_value',
        'response_note_length', length(coalesce(row_data->>'response_note', ''))
      )
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_patient_share_correction_request_audit_log()
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
      'after', ph_os_redact_patient_share_correction_request_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_patient_share_correction_request_audit_row(to_jsonb(OLD)),
      'after', ph_os_redact_patient_share_correction_request_audit_row(to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_patient_share_correction_request_audit_row(to_jsonb(OLD))
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

DROP TRIGGER IF EXISTS audit_log_patient_share_correction_request ON "PatientShareCorrectionRequest";
CREATE TRIGGER audit_log_patient_share_correction_request
AFTER INSERT OR UPDATE OR DELETE ON "PatientShareCorrectionRequest"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_patient_share_correction_request_audit_log();

CREATE OR REPLACE FUNCTION ph_os_redact_pharmacy_partnership_clinical_audit_row(
  audit_table_name TEXT,
  row_data JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    CASE audit_table_name
      WHEN 'PharmacyVisitRequest' THEN
        row_data
          - 'request_reason'
          - 'physician_instruction'
          - 'carry_items'
          - 'patient_home_notes'
          - 'decline_reason'
          - 'estimated_snapshot'
          || jsonb_build_object(
            'request_reason_length', length(coalesce(row_data->>'request_reason', '')),
            'physician_instruction_length', length(coalesce(row_data->>'physician_instruction', '')),
            'has_carry_items', row_data ? 'carry_items',
            'patient_home_notes_length', length(coalesce(row_data->>'patient_home_notes', '')),
            'decline_reason_length', length(coalesce(row_data->>'decline_reason', '')),
            'has_estimated_snapshot', row_data ? 'estimated_snapshot'
          )
      WHEN 'PartnerVisitRecord' THEN
        row_data
          - 'pharmacist_name'
          - 'record_content'
          - 'attachments'
          - 'returned_reason'
          - 'base_confirmation_snapshot'
          || jsonb_build_object(
            'pharmacist_name_length', length(coalesce(row_data->>'pharmacist_name', '')),
            'has_record_content', row_data ? 'record_content',
            'has_attachments', row_data ? 'attachments',
            'returned_reason_length', length(coalesce(row_data->>'returned_reason', '')),
            'has_base_confirmation_snapshot', row_data ? 'base_confirmation_snapshot'
          )
      WHEN 'ClaimCooperationNote' THEN
        row_data
          - 'prescription_received_by'
          - 'claim_note_text'
          || jsonb_build_object(
            'prescription_received_by_length', length(coalesce(row_data->>'prescription_received_by', '')),
            'claim_note_text_length', length(coalesce(row_data->>'claim_note_text', ''))
          )
      ELSE row_data
    END
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_pharmacy_partnership_clinical_audit_log()
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
      'after', ph_os_redact_pharmacy_partnership_clinical_audit_row(TG_TABLE_NAME, to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_pharmacy_partnership_clinical_audit_row(TG_TABLE_NAME, to_jsonb(OLD)),
      'after', ph_os_redact_pharmacy_partnership_clinical_audit_row(TG_TABLE_NAME, to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_pharmacy_partnership_clinical_audit_row(TG_TABLE_NAME, to_jsonb(OLD))
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

DROP TRIGGER IF EXISTS audit_log_pharmacy_visit_request ON "PharmacyVisitRequest";
CREATE TRIGGER audit_log_pharmacy_visit_request
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyVisitRequest"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_partnership_clinical_audit_log();

DROP TRIGGER IF EXISTS audit_log_partner_visit_record ON "PartnerVisitRecord";
CREATE TRIGGER audit_log_partner_visit_record
AFTER INSERT OR UPDATE OR DELETE ON "PartnerVisitRecord"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_partnership_clinical_audit_log();

DROP TRIGGER IF EXISTS audit_log_claim_cooperation_note ON "ClaimCooperationNote";
CREATE TRIGGER audit_log_claim_cooperation_note
AFTER INSERT OR UPDATE OR DELETE ON "ClaimCooperationNote"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_partnership_clinical_audit_log();

CREATE OR REPLACE FUNCTION ph_os_redact_pharmacy_billing_audit_row(
  audit_table_name TEXT,
  row_data JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    CASE audit_table_name
      WHEN 'VisitBillingCandidate' THEN
        row_data
          - 'partner_visit_record_id'
          - 'amount_snapshot'
          || jsonb_build_object(
            'has_partner_visit_record_id', row_data ? 'partner_visit_record_id',
            'amount_snapshot_billing_model', row_data->'amount_snapshot'->>'billing_model',
            'amount_snapshot_amount', row_data->'amount_snapshot'->'amount',
            'amount_snapshot_tax_category', row_data->'amount_snapshot'->>'tax_category',
            'amount_snapshot_tax_rate_bp', row_data->'amount_snapshot'->'tax_rate_bp',
            'amount_snapshot_has_fee_rule', row_data->'amount_snapshot' ? 'fee_rule_id',
            'amount_snapshot_blocker_count',
              CASE
                WHEN jsonb_typeof(row_data->'amount_snapshot'->'blockers') = 'array'
                THEN jsonb_array_length(row_data->'amount_snapshot'->'blockers')
                ELSE 0
              END
          )
      WHEN 'PharmacyInvoice' THEN
        row_data
          - 'issuer_snapshot'
          - 'recipient_snapshot'
          - 'snapshot'
          || jsonb_build_object(
            'has_issuer_snapshot', row_data ? 'issuer_snapshot',
            'has_recipient_snapshot', row_data ? 'recipient_snapshot',
            'snapshot_document_kind', row_data->'snapshot'->>'document_kind',
            'snapshot_candidate_count', row_data->'snapshot'->'candidate_count',
            'snapshot_patient_display_mode', row_data->'snapshot'->>'patient_display_mode'
          )
      WHEN 'PharmacyInvoiceItem' THEN
        row_data
          - 'visit_billing_candidate_id'
          - 'description'
          - 'snapshot'
          || jsonb_build_object(
            'has_visit_billing_candidate_id', row_data ? 'visit_billing_candidate_id',
            'description_length', length(coalesce(row_data->>'description', '')),
            'snapshot_billing_model', row_data->'snapshot'->'fee'->>'billing_model',
            'snapshot_patient_display_mode', row_data->'snapshot'->>'patient_display_mode'
          )
      ELSE row_data
    END
  );
$$;

CREATE OR REPLACE FUNCTION ph_os_write_pharmacy_billing_audit_log()
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
      'after', ph_os_redact_pharmacy_billing_audit_row(TG_TABLE_NAME, to_jsonb(NEW))
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;

    v_target_id := NEW.id;
    v_org_id := NEW.org_id;
    v_changes := jsonb_build_object(
      'operation', 'UPDATE',
      'before', ph_os_redact_pharmacy_billing_audit_row(TG_TABLE_NAME, to_jsonb(OLD)),
      'after', ph_os_redact_pharmacy_billing_audit_row(TG_TABLE_NAME, to_jsonb(NEW))
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    v_org_id := OLD.org_id;
    v_changes := jsonb_build_object(
      'operation', 'DELETE',
      'before', ph_os_redact_pharmacy_billing_audit_row(TG_TABLE_NAME, to_jsonb(OLD))
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

DROP TRIGGER IF EXISTS audit_log_pharmacy_contract ON "PharmacyContract";
CREATE TRIGGER audit_log_pharmacy_contract
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyContract"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_pharmacy_contract_version ON "PharmacyContractVersion";
CREATE TRIGGER audit_log_pharmacy_contract_version
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyContractVersion"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_pharmacy_contract_fee_rule ON "PharmacyContractFeeRule";
CREATE TRIGGER audit_log_pharmacy_contract_fee_rule
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyContractFeeRule"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_visit_billing_candidate ON "VisitBillingCandidate";
CREATE TRIGGER audit_log_visit_billing_candidate
AFTER INSERT OR UPDATE OR DELETE ON "VisitBillingCandidate"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_billing_audit_log();

DROP TRIGGER IF EXISTS audit_log_pharmacy_invoice ON "PharmacyInvoice";
CREATE TRIGGER audit_log_pharmacy_invoice
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyInvoice"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_billing_audit_log();

DROP TRIGGER IF EXISTS audit_log_pharmacy_invoice_item ON "PharmacyInvoiceItem";
CREATE TRIGGER audit_log_pharmacy_invoice_item
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyInvoiceItem"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_billing_audit_log();

DROP TRIGGER IF EXISTS audit_log_contract_document ON "ContractDocument";
CREATE TRIGGER audit_log_contract_document
AFTER INSERT OR UPDATE OR DELETE ON "ContractDocument"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
