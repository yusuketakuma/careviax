import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { dateKeySchema } from '@/lib/validations/date-key';

const STAFF_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
  'driver',
] as const;
const RECENT_TASK_LIMIT_PER_STAFF = 4;

const querySchema = z.object({
  date: dateKeySchema('date は YYYY-MM-DD で指定してください').optional(),
});

type OpenTask = {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  status: string;
  due_date: string | null;
  sla_due_at: string | null;
};

type RecentOpenTaskRow = Omit<OpenTask, 'due_date' | 'sla_due_at'> & {
  assigned_to: string | null;
  due_date: Date | null;
  sla_due_at: Date | null;
};

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'スタッフ業務量の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const dateKey = parsed.data.date ?? localDateKey();
  const dayStart = utcDateFromLocalKey(dateKey);
  const dayEnd = addUtcDays(dayStart, 1);

  const memberships = await prisma.membership.findMany({
    where: {
      org_id: ctx.orgId,
      is_active: true,
      role: { in: [...STAFF_ROLES] },
      user: { is_active: true },
    },
    orderBy: [{ user: { name_kana: 'asc' } }, { user: { name: 'asc' } }],
    select: {
      role: true,
      user: { select: { id: true, name: true } },
    },
  });

  const staffIds = Array.from(new Set(memberships.map((membership) => membership.user.id)));
  if (staffIds.length === 0) {
    return success({ data: [], date: dateKey });
  }

  const [openTaskGroups, openTasks, visits, dispenseTaskGroups] = await Promise.all([
    prisma.task.groupBy({
      by: ['assigned_to'],
      where: {
        org_id: ctx.orgId,
        assigned_to: { in: staffIds },
        status: { in: ['pending', 'in_progress'] },
      },
      _count: { id: true },
    }),
    prisma.$queryRaw<RecentOpenTaskRow[]>`
      SELECT id, assigned_to, title, task_type, priority, status, due_date, sla_due_at
      FROM (
        SELECT
          id,
          assigned_to,
          title,
          task_type,
          priority,
          status,
          due_date,
          sla_due_at,
          ROW_NUMBER() OVER (
            PARTITION BY assigned_to
            ORDER BY
              sla_due_at ASC NULLS LAST,
              due_date ASC NULLS LAST,
              priority ASC,
              created_at DESC
          ) AS rn
        FROM "Task"
        WHERE org_id = ${ctx.orgId}
          AND assigned_to = ANY(${staffIds}::text[])
          AND status IN ('pending', 'in_progress')
      ) ranked
      WHERE rn <= ${RECENT_TASK_LIMIT_PER_STAFF}
      ORDER BY assigned_to ASC, rn ASC
    `,
    prisma.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: { in: staffIds },
        scheduled_date: { gte: dayStart, lt: dayEnd },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: {
        id: true,
        pharmacist_id: true,
        visit_type: true,
        schedule_status: true,
        time_window_start: true,
        time_window_end: true,
        case_: { select: { patient: { select: { name: true } } } },
      },
      orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
    }),
    prisma.dispenseTask.groupBy({
      by: ['assigned_to'],
      where: {
        org_id: ctx.orgId,
        assigned_to: { in: staffIds },
        status: { in: ['pending', 'in_progress'] },
      },
      _count: { id: true },
    }),
  ]);

  const openTaskCountByUser = new Map(
    openTaskGroups
      .filter((group) => group.assigned_to)
      .map((group) => [group.assigned_to as string, group._count.id]),
  );
  const dispenseTaskCountByUser = new Map(
    dispenseTaskGroups
      .filter((group) => group.assigned_to)
      .map((group) => [group.assigned_to as string, group._count.id]),
  );
  const visitsByUser = new Map<string, typeof visits>();
  for (const visit of visits) {
    const items = visitsByUser.get(visit.pharmacist_id) ?? [];
    items.push(visit);
    visitsByUser.set(visit.pharmacist_id, items);
  }
  const tasksByUser = new Map<string, OpenTask[]>();
  for (const task of openTasks) {
    if (!task.assigned_to) continue;
    const items = tasksByUser.get(task.assigned_to) ?? [];
    if (items.length >= RECENT_TASK_LIMIT_PER_STAFF) continue;
    items.push({
      id: task.id,
      title: task.title,
      task_type: task.task_type,
      priority: task.priority,
      status: task.status,
      due_date: task.due_date?.toISOString() ?? null,
      sla_due_at: task.sla_due_at?.toISOString() ?? null,
    });
    tasksByUser.set(task.assigned_to, items);
  }

  const seen = new Set<string>();
  const data = memberships
    .filter((membership) => {
      if (seen.has(membership.user.id)) return false;
      seen.add(membership.user.id);
      return true;
    })
    .map((membership) => {
      const staffVisits = visitsByUser.get(membership.user.id) ?? [];
      const openTaskCount = openTaskCountByUser.get(membership.user.id) ?? 0;
      const dispenseTaskCount = dispenseTaskCountByUser.get(membership.user.id) ?? 0;
      const todayVisitCount = staffVisits.length;
      return {
        id: membership.user.id,
        name: membership.user.name,
        role: membership.role,
        role_label: memberRoleLabel(membership.role),
        open_task_count: openTaskCount,
        today_visit_count: todayVisitCount,
        dispense_task_count: dispenseTaskCount,
        workload_score: todayVisitCount * 3 + dispenseTaskCount * 2 + openTaskCount,
        visits: staffVisits.slice(0, 3).map((visit) => ({
          id: visit.id,
          patient_name: visit.case_.patient.name,
          visit_type: visit.visit_type,
          schedule_status: visit.schedule_status,
          time_start: visit.time_window_start?.toISOString() ?? null,
          time_end: visit.time_window_end?.toISOString() ?? null,
        })),
        open_tasks: tasksByUser.get(membership.user.id) ?? [],
      };
    })
    .sort((left, right) => {
      if (left.workload_score !== right.workload_score)
        return right.workload_score - left.workload_score;
      return left.name.localeCompare(right.name, 'ja');
    });

  return success({ data, date: dateKey });
}
