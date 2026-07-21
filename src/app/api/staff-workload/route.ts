import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import {
  listAssignableWorkRequestTypes,
  TASK_WORKLOAD_MEMBER_ROLES,
} from '@/lib/tasks/task-assignee-eligibility';
import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { dateKeySchema } from '@/lib/validations/date-key';

const STAFF_ROLE_SET = new Set<string>(TASK_WORKLOAD_MEMBER_ROLES);
const STAFF_ROLE_ORDER = new Map<string, number>(
  TASK_WORKLOAD_MEMBER_ROLES.map((role, index) => [role, index]),
);
const RECENT_TASK_PREVIEW_LIMIT_PER_STAFF = 2;
const RECENT_VISIT_PREVIEW_LIMIT_PER_STAFF = 2;

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

async function authenticatedGET(req: NextRequest, ctx: AuthContext) {
  const searchParams = new URL(req.url).searchParams;
  const invalidQueryParams = findInvalidStaffWorkloadQueryParams(searchParams);
  if (invalidQueryParams) {
    return validationError('入力値が不正です', invalidQueryParams);
  }

  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const dateKey = parsed.data.date ?? japanDateKey();
  const dayStart = utcDateFromLocalKey(dateKey);
  const dayEnd = addUtcDays(dayStart, 1);

  const workloadReads = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const memberships = await tx.membership.findMany({
        where: {
          org_id: ctx.orgId,
          is_active: true,
          user: { is_active: true, account_status: 'active' },
        },
        orderBy: [{ user: { name_kana: 'asc' } }, { user: { name: 'asc' } }],
        select: {
          role: true,
          can_audit_dispense: true,
          user: { select: { id: true, name: true } },
        },
      });

      const staffIds = Array.from(
        new Set(
          memberships
            .filter((membership) => STAFF_ROLE_SET.has(membership.role))
            .map((membership) => membership.user.id),
        ),
      );
      const staffIdSet = new Set(staffIds);
      const staffMemberships = memberships.filter((membership) =>
        staffIdSet.has(membership.user.id),
      );
      if (staffIds.length === 0) {
        return {
          memberships: staffMemberships,
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

      return {
        memberships: staffMemberships,
        staffIds,
        openTaskGroups,
        openTasks,
        visits,
        dispenseTaskGroups,
      };
    },
    { requestContext: ctx },
  );

  const { memberships, staffIds, openTaskGroups, openTasks, visits, dispenseTaskGroups } =
    workloadReads;

  if (staffIds.length === 0) {
    return success({ data: [], meta: { date: dateKey } });
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

  const membershipsByUser = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const userMemberships = membershipsByUser.get(membership.user.id) ?? [];
    userMemberships.push(membership);
    membershipsByUser.set(membership.user.id, userMemberships);
  }
  const assignmentActor = {
    userId: ctx.userId,
    memberships: (membershipsByUser.get(ctx.userId) ?? []).map((membership) => ({
      role: membership.role,
    })),
  };

  const data = Array.from(membershipsByUser.values())
    .map((userMemberships) => {
      const membership = userMemberships[0];
      const roles = Array.from(new Set(userMemberships.map((item) => item.role))).sort(
        (left, right) =>
          (STAFF_ROLE_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (STAFF_ROLE_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
      );
      const staffVisits = visitsByUser.get(membership.user.id) ?? [];
      const openTaskCount = openTaskCountByUser.get(membership.user.id) ?? 0;
      const dispenseTaskCount = dispenseTaskCountByUser.get(membership.user.id) ?? 0;
      const todayVisitCount = staffVisits.length;
      return {
        id: membership.user.id,
        name: membership.user.name,
        role: roles.length === 1 ? roles[0] : 'multiple',
        role_label: roles.map(memberRoleLabel).join('・'),
        assignable_work_request_types: listAssignableWorkRequestTypes(assignmentActor, {
          userId: membership.user.id,
          memberships: userMemberships.map((item) => ({
            role: item.role,
            canAuditDispense: item.can_audit_dispense,
          })),
        }),
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

  return success({ data, meta: { date: dateKey } });
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canVisit',
  message: 'スタッフ業務量の閲覧権限がありません',
});
