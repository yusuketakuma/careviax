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
import type {
  BillingRuntimeHomeComprehensive,
  BillingRuntimeSiteConfigStatus,
} from './billing-runtime-context';
import { resolveBillingRuntimeContext } from './billing-runtime-context';

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
    typeof prisma.pharmacySiteInsuranceConfig?.findFirst !== 'function'
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

  const [latestIntake, medicalInsurance, careInsurance] = await Promise.all([
    findLatestPrescriptionIntakeClassification(prisma, {
      orgId: args.orgId,
      caseId: args.caseId,
    }),
    resolvePatientInsurance(prisma, {
      orgId: args.orgId,
      patientId: careCase.patient_id,
      type: 'medical',
    }),
    resolvePatientInsurance(prisma, {
      orgId: args.orgId,
      patientId: careCase.patient_id,
      type: 'care',
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

  const intakeJson = (careCase.required_visit_support as Record<string, unknown> | null)
    ?.home_visit_intake as Record<string, unknown> | null;
  const specialProcedures = Array.isArray(intakeJson?.special_medical_procedures)
    ? (intakeJson.special_medical_procedures as string[])
    : [];
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
    proposedDate: new Date(args.proposedDate),
    prescriptionCategory:
      latestIntake?.prescription_category === 'emergency' ? 'emergency' : 'regular',
    payerBasis: payerBasis === 'self_pay' ? 'medical' : payerBasis,
    specialCapEligible,
  } as const;

  const runtimeContext = await resolveBillingRuntimeContext(prisma, {
    orgId: args.orgId,
    payerBasis: payerBasis === 'care' ? 'care' : 'medical',
    asOfDate: new Date(args.proposedDate),
    siteId: args.siteId ?? null,
    buildingPatientCount: 1,
  });

  const [alerts, cadence] = await Promise.all([
    args.pharmacistId || careCase.primary_pharmacist_id
      ? validateBillingRequirements(previewArgs)
      : Promise.resolve([]),
    getBillingCadencePreview(previewArgs),
  ]);

  const suggestedScheduleSlotCount = Math.min(Math.max(cadence.suggested_dates.length, 1), 5);

  return {
    alerts,
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
