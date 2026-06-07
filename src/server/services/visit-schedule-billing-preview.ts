import { prisma } from '@/lib/db/client';
import {
  getBillingCadencePreview,
  validateBillingRequirements,
  type BillingCadencePreview,
  type BillingRequirementAlert,
} from './billing-requirement-validator';
import { resolveBillingPayerBasis } from './billing-payer-basis';
import { resolvePatientInsurance } from './patient-insurance';
import { findLatestPrescriptionIntakeClassification } from './prescription-intake-classification';
import type { InsuranceApplicationStatus } from '@prisma/client';
import type {
  BillingRuntimeHomeComprehensive,
  BillingRuntimeSiteConfigStatus,
} from './billing-runtime-context';
import { resolveBillingRuntimeContext } from './billing-runtime-context';
import { getHomeVisitSpecialMedicalProcedures } from '@/lib/patient/home-visit-intake';

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

type CareInsuranceApplicationPreview = {
  application_status: InsuranceApplicationStatus;
  previous_care_level: string | null;
  provisional_care_level: string | null;
  confirmed_care_level: string | null;
  number?: string | null;
} | null;

type PublicSubsidyApplicationPreview = {
  application_status: InsuranceApplicationStatus;
  public_program_code: string | null;
  insurer_number: string | null;
  number: string | null;
  application_submitted_at: Date | null;
  valid_from: Date | null;
} | null;

async function findPendingPublicSubsidyInsurance(args: {
  orgId: string;
  patientId: string;
  asOf: Date;
}): Promise<PublicSubsidyApplicationPreview> {
  const asOf = new Date(args.asOf);
  asOf.setHours(0, 0, 0, 0);

  const [record] = await prisma.patientInsurance.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      insurance_type: 'public_subsidy',
      is_active: true,
      application_status: { in: ['applying', 'change_pending'] },
      OR: [{ valid_from: null }, { valid_from: { lte: asOf } }],
      AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: asOf } }] }],
    },
    orderBy: [{ application_submitted_at: 'desc' }, { valid_from: 'desc' }, { created_at: 'desc' }],
    take: 1,
    select: {
      application_status: true,
      public_program_code: true,
      insurer_number: true,
      number: true,
      application_submitted_at: true,
      valid_from: true,
    },
  });

  return record ?? null;
}

function buildInsuranceApplicationAlerts(args: {
  careInsurance: CareInsuranceApplicationPreview;
  publicSubsidyInsurance: PublicSubsidyApplicationPreview;
  asOf: string;
}): BillingRequirementAlert[] {
  const alerts: BillingRequirementAlert[] = [];

  if (
    args.careInsurance?.application_status === 'applying' ||
    args.careInsurance?.application_status === 'change_pending'
  ) {
    const isChangePending = args.careInsurance.application_status === 'change_pending';
    alerts.push({
      type: 'care_insurance_application_pending',
      severity: 'warning',
      message: isChangePending
        ? '介護保険が区分変更中です。認定結果の確定まで請求保留または確認が必要です'
        : '介護保険資格が申請中です。認定結果の確定まで請求保留または確認が必要です',
      details: {
        application_status: args.careInsurance.application_status,
        insurance_number_present: Boolean(args.careInsurance.number),
        previous_care_level: args.careInsurance.previous_care_level,
        provisional_care_level: args.careInsurance.provisional_care_level,
        confirmed_care_level: args.careInsurance.confirmed_care_level,
      },
      as_of: args.asOf,
    });
  }

  if (
    args.publicSubsidyInsurance?.application_status === 'applying' ||
    args.publicSubsidyInsurance?.application_status === 'change_pending'
  ) {
    const programLabel = args.publicSubsidyInsurance.public_program_code
      ? `公費${args.publicSubsidyInsurance.public_program_code}`
      : '公費';
    alerts.push({
      type: 'public_subsidy_application_pending',
      severity: 'warning',
      message: `${programLabel}が申請中です。公費負担者番号・受給者番号と適用開始日の確定まで請求保留または確認が必要です`,
      details: {
        application_status: args.publicSubsidyInsurance.application_status,
        public_program_code: args.publicSubsidyInsurance.public_program_code,
        insurer_number_present: Boolean(args.publicSubsidyInsurance.insurer_number),
        recipient_number_present: Boolean(args.publicSubsidyInsurance.number),
        application_submitted_at:
          args.publicSubsidyInsurance.application_submitted_at?.toISOString() ?? null,
        valid_from: args.publicSubsidyInsurance.valid_from?.toISOString() ?? null,
      },
      as_of: args.asOf,
    });
  }

  return alerts;
}

