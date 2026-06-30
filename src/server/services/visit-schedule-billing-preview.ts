import { prisma } from '@/lib/db/client';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import {
  getBillingCadencePreview,
  validateBillingRequirements,
  type BillingCadencePreview,
  type BillingCadenceProposalRow,
  type BillingCadenceScheduleRow,
  type BillingRequirementAlert,
  type BillingRequirementWorkflowSnapshot,
} from './billing-requirement-validator';
import { resolveBillingPayerBasis } from './billing-payer-basis';
import { resolvePatientInsurance } from './patient-insurance';
import {
  findLatestPrescriptionIntakeClassification,
  findLatestPrescriptionIntakeClassificationsByCaseIds,
} from './prescription-intake-classification';
import type { InsuranceApplicationStatus, InsuranceType, PrismaClient } from '@prisma/client';
import type {
  BillingRuntimeHomeComprehensive,
  BillingRuntimeSiteConfigStatus,
} from './billing-runtime-context';
import { resolveBillingRuntimeContext } from './billing-runtime-context';
import { getHomeVisitSpecialMedicalProcedures } from '@/lib/patient/home-visit-intake';
import { formatUtcDateKey } from '@/lib/date-key';
import { addUtcDays, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import { ACTIVE_BILLING_SCHEDULE_STATUSES, startOfBillingMonth } from './billing-cadence';

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

const DEFAULT_BILLING_PREVIEW_BATCH_CONCURRENCY = 8;
const MAX_BILLING_PREVIEW_BATCH_CONCURRENCY = 16;

function resolveBillingPreviewBatchConcurrency() {
  return normalizeConcurrencyLimit(process.env.BILLING_PREVIEW_BATCH_CONCURRENCY, {
    defaultValue: DEFAULT_BILLING_PREVIEW_BATCH_CONCURRENCY,
    max: MAX_BILLING_PREVIEW_BATCH_CONCURRENCY,
  });
}

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

type BillingPreviewCareCase = {
  id: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
  required_visit_support: unknown;
  patient: {
    id: string;
  };
};

type LatestPrescriptionIntakeClassification = Awaited<
  ReturnType<typeof findLatestPrescriptionIntakeClassification>
>;

type BillingRuntimeContextResult = Awaited<ReturnType<typeof resolveBillingRuntimeContext>>;

type BillingPreviewInsuranceType = Extract<InsuranceType, 'medical' | 'care'>;

type BillingPreviewInsuranceRecord = {
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

type BillingPreviewInsurancePrefetch = {
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

type BillingPreviewRuntimeContextCache = Map<string, Promise<BillingRuntimeContextResult>>;
type BillingPreviewPharmacistWeeklyCapById = Map<string, number | null>;
type BillingPreviewCadenceScheduleRows = BillingCadenceScheduleRow[];
type BillingPreviewCadenceProposalRows = BillingCadenceProposalRow[];
type BillingPreviewConsentRecord = {
  id: string;
  patient_id: string;
  expiry_date: Date | null;
  obtained_date: Date | null;
};
type BillingPreviewManagementPlanRecord = {
  id: string;
  case_id: string;
  status: string;
  next_review_date: Date | null;
  effective_from: Date | null;
  version: number | null;
  approved_at: Date | null;
};

const BILLING_PREVIEW_CADENCE_SEARCH_DAYS = 120;

const BILLING_PREVIEW_CARE_CASE_SELECT = {
  id: true,
  patient_id: true,
  primary_pharmacist_id: true,
  required_visit_support: true,
  patient: {
    select: {
      id: true,
    },
  },
} as const;

function effectiveInsuranceDate(asOf: Date): Date {
  return utcDateFromLocalKey(formatUtcDateKey(asOf));
}

function buildRuntimeContextCacheKey(args: {
  orgId: string;
  payerBasis: 'medical' | 'care';
  siteId: string | null;
  asOfDate: Date;
  buildingPatientCount: number;
}): string {
  return JSON.stringify([
    args.orgId,
    args.payerBasis,
    args.siteId,
    formatUtcDateKey(args.asOfDate),
    args.buildingPatientCount,
  ]);
}

function resolveBillingRuntimeContextWithCache(args: {
  db: VisitScheduleBillingPreviewDb;
  cache?: BillingPreviewRuntimeContextCache;
  orgId: string;
  payerBasis: 'medical' | 'care';
  asOfDate: Date;
  siteId: string | null;
  buildingPatientCount: number;
}): Promise<BillingRuntimeContextResult> {
  if (!args.cache) {
    return resolveBillingRuntimeContext(args.db, {
      orgId: args.orgId,
      payerBasis: args.payerBasis,
      asOfDate: args.asOfDate,
      siteId: args.siteId,
      buildingPatientCount: args.buildingPatientCount,
    });
  }

  const cacheKey = buildRuntimeContextCacheKey(args);
  const cached = args.cache.get(cacheKey);
  if (cached) return cached;

  const context = resolveBillingRuntimeContext(args.db, {
    orgId: args.orgId,
    payerBasis: args.payerBasis,
    asOfDate: args.asOfDate,
    siteId: args.siteId,
    buildingPatientCount: args.buildingPatientCount,
  });
  args.cache.set(cacheKey, context);
  return context;
}

function compareNullableDateDesc(left: Date | null, right: Date | null): number {
  return (right?.getTime() ?? 0) - (left?.getTime() ?? 0);
}

function compareInsuranceByEffectivePriority(
  left: BillingPreviewInsuranceRecord,
  right: BillingPreviewInsuranceRecord,
): number {
  return (
    compareNullableDateDesc(left.valid_from, right.valid_from) ||
    right.created_at.getTime() - left.created_at.getTime()
  );
}

function comparePendingPublicSubsidyPriority(
  left: BillingPreviewInsuranceRecord,
  right: BillingPreviewInsuranceRecord,
): number {
  return (
    compareNullableDateDesc(left.application_submitted_at, right.application_submitted_at) ||
    compareNullableDateDesc(left.valid_from, right.valid_from) ||
    right.created_at.getTime() - left.created_at.getTime()
  );
}

function compareConsentRecordPriority(
  left: BillingPreviewConsentRecord,
  right: BillingPreviewConsentRecord,
): number {
  return (right.obtained_date?.getTime() ?? 0) - (left.obtained_date?.getTime() ?? 0);
}

function compareManagementPlanPriority(
  left: BillingPreviewManagementPlanRecord,
  right: BillingPreviewManagementPlanRecord,
): number {
  return (
    compareNullableDateDesc(left.effective_from, right.effective_from) ||
    (right.version ?? 0) - (left.version ?? 0) ||
    compareNullableDateDesc(left.approved_at, right.approved_at)
  );
}

function insuranceCoversDate(record: BillingPreviewInsuranceRecord, asOf: Date): boolean {
  const effectiveDate = effectiveInsuranceDate(asOf);
  return (
    (record.valid_from == null || record.valid_from <= effectiveDate) &&
    (record.valid_until == null || record.valid_until >= effectiveDate)
  );
}

function buildBillingPreviewInsurancePrefetch(
  records: BillingPreviewInsuranceRecord[],
): BillingPreviewInsurancePrefetch {
  const recordsByPatientId = new Map<string, BillingPreviewInsuranceRecord[]>();
  for (const record of records) {
    const patientRecords = recordsByPatientId.get(record.patient_id);
    if (patientRecords) {
      patientRecords.push(record);
    } else {
      recordsByPatientId.set(record.patient_id, [record]);
    }
  }

  return {
    resolveInsurance(args) {
      const record =
        recordsByPatientId
          .get(args.patientId)
          ?.filter(
            (candidate) =>
              candidate.insurance_type === args.type && insuranceCoversDate(candidate, args.asOf),
          )
          .sort(compareInsuranceByEffectivePriority)[0] ?? null;

      if (!record) return null;

      return {
        application_status: record.application_status,
        previous_care_level: record.previous_care_level,
        provisional_care_level: record.provisional_care_level,
        confirmed_care_level: record.confirmed_care_level,
        number: record.number,
      };
    },
    resolvePendingPublicSubsidy(args) {
      const record =
        recordsByPatientId
          .get(args.patientId)
          ?.filter(
            (candidate) =>
              candidate.insurance_type === 'public_subsidy' &&
              (candidate.application_status === 'applying' ||
                candidate.application_status === 'change_pending') &&
              insuranceCoversDate(candidate, args.asOf),
          )
          .sort(comparePendingPublicSubsidyPriority)[0] ?? null;

      if (!record) return null;

      return {
        application_status: record.application_status,
        public_program_code: record.public_program_code,
        insurer_number: record.insurer_number,
        number: record.number,
        application_submitted_at: record.application_submitted_at,
        valid_from: record.valid_from,
      };
    },
  };
}

function buildBillingPreviewWorkflowSnapshot(args: {
  consents: BillingPreviewConsentRecord[];
  managementPlans: BillingPreviewManagementPlanRecord[];
  consentActiveAsOf: Date;
}): BillingRequirementWorkflowSnapshot {
  const consentsByPatientId = new Map<string, BillingPreviewConsentRecord[]>();
  for (const consent of args.consents) {
    const patientConsents = consentsByPatientId.get(consent.patient_id);
    if (patientConsents) {
      patientConsents.push(consent);
    } else {
      consentsByPatientId.set(consent.patient_id, [consent]);
    }
  }
  for (const consents of consentsByPatientId.values()) {
    consents.sort(compareConsentRecordPriority);
  }

  const plansByCaseId = new Map<string, BillingPreviewManagementPlanRecord[]>();
  for (const plan of args.managementPlans) {
    const casePlans = plansByCaseId.get(plan.case_id);
    if (casePlans) {
      casePlans.push(plan);
    } else {
      plansByCaseId.set(plan.case_id, [plan]);
    }
  }
  for (const plans of plansByCaseId.values()) {
    plans.sort(compareManagementPlanPriority);
  }

  return {
    resolveConsent(resolveArgs) {
      const consent =
        consentsByPatientId
          .get(resolveArgs.patientId)
          ?.find(
            (candidate) =>
              candidate.expiry_date == null || candidate.expiry_date >= args.consentActiveAsOf,
          ) ?? null;
      if (!consent) return null;

      return {
        id: consent.id,
        expiry_date: consent.expiry_date,
      };
    },
    resolveManagementPlan(resolveArgs) {
      const current =
        plansByCaseId
          .get(resolveArgs.caseId)
          ?.find(
            (candidate) =>
              candidate.effective_from == null || candidate.effective_from <= resolveArgs.asOf,
          ) ?? null;

      return {
        current: current
          ? {
              id: current.id,
              status: current.status,
            }
          : null,
        reviewOverdue:
          current?.next_review_date != null && current.next_review_date < resolveArgs.asOf,
      };
    },
  };
}

async function prefetchBillingPreviewPatientInsurance(args: {
  db: VisitScheduleBillingPreviewDb;
  orgId: string;
  careCases: BillingPreviewCareCase[];
  proposedDates: string[];
}): Promise<BillingPreviewInsurancePrefetch> {
  const patientIds = [...new Set(args.careCases.map((careCase) => careCase.patient_id))];
  const effectiveDates = args.proposedDates
    .map((date) => effectiveInsuranceDate(new Date(date)))
    .sort((left, right) => left.getTime() - right.getTime());

  if (patientIds.length === 0 || effectiveDates.length === 0) {
    return buildBillingPreviewInsurancePrefetch([]);
  }

  const minDate = effectiveDates[0];
  const maxDate = effectiveDates[effectiveDates.length - 1];
  const records = await args.db.patientInsurance.findMany({
    where: {
      org_id: args.orgId,
      patient_id: { in: patientIds },
      insurance_type: { in: ['medical', 'care', 'public_subsidy'] },
      is_active: true,
      OR: [{ valid_from: null }, { valid_from: { lte: maxDate } }],
      AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: minDate } }] }],
    },
    select: {
      patient_id: true,
      insurance_type: true,
      application_status: true,
      number: true,
      public_program_code: true,
      insurer_number: true,
      previous_care_level: true,
      provisional_care_level: true,
      confirmed_care_level: true,
      application_submitted_at: true,
      valid_from: true,
      valid_until: true,
      created_at: true,
    },
  });

  return buildBillingPreviewInsurancePrefetch(records);
}

