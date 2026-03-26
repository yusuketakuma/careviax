import { addDays, format } from 'date-fns';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import { buildVisitScheduleSnapshot } from '@/server/services/visit-schedule-audit';
import { formatVisitWorkflowGateIssues, type VisitWorkflowGateIssue } from '@/server/services/management-plans';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { dispatchNotificationEvent } from '@/server/services/notifications';

const rescheduleSchema = z.object({
  reason: z.string().min(1, 'リスケ理由は必須です'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
});

function toTimeString(value: Date | null) {
  return value ? format(value, 'HH:mm') : undefined;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定のリスケ権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = rescheduleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      cycle_id: true,
      site_id: true,
      visit_type: true,
      priority: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      pharmacist_id: true,
      assignment_mode: true,
      route_order: true,
      schedule_status: true,
      confirmed_at: true,
      confirmed_by: true,
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');

  if (['completed', 'cancelled', 'rescheduled'].includes(schedule.schedule_status)) {
    return validationError('この訪問予定はリスケできません');
  }

  let drafts;
  try {
    drafts = await generateVisitScheduleProposalDrafts({
      orgId: ctx.orgId,
      caseId: schedule.case_id,
      visitType: schedule.visit_type,
      priority: parsed.data.priority ?? schedule.priority,
      candidateCount: 3,
      startDate: parsed.data.start_date
        ? new Date(parsed.data.start_date)
        : addDays(schedule.scheduled_date, 1),
      preferredTimeFrom: toTimeString(schedule.time_window_start),
      preferredTimeTo: toTimeString(schedule.time_window_end),
      rescheduleSourceScheduleId: id,
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
    return validationError('リスケ候補を生成できませんでした');
  }

  const proposals = await withOrgContext(ctx.orgId, async (tx) => {
    const requestedAt = new Date();
    const impactedScheduleCount = await tx.visitSchedule.count({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: schedule.pharmacist_id,
        scheduled_date: schedule.scheduled_date,
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
        id: { not: schedule.id },
      },
    });

    const createdProposals = await Promise.all(
      drafts.map((draft) =>
        tx.visitScheduleProposal.create({
          data: {
            ...draft,
            proposal_reason: `${draft.proposal_reason} / リスケ理由: ${parsed.data.reason}`,
          },
        })
      )
    );

    await tx.visitScheduleOverride.create({
      data: {
        org_id: ctx.orgId,
        source_schedule_id: schedule.id,
        status: 'pending',
        reason: parsed.data.reason,
        requested_by: ctx.userId,
        requested_at: requestedAt,
        before_snapshot: buildVisitScheduleSnapshot({
          ...schedule,
          confirmed_by: schedule.confirmed_by ?? null,
        }),
        impact_summary: {
          impacted_schedule_count: impactedScheduleCount,
          proposed_replacements: createdProposals.length,
          pharmacist_id: schedule.pharmacist_id,
        },
        after_snapshot: createdProposals.map((proposal) => ({
          proposal_id: proposal.id,
          proposed_date: proposal.proposed_date.toISOString(),
          time_window_start: proposal.time_window_start?.toISOString() ?? null,
          time_window_end: proposal.time_window_end?.toISOString() ?? null,
          proposed_pharmacist_id: proposal.proposed_pharmacist_id,
        })),
      },
    });

    await upsertOperationalTask(tx, {
      orgId: ctx.orgId,
      taskType: 'visit_schedule_override_approval',
      title: '確定済み訪問の変更承認が必要です',
      description: parsed.data.reason,
      priority: parsed.data.priority === 'emergency' ? 'urgent' : 'high',
      dueDate: schedule.scheduled_date,
      slaDueAt: schedule.scheduled_date,
      relatedEntityType: 'visit_schedule',
      relatedEntityId: schedule.id,
      dedupeKey: `visit-reschedule-approval:${schedule.id}`,
      assignedTo: null,
      metadata: {
        impacted_schedule_count: impactedScheduleCount,
        proposal_ids: createdProposals.map((proposal) => proposal.id),
        source_schedule_id: schedule.id,
      },
    });

    const approvers = await tx.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        role: { in: ['owner', 'admin'] },
      },
      select: {
        user_id: true,
      },
    });
    const approverIds = Array.from(new Set(approvers.map((approver) => approver.user_id)));
    if (approverIds.length > 0) {
      await tx.task.updateMany({
        where: {
          org_id: ctx.orgId,
          dedupe_key: `visit-reschedule-approval:${schedule.id}`,
        },
        data: {
          assigned_to: approverIds[0],
        },
      });
    }

    await dispatchNotificationEvent(tx, {
      orgId: ctx.orgId,
      eventType: 'visit_schedule_reschedule_requested',
      type: parsed.data.priority === 'emergency' ? 'urgent' : 'business',
      title: '確定済み訪問の変更承認待ち',
      message: `影響件数 ${impactedScheduleCount} 件。承認後に新候補を確定できます。`,
      link: '/schedules',
      explicitUserIds: approverIds,
      dedupeKey: `visit-reschedule-request:${schedule.id}`,
      metadata: {
        source_schedule_id: schedule.id,
        impacted_schedule_count: impactedScheduleCount,
        proposal_count: createdProposals.length,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'visit_schedule_reschedule_requested',
        target_type: 'VisitSchedule',
        target_id: schedule.id,
        changes: {
          reason: parsed.data.reason,
          priority: parsed.data.priority ?? schedule.priority,
          proposals: createdProposals.map((proposal) => proposal.id),
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return createdProposals;
  });

  return success({ data: proposals }, 201);
}
