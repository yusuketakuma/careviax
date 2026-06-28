import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { dateKeySchema } from '@/lib/validations/date-key';

const ROUTE = '/api/staff-workload';
const STAFF_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
  'driver',
] as const;
const RECENT_TASK_PREVIEW_LIMIT_PER_STAFF = 2;
const RECENT_VISIT_PREVIEW_LIMIT_PER_STAFF = 2;
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

const querySchema = z.object({
  date: dateKeySchema('date は YYYY-MM-DD で指定してください').optional(),
});

const staffWorkloadSingleValueQueryNames = ['date'] as const satisfies readonly (keyof z.infer<
  typeof querySchema
>)[];

function findInvalidStaffWorkloadQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of staffWorkloadSingleValueQueryNames) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  const rawDate = searchParams.get('date');
  if (rawDate != null && rawDate !== rawDate.trim()) {
    fieldErrors.date = ['date は YYYY-MM-DD で指定してください'];
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

type OpenTask = {
  id: string;
  title: string;
};

type RecentOpenTaskRow = OpenTask & {
  assigned_to: string | null;
};

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'スタッフ業務量の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const searchParams = new URL(req.url).searchParams;
    const invalidQueryParams = findInvalidStaffWorkloadQueryParams(searchParams);
    if (invalidQueryParams) {
      return validationError('入力値が不正です', invalidQueryParams);
    }

    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const dateKey = parsed.data.date ?? localDateKey();
    const dayStart = utcDateFromLocalKey(dateKey);
    const dayEnd = addUtcDays(dayStart, 1);

    const workloadReads = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const memberships = await tx.membership.findMany({
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
          return {
            memberships,
            staffIds,
            openTaskGroups: [],
            openTasks: [],
            visits: [],
            dispenseTaskGroups: [],
          };
        }

        const [openTaskGroups, openTasks, visits, dispenseTaskGroups] = await Promise.all([
          tx.task.groupBy({
            by: ['assigned_to'],
            where: {
              org_id: ctx.orgId,
              assigned_to: { in: staffIds },
              status: { in: ['pending', 'in_progress'] },
            },
            _count: { id: true },
          }),
          tx.$queryRaw<RecentOpenTaskRow[]>`
            SELECT id, assigned_to, title
            FROM (
              SELECT
                id,
                assigned_to,
                title,
                due_date,
                sla_due_at,
                priority,
                created_at,
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
            WHERE rn <= ${RECENT_TASK_PREVIEW_LIMIT_PER_STAFF}
            ORDER BY assigned_to ASC, rn ASC
          `,
          tx.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              pharmacist_id: { in: staffIds },
              scheduled_date: { gte: dayStart, lt: dayEnd },
              schedule_status: { notIn: ['cancelled', 'rescheduled'] },
            },
            select: {
              id: true,
              pharmacist_id: true,
              case_: { select: { patient: { select: { name: true } } } },
            },
            orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
          }),
          tx.dispenseTask.groupBy({
            by: ['assigned_to'],
            where: {
              org_id: ctx.orgId,
              assigned_to: { in: staffIds },
              status: { in: ['pending', 'in_progress'] },
            },
            _count: { id: true },
          }),
        ]);

        return { memberships, staffIds, openTaskGroups, openTasks, visits, dispenseTaskGroups };
      },
      { requestContext: ctx },
    );

    const { memberships, staffIds, openTaskGroups, openTasks, visits, dispenseTaskGroups } =
      workloadReads;

    if (staffIds.length === 0) {
      return success({ data: [], date: dateKey });
    }

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
      if (items.length >= RECENT_TASK_PREVIEW_LIMIT_PER_STAFF) continue;
      items.push({
        id: task.id,
        title: task.title,
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
          visits: staffVisits.slice(0, RECENT_VISIT_PREVIEW_LIMIT_PER_STAFF).map((visit) => ({
            id: visit.id,
            patient_name: visit.case_.patient.name,
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
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('staff_workload_unhandled_error', undefined, {
        event: 'staff_workload_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