async function prefetchBillingPreviewPharmacistWeeklyCaps(args: {
  db: VisitScheduleBillingPreviewDb;
  orgId: string;
  items: {
    caseId: string;
    pharmacistId?: string | null;
  }[];
  careCaseById: Map<string, BillingPreviewCareCase>;
}): Promise<BillingPreviewPharmacistWeeklyCapById> {
  const pharmacistIds = [
    ...new Set(
      args.items
        .map((item) => {
          const careCase = args.careCaseById.get(item.caseId) ?? null;
          return item.pharmacistId ?? careCase?.primary_pharmacist_id ?? null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (pharmacistIds.length === 0) return new Map();

  const users = await args.db.user.findMany({
    where: {
      id: { in: pharmacistIds },
      org_id: args.orgId,
    },
    select: {
      id: true,
      max_weekly_visits: true,
    },
  });
  const capById: BillingPreviewPharmacistWeeklyCapById = new Map(
    users.map((user) => [user.id, user.max_weekly_visits]),
  );
  for (const pharmacistId of pharmacistIds) {
    if (!capById.has(pharmacistId)) capById.set(pharmacistId, null);
  }

  return capById;
}

async function prefetchBillingPreviewWorkflowSnapshot(args: {
  db: VisitScheduleBillingPreviewDb;
  orgId: string;
  careCases: BillingPreviewCareCase[];
  proposedDates: string[];
}): Promise<BillingRequirementWorkflowSnapshot> {
  const patientIds = [...new Set(args.careCases.map((careCase) => careCase.patient_id))];
  const caseIds = [...new Set(args.careCases.map((careCase) => careCase.id))];
  if (patientIds.length === 0 || caseIds.length === 0 || args.proposedDates.length === 0) {
    return buildBillingPreviewWorkflowSnapshot({
      consents: [],
      managementPlans: [],
      consentActiveAsOf: new Date(),
    });
  }

  const proposedDates = args.proposedDates
    .map((date) => new Date(date))
    .sort((left, right) => left.getTime() - right.getTime());
  const maxDate = proposedDates[proposedDates.length - 1]!;
  const consentActiveAsOf = new Date();

  const [consents, managementPlans] = await Promise.all([
    args.db.consentRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: { in: patientIds },
        consent_type: 'visit_medication_management',
        is_active: true,
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: consentActiveAsOf } }],
      },
      orderBy: [{ obtained_date: 'desc' }],
      select: {
        id: true,
        patient_id: true,
        expiry_date: true,
        obtained_date: true,
      },
    }),
    args.db.managementPlan.findMany({
      where: {
        org_id: args.orgId,
        case_id: { in: caseIds },
        status: 'approved',
        approved_at: { not: null },
        OR: [{ effective_from: null }, { effective_from: { lte: maxDate } }],
      },
      orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
      select: {
        id: true,
        case_id: true,
        status: true,
        next_review_date: true,
        effective_from: true,
        version: true,
        approved_at: true,
      },
    }),
  ]);

  return buildBillingPreviewWorkflowSnapshot({ consents, managementPlans, consentActiveAsOf });
}