export async function buildVisitScheduleBillingPreview(args: {
  orgId: string;
  caseId: string;
  proposedDate: string;
  pharmacistId?: string | null;
  siteId?: string | null;
  visitType?: string | null;
}): Promise<VisitScheduleBillingPreview | null> {
  if (
    typeof prisma.careCase?.findFirst !== 'function' ||
    typeof prisma.prescriptionIntake?.findFirst !== 'function' ||
    typeof prisma.visitSchedule?.findMany !== 'function' ||
    typeof prisma.visitSchedule?.count !== 'function' ||
    typeof prisma.user?.findFirst !== 'function' ||
    typeof prisma.pharmacySiteInsuranceConfig?.findFirst !== 'function' ||
    typeof prisma.patientInsurance?.findFirst !== 'function' ||
    typeof prisma.patientInsurance?.findMany !== 'function'
  ) {
    return null;
  }

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
    },
    select: {
      id: true,
      patient_id: true,
      primary_pharmacist_id: true,
      required_visit_support: true,
      patient: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!careCase) return null;

  const proposedDate = new Date(args.proposedDate);

  const [latestIntake, medicalInsurance, careInsurance, pendingPublicSubsidyInsurance] =
    await Promise.all([
      findLatestPrescriptionIntakeClassification(prisma, {
        orgId: args.orgId,
        caseId: args.caseId,
      }),
      resolvePatientInsurance(prisma, {
        orgId: args.orgId,
        patientId: careCase.patient_id,
        type: 'medical',
        asOf: proposedDate,
      }),
      resolvePatientInsurance(prisma, {
        orgId: args.orgId,
        patientId: careCase.patient_id,
        type: 'care',
        asOf: proposedDate,
      }),
      findPendingPublicSubsidyInsurance({
        orgId: args.orgId,
        patientId: careCase.patient_id,
        asOf: proposedDate,
      }),
    ]);

  const visitType =
    args.visitType ??
    (latestIntake?.prescription_category === 'emergency' ? 'emergency' : 'regular');
  const payerBasis = resolveBillingPayerBasis({
    medicalInsuranceNumber: medicalInsurance?.number ?? null,
    careInsuranceNumber: careInsurance?.number ?? null,
    visitType,
  });

  const specialProcedures = getHomeVisitSpecialMedicalProcedures(careCase.required_visit_support);
  const specialCapEligible =
    specialProcedures.includes('narcotics') ||
    specialProcedures.includes('narcotics_injection') ||
    specialProcedures.includes('tpn') ||
    specialProcedures.includes('cv_port') ||
    specialProcedures.includes('central_venous') ||
    specialProcedures.includes('terminal_pain');

  const previewArgs = {
    orgId: args.orgId,
    caseId: args.caseId,
    patientId: careCase.patient_id,
    pharmacistId: args.pharmacistId ?? careCase.primary_pharmacist_id ?? '',
    visitType,
    proposedDate,
    prescriptionCategory:
      latestIntake?.prescription_category === 'emergency' ? 'emergency' : 'regular',
    payerBasis: payerBasis === 'self_pay' ? 'medical' : payerBasis,
    specialCapEligible,
  } as const;

  const runtimeContext = await resolveBillingRuntimeContext(prisma, {
    orgId: args.orgId,
    payerBasis: payerBasis === 'care' ? 'care' : 'medical',
    asOfDate: proposedDate,
    siteId: args.siteId ?? null,
    buildingPatientCount: 1,
  });

  const [alerts, cadence] = await Promise.all([
    args.pharmacistId || careCase.primary_pharmacist_id
      ? validateBillingRequirements(previewArgs)
      : Promise.resolve([]),
    getBillingCadencePreview(previewArgs),
  ]);

  const insuranceApplicationAlerts = buildInsuranceApplicationAlerts({
    careInsurance,
    publicSubsidyInsurance: pendingPublicSubsidyInsurance,
    asOf: new Date().toISOString(),
  });
  const suggestedScheduleSlotCount = Math.min(Math.max(cadence.suggested_dates.length, 1), 5);

  return {
    alerts: [...insuranceApplicationAlerts, ...alerts],
    cadence,
    recommended_visit_type: visitType,
    recommended_priority: visitType === 'emergency' ? 'emergency' : 'normal',
    suggested_schedule_slot_count: suggestedScheduleSlotCount,
    effective_revision_code: runtimeContext.effectiveRevisionCode,
    effective_revision_label: runtimeContext.effectiveRevisionLabel,
    site_config_status: runtimeContext.siteConfigStatus,
    site_config_revision_code: runtimeContext.siteConfigRevisionCode,
    warnings: runtimeContext.warnings,
    home_comprehensive_preview: runtimeContext.homeComprehensive,
  };
}

export async function buildVisitScheduleBillingPreviewBatch(
  args: {
    key: string;
    caseId: string;
    proposedDate: string;
    pharmacistId?: string | null;
    siteId?: string | null;
    visitType?: string | null;
  }[],
  orgId: string,
) {
  const entries = await Promise.all(
    args.map(
      async (item) =>
        [
          item.key,
          await buildVisitScheduleBillingPreview({
            orgId,
            caseId: item.caseId,
            proposedDate: item.proposedDate,
            pharmacistId: item.pharmacistId,
            siteId: item.siteId,
            visitType: item.visitType,
          }),
        ] as const,
    ),
  );

  return Object.fromEntries(entries.filter(([, value]) => value != null));
}
