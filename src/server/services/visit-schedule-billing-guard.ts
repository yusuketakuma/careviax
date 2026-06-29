import type { Prisma, PrismaClient } from '@prisma/client';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { getHomeVisitSpecialMedicalProcedures } from '@/lib/patient/home-visit-intake';
import { resolveBillingPayerBasis, type BillingPayerBasis } from './billing-payer-basis';
import {
  ACTIVE_BILLING_SCHEDULE_STATUSES,
  endOfBillingMonth,
  endOfBillingWeek,
  startOfBillingMonth,
  startOfBillingWeek,
} from './billing-cadence';
import {
  validateBillingRequirements,
  type BillingAlertType,
  type BillingCadenceProposalRow,
  type BillingCadenceScheduleRow,
  type BillingRequirementAlert,
  type BillingRequirementDb,
  type BillingRequirementWorkflowSnapshot,
} from './billing-requirement-validator';

type VisitScheduleBillingGuardDb = BillingRequirementDb & {
  patientInsurance: {
    findFirst(args: unknown): Promise<{ number: string | null } | null>;
  };
};

type BlockingPayerBasis = Exclude<BillingPayerBasis, 'self_pay'>;
type BillingGuardRows = {
  cadenceScheduleRows: BillingCadenceScheduleRow[];
  cadenceProposalRows: BillingCadenceProposalRow[];
};

const SAVE_BLOCKING_BILLING_ALERT_TYPES = new Set<BillingAlertType>([
  'monthly_cap_exceeded',
  'special_patient_weekly_cap',
  'emergency_regular_concurrent',
]);

const PREVALIDATED_WORKFLOW_SNAPSHOT: BillingRequirementWorkflowSnapshot = {
  resolveConsent() {
    return { id: 'prevalidated' };
  },
  resolveManagementPlan() {
    return {
      current: { id: 'prevalidated', status: 'approved' },
      reviewOverdue: false,
    };
  },
};

export function isSpecialBillingCapEligible(requiredVisitSupport: unknown) {
  const specialProcedures = getHomeVisitSpecialMedicalProcedures(requiredVisitSupport);
  return (
    specialProcedures.includes('narcotics') ||
    specialProcedures.includes('narcotics_injection') ||
    specialProcedures.includes('tpn') ||
    specialProcedures.includes('cv_port') ||
    specialProcedures.includes('central_venous') ||
    specialProcedures.includes('terminal_pain')
  );
}

async function resolveInsuranceNumber(args: {
  db: VisitScheduleBillingGuardDb;
  orgId: string;
  patientId: string;
  type: 'medical' | 'care';
  asOf: Date;
}) {
  const date = utcDateFromLocalKey(localDateKey(args.asOf));
  const record = await args.db.patientInsurance.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      insurance_type: args.type,
      is_active: true,
      OR: [{ valid_from: null }, { valid_from: { lte: date } }],
      AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: date } }] }],
    },
    orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
    select: { number: true },
  });
  return record?.number ?? null;
}

async function resolvePayerBasis(args: {
  db: VisitScheduleBillingGuardDb;
  orgId: string;
  patientId: string;
  visitType: string;
  proposedDate: Date;
  payerBasis?: BillingPayerBasis;
}) {
  if (args.payerBasis) return args.payerBasis;

  const [medicalInsuranceNumber, careInsuranceNumber] = await Promise.all([
    resolveInsuranceNumber({ ...args, type: 'medical', asOf: args.proposedDate }),
    resolveInsuranceNumber({ ...args, type: 'care', asOf: args.proposedDate }),
  ]);

  return resolveBillingPayerBasis({
    medicalInsuranceNumber,
    careInsuranceNumber,
    visitType: args.visitType,
  });
}

export function getBlockingBillingAlertMessages(alerts: BillingRequirementAlert[]) {
  return alerts
    .filter(
      (alert) => alert.severity === 'error' || SAVE_BLOCKING_BILLING_ALERT_TYPES.has(alert.type),
    )
    .map((alert) => alert.message);
}

function cadenceDateRange(dates: Date[]) {
  const minDate = new Date(Math.min(...dates.map((date) => date.getTime())));
  const maxDate = new Date(Math.max(...dates.map((date) => date.getTime())));
  const from = new Date(
    Math.min(startOfBillingMonth(minDate).getTime(), startOfBillingWeek(minDate).getTime()),
  );
  const to = new Date(
    Math.max(endOfBillingMonth(maxDate).getTime(), endOfBillingWeek(maxDate).getTime()),
  );
  return { from, to };
}

