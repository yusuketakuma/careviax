import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  generateVisitScheduleProposalSchema,
  proposalStatusValues,
} from '@/lib/validations/visit-schedule-proposal';
import { CARE_RULES_2024, MEDICAL_RULES_2024, type BillingRuleSeed } from '@/server/services/billing-rules';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import { formatVisitWorkflowGateIssues, type VisitWorkflowGateIssue } from '@/server/services/management-plans';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function readMonthlyCap(rule: BillingRuleSeed) {
  return typeof rule.conditions.monthly_cap === 'number' ? rule.conditions.monthly_cap : null;
}

function resolveProposalPayerBasis(args: {
  medicalInsuranceNumber?: string | null;
  careInsuranceNumber?: string | null;
  visitType: string;
}) {
  if (args.visitType === 'emergency') {
    return args.medicalInsuranceNumber || args.careInsuranceNumber ? 'medical' : 'self_pay';
  }
  if (args.careInsuranceNumber) return 'care';
  if (args.medicalInsuranceNumber) return 'medical';
  return 'self_pay';
}

async function validateProposalBillingExclusions(args: {
  orgId: string;
  caseId: string;
  visitType: string;
  targetDate: Date;
}) {
  const careCase = await prisma.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
    },
    select: {
      patient_id: true,
      patient: {
        select: {
          medical_insurance_number: true,
          care_insurance_number: true,
        },
      },
    },
  });

  if (!careCase) {
    return ['ケースが見つかりません'];
  }

  const payerBasis = resolveProposalPayerBasis({
    medicalInsuranceNumber: careCase.patient.medical_insurance_number,
    careInsuranceNumber: careCase.patient.care_insurance_number,
    visitType: args.visitType,
  });
  if (payerBasis === 'self_pay') return [];

  const targetRules = (payerBasis === 'care' ? CARE_RULES_2024 : MEDICAL_RULES_2024).filter(
    (rule) => rule.rule_type === 'base' && rule.provider_scope === 'pharmacy',
  );
  const targetRuleCodes = new Set(targetRules.map((rule) => rule.code));
  const sameMonthExclusiveCodes = new Set(
    targetRules.flatMap((rule) => rule.exclusion_rules?.same_month_exclusive ?? []),
  );
  const targetMonth = startOfMonth(args.targetDate);

  const existingCandidates = await prisma.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      patient_id: careCase.patient_id,
      billing_month: targetMonth,
      status: {
        in: ['candidate', 'confirmed', 'exported'],
      },
    },
    select: {
      billing_code: true,
      billing_name: true,
    },
  });

  const blockingMessages: string[] = [];
  const sameMonthExclusiveMatches = existingCandidates.filter((candidate) =>
    sameMonthExclusiveCodes.has(candidate.billing_code),
  );
  if (sameMonthExclusiveMatches.length > 0) {
    blockingMessages.push(
      `同月併算定不可の請求候補が存在します: ${sameMonthExclusiveMatches
        .map((candidate) => candidate.billing_name)
        .join(' / ')}`,
    );
  }

  const monthlyCap = targetRules
    .map(readMonthlyCap)
    .filter((value): value is number => value != null)
    .reduce<number | null>((min, value) => (min == null ? value : Math.min(min, value)), null);
  const currentMonthVisitCount = existingCandidates.filter((candidate) =>
    targetRuleCodes.has(candidate.billing_code),
  ).length;
  if (monthlyCap != null && currentMonthVisitCount >= monthlyCap) {
    blockingMessages.push(
      `同月の在宅訪問算定回数が上限に達しています（${currentMonthVisitCount}/${monthlyCap}件）`,
    );
  }

  return blockingMessages;
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const caseId = searchParams.get('case_id');
  const patientId = searchParams.get('patient_id');
  const status = searchParams.get('status');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');

  const parsedStatus = status
    ? proposalStatusValues.includes(status as (typeof proposalStatusValues)[number])
      ? (status as (typeof proposalStatusValues)[number])
      : null
    : null;
  if (status && !parsedStatus) {
    return validationError('status が不正です');
  }

  const proposals = await prisma.visitScheduleProposal.findMany({
    where: {
      org_id: req.orgId,
      ...(caseId ? { case_id: caseId } : {}),
      ...(patientId
        ? {
            case_: {
              is: {
                patient_id: patientId,
              },
            },
          }
        : {}),
      ...(parsedStatus ? { proposal_status: parsedStatus } : {}),
      ...(dateFrom || dateTo
        ? {
            proposed_date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    },
    include: {
      case_: {
        include: {
          patient: {
            include: {
              residences: {
                where: { is_primary: true },
                take: 1,
              },
            },
          },
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
          lat: true,
          lng: true,
        },
      },
      finalized_schedule: {
        select: {
          id: true,
          scheduled_date: true,
          pharmacist_id: true,
        },
      },
      reschedule_source_schedule: {
        select: {
          id: true,
          scheduled_date: true,
          pharmacist_id: true,
          override_request: {
            select: {
              status: true,
              impact_summary: true,
            },
          },
        },
      },
      contact_logs: {
        orderBy: { called_at: 'desc' },
        take: 10,
      },
    },
    orderBy: [
      { proposed_date: 'asc' },
      { time_window_start: 'asc' },
    ],
  });

  const pharmacistIds = Array.from(
    new Set(proposals.map((proposal) => proposal.proposed_pharmacist_id))
  );
  const pharmacists =
    pharmacistIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: {
            org_id: req.orgId,
            id: { in: pharmacistIds },
          },
          select: {
            id: true,
            name: true,
            name_kana: true,
          },
        });
  const pharmacistById = new Map(
    pharmacists.map((pharmacist) => [pharmacist.id, pharmacist])
  );

  return success({
    data: proposals.map((proposal) => ({
      ...proposal,
      proposed_pharmacist: pharmacistById.get(proposal.proposed_pharmacist_id) ?? null,
    })),
  });
}, {
  permission: 'canVisit',
  message: '訪問候補の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = generateVisitScheduleProposalSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const refResult = await validateOrgReferences(req.orgId, {
    case_id: parsed.data.case_id,
    ...(parsed.data.preferred_pharmacist_id
      ? { pharmacist_id: parsed.data.preferred_pharmacist_id }
      : {}),
    ...(parsed.data.reschedule_source_schedule_id
      ? { schedule_id: parsed.data.reschedule_source_schedule_id }
      : {}),
  });
  if (!refResult.ok) return refResult.response;

  const billingConstraintMessages = await validateProposalBillingExclusions({
    orgId: req.orgId,
    caseId: parsed.data.case_id,
    visitType: parsed.data.visit_type,
    targetDate: parsed.data.start_date ? new Date(parsed.data.start_date) : new Date(),
  });
  if (billingConstraintMessages.length > 0) {
    return validationError(billingConstraintMessages.join(' / '));
  }

  let drafts;
  try {
    drafts = await generateVisitScheduleProposalDrafts({
      orgId: req.orgId,
      caseId: parsed.data.case_id,
      visitType: parsed.data.visit_type,
      priority: parsed.data.priority,
      candidateCount: parsed.data.candidate_count,
      startDate: parsed.data.start_date ? new Date(parsed.data.start_date) : undefined,
      lockedDate: parsed.data.locked_date ? new Date(parsed.data.locked_date) : undefined,
      preferredTimeFrom: parsed.data.preferred_time_from,
      preferredTimeTo: parsed.data.preferred_time_to,
      preferredPharmacistId: parsed.data.preferred_pharmacist_id,
      rescheduleSourceScheduleId: parsed.data.reschedule_source_schedule_id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('VISIT_WORKFLOW_GATE:')) {
      const issues = error.message
        .replace('VISIT_WORKFLOW_GATE:', '')
        .split(',')
        .filter(Boolean) as VisitWorkflowGateIssue[];
      return validationError(formatVisitWorkflowGateIssues(issues));
    }
    throw error;
  }

  if (drafts.length === 0) {
    return validationError('シフト・休日・期限条件に合う候補を生成できませんでした');
  }

  const proposals = await withOrgContext(req.orgId, async (tx) => {
    if (!parsed.data.reschedule_source_schedule_id) {
      await tx.visitScheduleProposal.updateMany({
        where: {
          org_id: req.orgId,
          case_id: parsed.data.case_id,
          proposal_status: {
            in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
          },
        },
        data: {
          proposal_status: 'superseded',
        },
      });
    }

    return Promise.all(
      drafts.map((draft) =>
        tx.visitScheduleProposal.create({
          data: draft,
        })
      )
    );
  });

  await notifyWorkflowMutation({
    orgId: req.orgId,
    payload: { source: 'visit_schedule_proposals_create', case_id: parsed.data.case_id },
  });

  return success({ data: proposals }, 201);
}, {
  permission: 'canVisit',
  message: '訪問候補の生成権限がありません',
});
