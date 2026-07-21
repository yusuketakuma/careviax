import type { InsuranceApplicationStatus, InsuranceType, PrismaClient } from '@prisma/client';
import type {
  BillingCadencePreview,
  BillingCadenceProposalRow,
  BillingCadenceScheduleRow,
  BillingRequirementAlert,
} from './billing-requirement-validator';
import type {
  BillingRuntimeHomeComprehensive,
  BillingRuntimeSiteConfigStatus,
  resolveBillingRuntimeContext,
} from './billing-runtime-context';
import type { findLatestBillingPrescriptionClassification } from './billing-prescription-classification';

export type VisitScheduleBillingPreview = {
  alerts: BillingRequirementAlert[];
  cadence: BillingCadencePreview;
  recommended_visit_type: string;
  recommended_priority: 'normal' | 'urgent' | 'emergency';
  suggested_schedule_slot_count: number;
  effective_revision_code: string;
  effective_revision_label: string;
  site_config_status: BillingRuntimeSiteConfigStatus;
  site_config_revision_code: string | null;
  warnings: string[];
  home_comprehensive_preview: BillingRuntimeHomeComprehensive | null;
};

export type VisitScheduleBillingPreviewDb = Pick<
  PrismaClient,
  | 'careCase'
  | 'patientInsurance'
  | 'prescriptionIntake'
  | 'visitSchedule'
  | 'visitScheduleProposal'
  | 'user'
  | 'consentRecord'
  | 'managementPlan'
  | 'pharmacySiteInsuranceConfig'
>;

export type CareInsuranceApplicationPreview = {
  application_status: InsuranceApplicationStatus;
  previous_care_level: string | null;
  provisional_care_level: string | null;
  confirmed_care_level: string | null;
  number?: string | null;
} | null;

export type PublicSubsidyApplicationPreview = {
  application_status: InsuranceApplicationStatus;
  public_program_code: string | null;
  insurer_number: string | null;
  number: string | null;
  application_submitted_at: Date | null;
  valid_from: Date | null;
} | null;

export type BillingPreviewCareCase = {
  id: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
  required_visit_support: unknown;
  patient: { id: string };
};

export type LatestPrescriptionIntakeClassification = Awaited<
  ReturnType<typeof findLatestBillingPrescriptionClassification>
>;

export type BillingRuntimeContextResult = Awaited<ReturnType<typeof resolveBillingRuntimeContext>>;
export type BillingPreviewInsuranceType = Extract<InsuranceType, 'medical' | 'care'>;

export type BillingPreviewInsuranceRecord = {
  patient_id: string;
  insurance_type: InsuranceType;
  application_status: InsuranceApplicationStatus;
  number: string | null;
  public_program_code: string | null;
  insurer_number: string | null;
  previous_care_level: string | null;
  provisional_care_level: string | null;
  confirmed_care_level: string | null;
  application_submitted_at: Date | null;
  valid_from: Date | null;
  valid_until: Date | null;
  created_at: Date;
};

export type BillingPreviewInsurancePrefetch = {
  resolveInsurance(args: {
    patientId: string;
    type: BillingPreviewInsuranceType;
    asOf: Date;
  }): CareInsuranceApplicationPreview;
  resolvePendingPublicSubsidy(args: {
    patientId: string;
    asOf: Date;
  }): PublicSubsidyApplicationPreview;
};

export type BillingPreviewRuntimeContextCache = Map<string, Promise<BillingRuntimeContextResult>>;
export type BillingPreviewPharmacistWeeklyCapById = Map<string, number | null>;
export type BillingPreviewCadenceScheduleRows = BillingCadenceScheduleRow[];
export type BillingPreviewCadenceProposalRows = BillingCadenceProposalRow[];
export type BillingPreviewConsentRecord = {
  id: string;
  patient_id: string;
  expiry_date: Date | null;
  obtained_date: Date | null;
};
export type BillingPreviewManagementPlanRecord = {
  id: string;
  case_id: string;
  status: string;
  next_review_date: Date | null;
  effective_from: Date | null;
  version: number | null;
  approved_at: Date | null;
};