async function prefetchBillingPreviewCadenceSchedules(args: {
  db: VisitScheduleBillingPreviewDb;
  orgId: string;
  careCases: BillingPreviewCareCase[];
  proposedDates: string[];
}): Promise<BillingPreviewCadenceScheduleRows> {
  const patientIds = [...new Set(args.careCases.map((careCase) => careCase.patient_id))];
  if (patientIds.length === 0 || args.proposedDates.length === 0) return [];

  const proposedDates = args.proposedDates
    .map((date) => new Date(date))
    .sort((left, right) => left.getTime() - right.getTime());
  const minDate = startOfBillingMonth(proposedDates[0]!);
  const maxDate = addUtcDays(
    proposedDates[proposedDates.length - 1]!,
    BILLING_PREVIEW_CADENCE_SEARCH_DAYS,
  );

  const schedules = await args.db.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      cycle: {
        patient_id: { in: patientIds },
      },
      scheduled_date: {
        gte: minDate,
        lte: maxDate,
      },
      schedule_status: {
        in: ACTIVE_BILLING_SCHEDULE_STATUSES,
      },
    },
    select: {
      id: true,
      cycle: {
        select: {
          patient_id: true,
        },
      },
      scheduled_date: true,
      pharmacist_id: true,
      visit_type: true,
    },
    orderBy: [{ scheduled_date: 'asc' }],
  });

  return schedules.flatMap((schedule) =>
    schedule.cycle
      ? [
          {
            id: schedule.id,
            patient_id: schedule.cycle.patient_id,
            scheduled_date: schedule.scheduled_date,
            pharmacist_id: schedule.pharmacist_id,
            visit_type: schedule.visit_type,
          },
        ]
      : [],
  );
}

