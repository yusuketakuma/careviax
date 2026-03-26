import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  generateVisitScheduleProposalSchema,
  proposalStatusValues,
} from '@/lib/validations/visit-schedule-proposal';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import { formatVisitWorkflowGateIssues, type VisitWorkflowGateIssue } from '@/server/services/management-plans';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const caseId = searchParams.get('case_id');
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
    ...(parsed.data.reschedule_source_schedule_id
      ? { schedule_id: parsed.data.reschedule_source_schedule_id }
      : {}),
  });
  if (!refResult.ok) return refResult.response;

  let drafts;
  try {
    drafts = await generateVisitScheduleProposalDrafts({
      orgId: req.orgId,
      caseId: parsed.data.case_id,
      visitType: parsed.data.visit_type,
      priority: parsed.data.priority,
      candidateCount: parsed.data.candidate_count,
      startDate: parsed.data.start_date ? new Date(parsed.data.start_date) : undefined,
      preferredTimeFrom: parsed.data.preferred_time_from,
      preferredTimeTo: parsed.data.preferred_time_to,
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

  return success({ data: proposals }, 201);
}, {
  permission: 'canVisit',
  message: '訪問候補の生成権限がありません',
});
