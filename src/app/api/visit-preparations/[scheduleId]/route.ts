import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { upsertVisitPreparationSchema } from '@/lib/validations/visit-preparation';
import {
  describeOperationalTask,
  upsertOperationalTask,
  resolveOperationalTasks,
} from '@/server/services/operational-tasks';

function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: scheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      schedule_status: true,
      priority: true,
      pharmacist_id: true,
      assignment_mode: true,
      escalation_reason: true,
      confirmed_at: true,
      site: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      preparation: true,
      override_request: {
        select: {
          id: true,
          status: true,
          reason: true,
          impact_summary: true,
        },
      },
      applied_override: {
        select: {
          id: true,
          reason: true,
          source_schedule: {
            select: {
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
              pharmacist_id: true,
            },
          },
        },
      },
      case_: {
        select: {
          id: true,
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
          patient: {
            select: {
              id: true,
              name: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  address: true,
                  building_id: true,
                },
              },
            },
          },
          care_team_links: {
            orderBy: { role: 'asc' },
            select: {
              id: true,
              role: true,
              name: true,
              organization_name: true,
              phone: true,
            },
          },
        },
      },
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');

  const preparation = schedule.preparation;
  const primaryResidence = schedule.case_.patient.residences[0] ?? null;

  const [previousVisit, openTasks, recentContactLogs, sameDaySchedules] = await Promise.all([
    prisma.visitRecord.findFirst({
      where: {
        org_id: ctx.orgId,
        schedule: {
          case_id: schedule.case_id,
        },
        schedule_id: {
          not: schedule.id,
        },
      },
      orderBy: {
        visit_date: 'desc',
      },
      select: {
        id: true,
        visit_date: true,
        outcome_status: true,
        soap_plan: true,
        next_visit_suggestion_date: true,
      },
    }),
    prisma.task.findMany({
      where: {
        org_id: ctx.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'visit_schedule',
            related_entity_id: schedule.id,
          },
          {
            related_entity_type: 'case',
            related_entity_id: schedule.case_id,
          },
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 6,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        priority: true,
        assigned_to: true,
        due_date: true,
        sla_due_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    prisma.visitScheduleContactLog.findMany({
      where: {
        org_id: ctx.orgId,
        OR: [
          { schedule_id: schedule.id },
          { case_id: schedule.case_id },
        ],
      },
      orderBy: [{ called_at: 'desc' }],
      take: 4,
      select: {
        id: true,
        outcome: true,
        contact_name: true,
        contact_phone: true,
        note: true,
        callback_due_at: true,
        called_at: true,
        called_by: true,
      },
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        scheduled_date: schedule.scheduled_date,
        pharmacist_id: schedule.pharmacist_id,
        id: {
          not: schedule.id,
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
      orderBy: [{ time_window_start: 'asc' }],
      select: {
        id: true,
        route_order: true,
        case_: {
          select: {
            patient: {
              select: {
                name: true,
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    building_id: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const sameFacilitySchedules = sameDaySchedules.filter((item) => {
    const residence = item.case_.patient.residences[0] ?? null;
    if (!primaryResidence || !residence) return false;
    if (primaryResidence.building_id && residence.building_id) {
      return primaryResidence.building_id === residence.building_id;
    }
    return primaryResidence.address === residence.address;
  });

  const readinessBlockers = [
    !preparation?.medication_changes_reviewed ? '薬歴・前回変更の確認' : null,
    !preparation?.carry_items_confirmed ? '持参薬・物品確認' : null,
    !preparation?.previous_issues_reviewed ? '前回課題の確認' : null,
    !preparation?.route_confirmed ? 'ルート確認' : null,
    !preparation?.offline_synced ? 'オフライン同期確認' : null,
  ].filter((value): value is string => value != null);

  return success({
    data: {
      preparation,
      pack: {
        patient: {
          id: schedule.case_.patient.id,
          name: schedule.case_.patient.name,
          address: primaryResidence?.address ?? null,
        },
        visit: {
          id: schedule.id,
          scheduled_date: schedule.scheduled_date.toISOString(),
          time_window_start: schedule.time_window_start?.toISOString() ?? null,
          time_window_end: schedule.time_window_end?.toISOString() ?? null,
          schedule_status: schedule.schedule_status,
          priority: schedule.priority,
          confirmed_at: schedule.confirmed_at?.toISOString() ?? null,
        },
        site: schedule.site,
        handoff: {
          assignment_mode: schedule.assignment_mode,
          summary: [
            ...(schedule.assignment_mode === 'fallback'
              ? ['代替担当での訪問です']
              : []),
            ...(schedule.escalation_reason ? [schedule.escalation_reason] : []),
            ...(schedule.override_request?.status === 'pending'
              ? [`変更承認待ち: ${schedule.override_request.reason}`]
              : []),
            ...(schedule.applied_override
              ? [`例外変更理由: ${schedule.applied_override.reason}`]
              : []),
          ].join(' / '),
        },
        readiness_blockers: readinessBlockers,
        previous_visit: previousVisit
          ? {
              id: previousVisit.id,
              visit_date: previousVisit.visit_date.toISOString(),
              outcome_status: previousVisit.outcome_status,
              soap_plan: previousVisit.soap_plan,
              next_visit_suggestion_date:
                previousVisit.next_visit_suggestion_date?.toISOString() ?? null,
            }
          : null,
        open_tasks: openTasks.map((task) => {
          const detail = describeOperationalTask(task);
          return {
            id: task.id,
            task_type: task.task_type,
            title: task.title,
            description: task.description,
            priority: task.priority,
            due_at: task.sla_due_at?.toISOString() ?? task.due_date?.toISOString() ?? null,
            action_href: detail.actionHref,
            action_label: detail.actionLabel,
          };
        }),
        recent_contact_logs: recentContactLogs.map((log) => ({
          ...log,
          callback_due_at: log.callback_due_at?.toISOString() ?? null,
          called_at: log.called_at.toISOString(),
        })),
        facility_mode: {
          label: primaryResidence?.building_id ?? primaryResidence?.address ?? null,
          same_day_patient_count: sameFacilitySchedules.length + 1,
          same_day_patient_names: [
            schedule.case_.patient.name,
            ...sameFacilitySchedules.map((item) => item.case_.patient.name),
          ],
          route_orders: [
            ...sameDaySchedules.map((item) => item.route_order),
          ].filter((value): value is number => typeof value === 'number'),
        },
        workload: {
          same_day_visit_count: sameDaySchedules.length + 1,
        },
        care_team: schedule.case_.care_team_links,
      },
    },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = upsertVisitPreparationSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { scheduleId } = await params;
  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: scheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      schedule_status: true,
      scheduled_date: true,
      pharmacist_id: true,
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');

  const allChecklistComplete =
    parsed.data.medication_changes_reviewed &&
    parsed.data.carry_items_confirmed &&
    parsed.data.previous_issues_reviewed &&
    parsed.data.route_confirmed &&
    parsed.data.offline_synced;

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const preparation = await tx.visitPreparation.upsert({
      where: {
        schedule_id: schedule.id,
      },
      create: {
        org_id: ctx.orgId,
        schedule_id: schedule.id,
        checklist: parsed.data.checklist as Prisma.InputJsonValue,
        medication_changes_reviewed: parsed.data.medication_changes_reviewed,
        carry_items_confirmed: parsed.data.carry_items_confirmed,
        previous_issues_reviewed: parsed.data.previous_issues_reviewed,
        route_confirmed: parsed.data.route_confirmed,
        offline_synced: parsed.data.offline_synced,
        prepared_by: ctx.userId,
        prepared_at: allChecklistComplete ? new Date() : null,
      },
      update: {
        checklist: parsed.data.checklist as Prisma.InputJsonValue,
        medication_changes_reviewed: parsed.data.medication_changes_reviewed,
        carry_items_confirmed: parsed.data.carry_items_confirmed,
        previous_issues_reviewed: parsed.data.previous_issues_reviewed,
        route_confirmed: parsed.data.route_confirmed,
        offline_synced: parsed.data.offline_synced,
        prepared_by: ctx.userId,
        prepared_at: allChecklistComplete ? new Date() : null,
      },
    });

    if (allChecklistComplete) {
      await resolveOperationalTasks(tx, {
        orgId: ctx.orgId,
        dedupeKey: buildPreparationTaskKey(schedule.id),
        status: 'completed',
      });
    } else {
      await upsertOperationalTask(tx, {
        orgId: ctx.orgId,
        taskType: 'visit_preparation',
        title: '訪問準備が未完了です',
        description: '訪問前チェックリストを完了してください。',
        priority: 'high',
        assignedTo: schedule.pharmacist_id,
        dueDate: schedule.scheduled_date,
        slaDueAt: schedule.scheduled_date,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: schedule.id,
        dedupeKey: buildPreparationTaskKey(schedule.id),
      });
    }

    return preparation;
  });

  return success({ data: result });
}