async function prefetchBillingPreviewCadenceProposals(args: {
  db: VisitScheduleBillingPreviewDb;
  orgId: string;
  careCases: BillingPreviewCareCase[];
  proposedDates: string[];
}): Promise<BillingPreviewCadenceProposalRows> {
  const patientIds = [...new Set(args.careCases.map((careCase) => careCase.patient_id))];
  if (patientIds.length === 0 || args.proposedDates.length === 0) return [];

  const proposedDates = args.proposedDates
    .map((date) => new Date(date))
    .sort((left, right) => left.getTime() - right.getTime());
  const minDate = startOfBillingMonth(proposedDates[0]!);
  const maxDate = addUtcDays(
    proposedDates[proposedDates.length - 1]!,
    BILLING_PREVIEW_CADENCE_SEARCH_DAYS,
  );

  const proposals = await args.db.visitScheduleProposal.findMany({
    where: {
      org_id: args.orgId,
      finalized_schedule_id: null,
      proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      case_: {
        patient_id: { in: patientIds },
      },
      proposed_date: {
        gte: minDate,
        lte: maxDate,
      },
    },
    select: {
      id: true,
      proposal_batch_id: true,
      proposed_date: true,
      proposed_pharmacist_id: true,
      visit_type: true,
      finalized_schedule_id: true,
      reschedule_source_schedule_id: true,
      case_: {
        select: {
          patient_id: true,
        },
      },
    },
    orderBy: [{ proposed_date: 'asc' }],
  });

  return proposals.map((proposal) => ({
    id: proposal.id,
    patient_id: proposal.case_.patient_id,
    proposed_date: proposal.proposed_date,
    proposed_pharmacist_id: proposal.proposed_pharmacist_id,
    visit_type: proposal.visit_type,
    proposal_batch_id: proposal.proposal_batch_id,
    finalized_schedule_id: proposal.finalized_schedule_id,
    reschedule_source_schedule_id: proposal.reschedule_source_schedule_id,
  }));
}