export async function loadVisitScheduleBillingGuardRows(args: {
  db: VisitScheduleBillingGuardDb | Prisma.TransactionClient | PrismaClient;
  orgId: string;
  patientId: string;
  pharmacistId: string;
  dates: Date[];
}): Promise<BillingGuardRows> {
  if (args.dates.length === 0) {
    return { cadenceScheduleRows: [], cadenceProposalRows: [] };
  }

  const db = args.db as VisitScheduleBillingGuardDb;
  const { from, to } = cadenceDateRange(args.dates);
  const [schedules, proposals] = (await Promise.all([
    db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        scheduled_date: { gte: from, lte: to },
        schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
        OR: [
          {
            case_: {
              patient_id: args.patientId,
            },
          },
          {
            pharmacist_id: args.pharmacistId,
          },
        ],
      },
      select: {
        id: true,
        scheduled_date: true,
        pharmacist_id: true,
        visit_type: true,
        case_: {
          select: {
            patient_id: true,
          },
        },
      },
    }),
    db.visitScheduleProposal.findMany({
      where: {
        org_id: args.orgId,
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        proposed_date: { gte: from, lte: to },
        OR: [
          {
            case_: {
              patient_id: args.patientId,
            },
          },
          {
            proposed_pharmacist_id: args.pharmacistId,
          },
        ],
      },
      select: {
        id: true,
        case_id: true,
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
    }),
  ])) as [
    Array<{
      id: string;
      scheduled_date: Date;
      pharmacist_id: string | null;
      visit_type: string | null;
      case_: {
        patient_id: string;
      };
    }>,
    Array<{
      id: string;
      case_id: string;
      proposal_batch_id: string | null;
      proposed_date: Date;
      proposed_pharmacist_id: string | null;
      visit_type: string | null;
      finalized_schedule_id: string | null;
      reschedule_source_schedule_id: string | null;
      case_: {
        patient_id: string;
      };
    }>,
  ];

  return {
    cadenceScheduleRows: schedules.map((schedule) => ({
      id: schedule.id,
      patient_id: schedule.case_.patient_id,
      scheduled_date: schedule.scheduled_date,
      pharmacist_id: schedule.pharmacist_id,
      visit_type: schedule.visit_type,
    })),
    cadenceProposalRows: proposals.map((proposal) => ({
      id: proposal.id,
      case_id: proposal.case_id,
      patient_id: proposal.case_.patient_id,
      proposed_date: proposal.proposed_date,
      proposed_pharmacist_id: proposal.proposed_pharmacist_id,
      visit_type: proposal.visit_type,
      proposal_batch_id: proposal.proposal_batch_id,
      finalized_schedule_id: proposal.finalized_schedule_id,
      reschedule_source_schedule_id: proposal.reschedule_source_schedule_id,
    })),
  };
}

export async function validateVisitScheduleBlockingBillingRequirements(args: {
  db: VisitScheduleBillingGuardDb | Prisma.TransactionClient | PrismaClient;
  orgId: string;
  caseId: string;
  patientId: string;
  pharmacistId: string;
  visitType: string;
  proposedDate: Date;
  requiredVisitSupport: unknown;
  payerBasis?: BillingPayerBasis;
  excludeScheduleId?: string | null;
  excludeProposalId?: string | null;
  excludeSupersededProposalScope?: {
    caseId: string;
    rescheduleSourceScheduleId?: string | null;
  };
  cadenceScheduleRows?: BillingCadenceScheduleRow[];
  cadenceProposalRows?: BillingCadenceProposalRow[];
  pharmacistWeeklyCap?: number | null;
  workflowPrevalidated?: boolean;
}) {
  const db = args.db as VisitScheduleBillingGuardDb;
  const payerBasis = await resolvePayerBasis({
    db,
    orgId: args.orgId,
    patientId: args.patientId,
    visitType: args.visitType,
    proposedDate: args.proposedDate,
    payerBasis: args.payerBasis,
  });
  if (payerBasis === 'self_pay') {
    return { payerBasis, alerts: [], blockingMessages: [] };
  }

  const alerts = await validateBillingRequirements({
    db,
    orgId: args.orgId,
    caseId: args.caseId,
    patientId: args.patientId,
    pharmacistId: args.pharmacistId,
    visitType: args.visitType,
    proposedDate: args.proposedDate,
    prescriptionCategory: args.visitType === 'emergency' ? 'emergency' : 'regular',
    payerBasis: payerBasis as BlockingPayerBasis,
    specialCapEligible: isSpecialBillingCapEligible(args.requiredVisitSupport),
    ...(args.excludeScheduleId ? { excludeScheduleId: args.excludeScheduleId } : {}),
    ...(args.excludeProposalId ? { excludeProposalId: args.excludeProposalId } : {}),
    ...(args.excludeSupersededProposalScope
      ? { excludeSupersededProposalScope: args.excludeSupersededProposalScope }
      : {}),
    ...(args.cadenceScheduleRows ? { cadenceScheduleRows: args.cadenceScheduleRows } : {}),
    ...(args.cadenceProposalRows ? { cadenceProposalRows: args.cadenceProposalRows } : {}),
    ...(args.pharmacistWeeklyCap !== undefined
      ? { pharmacistWeeklyCap: args.pharmacistWeeklyCap }
      : {}),
    ...(args.workflowPrevalidated ? { workflowSnapshot: PREVALIDATED_WORKFLOW_SNAPSHOT } : {}),
  });

  return {
    payerBasis,
    alerts,
    blockingMessages: getBlockingBillingAlertMessages(alerts),
  };
}