async function findPendingPublicSubsidyInsurance(args: {
  db: VisitScheduleBillingPreviewDb;
  orgId: string;
  patientId: string;
  asOf: Date;
}): Promise<PublicSubsidyApplicationPreview> {
  // valid_from / valid_until(@db.Date)は UTC 深夜で保存されるため UTC 深夜で比較する
  const asOf = effectiveInsuranceDate(args.asOf);

  const [record] = await args.db.patientInsurance.findMany({
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
  excludeScheduleId?: string | null;
  excludeProposalId?: string | null;
}): Promise<VisitScheduleBillingPreview | null>;
export async function buildVisitScheduleBillingPreview(
  args: {
    orgId: string;
    caseId: string;
    proposedDate: string;
    pharmacistId?: string | null;
    siteId?: string | null;
    visitType?: string | null;
    excludeScheduleId?: string | null;
    excludeProposalId?: string | null;
  },
  options: { db?: VisitScheduleBillingPreviewDb },
): Promise<VisitScheduleBillingPreview | null>;
export async function buildVisitScheduleBillingPreview(
  args: {
    orgId: string;
    caseId: string;
    proposedDate: string;
    pharmacistId?: string | null;
    siteId?: string | null;
    visitType?: string | null;
    excludeScheduleId?: string | null;
    excludeProposalId?: string | null;
  },
  options?: { db?: VisitScheduleBillingPreviewDb },
): Promise<VisitScheduleBillingPreview | null> {
  const db = options?.db ?? prisma;
  if (
    typeof db.careCase?.findFirst !== 'function' ||
    typeof db.prescriptionIntake?.findFirst !== 'function' ||
    typeof db.visitSchedule?.findMany !== 'function' ||
    typeof db.visitSchedule?.count !== 'function' ||
    typeof db.user?.findFirst !== 'function' ||
    typeof db.pharmacySiteInsuranceConfig?.findFirst !== 'function' ||
    typeof db.patientInsurance?.findFirst !== 'function' ||
    typeof db.patientInsurance?.findMany !== 'function'
  ) {
    return null;
  }

  const careCase = await db.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
    },
    select: BILLING_PREVIEW_CARE_CASE_SELECT,
  });
  if (!careCase) return null;

  return buildVisitScheduleBillingPreviewForCareCase({ ...args, db }, careCase);
}

async function buildVisitScheduleBillingPreviewForCareCase(
  args: {
    db: VisitScheduleBillingPreviewDb;
    orgId: string;
    caseId: string;
    proposedDate: string;
    pharmacistId?: string | null;
    siteId?: string | null;
    visitType?: string | null;
    excludeScheduleId?: string | null;
    excludeProposalId?: string | null;
    latestIntake?: LatestPrescriptionIntakeClassification;
    insurancePrefetch?: BillingPreviewInsurancePrefetch;
    runtimeContextCache?: BillingPreviewRuntimeContextCache;
    pharmacistWeeklyCapById?: BillingPreviewPharmacistWeeklyCapById;
    cadenceScheduleRows?: BillingPreviewCadenceScheduleRows;
    cadenceProposalRows?: BillingPreviewCadenceProposalRows;
    workflowSnapshot?: BillingRequirementWorkflowSnapshot;
  },
  careCase: BillingPreviewCareCase,
): Promise<VisitScheduleBillingPreview | null> {
  const proposedDate = new Date(args.proposedDate);

  const [latestIntake, medicalInsurance, careInsurance, pendingPublicSubsidyInsurance] =
    await Promise.all([
      args.latestIntake !== undefined
        ? Promise.resolve(args.latestIntake)
        : findLatestPrescriptionIntakeClassification(args.db, {
            orgId: args.orgId,
            caseId: args.caseId,
          }),
      args.insurancePrefetch
        ? Promise.resolve(
            args.insurancePrefetch.resolveInsurance({
              patientId: careCase.patient_id,
              type: 'medical',
              asOf: proposedDate,
            }),
          )
        : resolvePatientInsurance(args.db, {
            orgId: args.orgId,
            patientId: careCase.patient_id,
            type: 'medical',
            asOf: proposedDate,
          }),
      args.insurancePrefetch
        ? Promise.resolve(
            args.insurancePrefetch.resolveInsurance({
              patientId: careCase.patient_id,
              type: 'care',
              asOf: proposedDate,
            }),
          )
        : resolvePatientInsurance(args.db, {
            orgId: args.orgId,
            patientId: careCase.patient_id,
            type: 'care',
            asOf: proposedDate,
          }),
      args.insurancePrefetch
        ? Promise.resolve(
            args.insurancePrefetch.resolvePendingPublicSubsidy({
              patientId: careCase.patient_id,
              asOf: proposedDate,
            }),
          )
        : findPendingPublicSubsidyInsurance({
            db: args.db,
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

  const previewPharmacistId = args.pharmacistId ?? careCase.primary_pharmacist_id ?? '';
  const previewArgs = {
    db: args.db,
    orgId: args.orgId,
    caseId: args.caseId,
    patientId: careCase.patient_id,
    pharmacistId: previewPharmacistId,
    visitType,
    proposedDate,
    prescriptionCategory:
      latestIntake?.prescription_category === 'emergency' ? 'emergency' : 'regular',
    payerBasis: payerBasis === 'self_pay' ? 'medical' : payerBasis,
    specialCapEligible,
    ...(args.excludeScheduleId ? { excludeScheduleId: args.excludeScheduleId } : {}),
    ...(args.excludeProposalId ? { excludeProposalId: args.excludeProposalId } : {}),
    ...(args.cadenceScheduleRows ? { cadenceScheduleRows: args.cadenceScheduleRows } : {}),
    ...(args.cadenceProposalRows ? { cadenceProposalRows: args.cadenceProposalRows } : {}),
    ...(args.workflowSnapshot ? { workflowSnapshot: args.workflowSnapshot } : {}),
  } as const;

  const runtimeContext = await resolveBillingRuntimeContextWithCache({
    db: args.db,
    cache: args.runtimeContextCache,
    orgId: args.orgId,
    payerBasis: payerBasis === 'care' ? 'care' : 'medical',
    asOfDate: proposedDate,
    siteId: args.siteId ?? null,
    buildingPatientCount: 1,
  });

  const [alerts, cadence] = await Promise.all([
    args.pharmacistId || careCase.primary_pharmacist_id
      ? validateBillingRequirements({
          ...previewArgs,
          ...(args.pharmacistWeeklyCapById
            ? { pharmacistWeeklyCap: args.pharmacistWeeklyCapById.get(previewPharmacistId) ?? null }
            : {}),
        })
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
    excludeScheduleId?: string | null;
    excludeProposalId?: string | null;
  }[],
  orgId: string,
  options?: { db?: VisitScheduleBillingPreviewDb },
) {
  const db = options?.db ?? prisma;
  if (
    typeof db.careCase?.findMany !== 'function' ||
    typeof db.prescriptionIntake?.findFirst !== 'function' ||
    typeof db.prescriptionIntake?.findMany !== 'function' ||
    typeof db.visitSchedule?.findMany !== 'function' ||
    typeof db.visitSchedule?.count !== 'function' ||
    typeof db.user?.findFirst !== 'function' ||
    typeof db.user?.findMany !== 'function' ||
    typeof db.consentRecord?.findMany !== 'function' ||
    typeof db.managementPlan?.findMany !== 'function' ||
    typeof db.pharmacySiteInsuranceConfig?.findFirst !== 'function' ||
    typeof db.patientInsurance?.findFirst !== 'function' ||
    typeof db.patientInsurance?.findMany !== 'function'
  ) {
    return {};
  }

  const uniqueCaseIds = [...new Set(args.map((item) => item.caseId))];
  const careCases = await db.careCase.findMany({
    where: {
      id: { in: uniqueCaseIds },
      org_id: orgId,
    },
    select: BILLING_PREVIEW_CARE_CASE_SELECT,
  });
  const careCaseById = new Map(careCases.map((careCase) => [careCase.id, careCase]));
  const latestIntakeByCaseId = await findLatestPrescriptionIntakeClassificationsByCaseIds(db, {
    orgId,
    caseIds: careCases.map((careCase) => careCase.id),
  });
  const insurancePrefetch = await prefetchBillingPreviewPatientInsurance({
    db,
    orgId,
    careCases,
    proposedDates: args.map((item) => item.proposedDate),
  });
  const pharmacistWeeklyCapById = await prefetchBillingPreviewPharmacistWeeklyCaps({
    db,
    orgId,
    items: args,
    careCaseById,
  });
  const cadenceScheduleRows = await prefetchBillingPreviewCadenceSchedules({
    db,
    orgId,
    careCases,
    proposedDates: args.map((item) => item.proposedDate),
  });
  const cadenceProposalRows = await prefetchBillingPreviewCadenceProposals({
    db,
    orgId,
    careCases,
    proposedDates: args.map((item) => item.proposedDate),
  });
  const workflowSnapshot = await prefetchBillingPreviewWorkflowSnapshot({
    db,
    orgId,
    careCases,
    proposedDates: args.map((item) => item.proposedDate),
  });
  const runtimeContextCache: BillingPreviewRuntimeContextCache = new Map();
  const previewByInput = new Map<string, Promise<VisitScheduleBillingPreview | null>>();
  const entries = await mapWithConcurrency(
    args,
    resolveBillingPreviewBatchConcurrency(),
    async (item) => {
      const inputKey = JSON.stringify([
        item.caseId,
        item.proposedDate,
        item.pharmacistId ?? null,
        item.siteId ?? null,
        item.visitType ?? null,
        item.excludeScheduleId ?? null,
        item.excludeProposalId ?? null,
      ]);
      let preview = previewByInput.get(inputKey);
      if (!preview) {
        const careCase = careCaseById.get(item.caseId) ?? null;
        preview = careCase
          ? buildVisitScheduleBillingPreviewForCareCase(
              {
                db,
                orgId,
                caseId: item.caseId,
                proposedDate: item.proposedDate,
                pharmacistId: item.pharmacistId,
                siteId: item.siteId,
                visitType: item.visitType,
                excludeScheduleId: item.excludeScheduleId,
                excludeProposalId: item.excludeProposalId,
                latestIntake: latestIntakeByCaseId.get(item.caseId) ?? null,
                insurancePrefetch,
                runtimeContextCache,
                pharmacistWeeklyCapById,
                cadenceScheduleRows,
                cadenceProposalRows,
                workflowSnapshot,
              },
              careCase,
            )
          : Promise.resolve(null);
        previewByInput.set(inputKey, preview);
      }

      return [item.key, await preview] as const;
    },
  );

  return Object.fromEntries(entries.filter(([, value]) => value != null));
}
