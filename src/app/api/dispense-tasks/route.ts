import { withAuthContext } from '@/lib/auth/context';
import { ADMIN_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict, forbidden } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const createDispenseTaskSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  priority: z.enum(['emergency', 'urgent', 'normal']).default('normal'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional(),
  assigned_to: z.string().optional(),
});

const dispenseTaskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
type DispenseTaskQueryName = 'status' | 'cycle_id' | 'assigned_to';

function buildDispenseTaskNotificationHref(taskId: string) {
  return `/dispense?taskId=${encodeURIComponent(taskId)}`;
}

function readStrictOptionalDispenseTaskFilter(
  searchParams: URLSearchParams,
  name: DispenseTaskQueryName,
  messages: { blank: string; invalid: string },
) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [`${name} は1つだけ指定してください`] },
    };
  }

  const value = values[0];
  if (value.trim().length === 0) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.blank] },
    };
  }
  if (value !== value.trim() || value.length > 100) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.invalid] },
    };
  }

  return { ok: true as const, value };
}

function parseDispenseTaskListFilters(searchParams: URLSearchParams) {
  const statusResult = readStrictOptionalDispenseTaskFilter(searchParams, 'status', {
    blank: 'ステータスを指定してください',
    invalid: '対応していないステータスです',
  });
  if (!statusResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', statusResult.fieldErrors),
    };
  }

  const cycleResult = readStrictOptionalDispenseTaskFilter(searchParams, 'cycle_id', {
    blank: 'サイクルIDを指定してください',
    invalid: 'サイクルIDの形式が不正です',
  });
  if (!cycleResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', cycleResult.fieldErrors),
    };
  }

  const assignedToResult = readStrictOptionalDispenseTaskFilter(searchParams, 'assigned_to', {
    blank: '担当者IDを指定してください',
    invalid: '担当者IDの形式が不正です',
  });
  if (!assignedToResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', assignedToResult.fieldErrors),
    };
  }

  const statusFilter = statusResult.value
    ? dispenseTaskStatusSchema.safeParse(statusResult.value)
    : null;
  if (statusFilter && !statusFilter.success) {
    return {
      ok: false as const,
      response: validationError('調剤タスクステータスが不正です', {
        status: ['対応していないステータスです'],
      }),
    };
  }

  return {
    ok: true as const,
    status: statusFilter?.data,
    cycleId: cycleResult.value,
    assignedTo: assignedToResult.value,
  };
}

const cycleInclude = {
  cycle: {
    select: {
      id: true,
      patient_id: true,
      overall_status: true,
      case_: {
        select: {
          id: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
            },
          },
        },
      },
    },
  },
} as const;

const authenticatedGET = withAuthContext(async (req, ctx) => {
  if (
    !hasPermission(ctx.role, 'canDispense') &&
    !hasPermission(ctx.role, 'canAuditDispense') &&
    !hasPermission(ctx.role, 'canReport')
  ) {
    return forbidden('調剤タスクの閲覧権限がありません');
  }

  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const filters = parseDispenseTaskListFilters(searchParams);
  if (!filters.ok) return filters.response;

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const where = {
    org_id: ctx.orgId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.cycleId ? { cycle_id: filters.cycleId } : {}),
    ...(filters.assignedTo ? { assigned_to: filters.assignedTo } : {}),
    ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
  };

  const tasks = await prisma.dispenseTask.findMany({
    where,
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: cycleInclude,
  });

  return success(buildCursorPage(tasks, limit, (task) => task.id));
});

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createDispenseTaskSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { cycle_id, priority, due_date, assigned_to } = parsed.data;
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    const cycle = await prisma.medicationCycle.findFirst({
      where: {
        id: cycle_id,
        org_id: ctx.orgId,
        ...(cycleAssignmentWhere ? { AND: [cycleAssignmentWhere] } : {}),
      },
      select: {
        id: true,
        patient_id: true,
        overall_status: true,
        case_: {
          select: {
            primary_pharmacist_id: true,
            backup_pharmacist_id: true,
            patient: {
              select: {
                name: true,
              },
            },
          },
        },
        visit_schedules: {
          select: {
            pharmacist_id: true,
          },
        },
      },
    });
    if (!cycle) return notFound('サイクルが見つかりません');

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const task = await tx.dispenseTask.create({
        data: {
          org_id: ctx.orgId,
          cycle_id,
          priority,
          due_date: due_date ? new Date(due_date) : undefined,
          assigned_to: assigned_to ?? null,
          status: 'pending',
        },
        include: cycleInclude,
      });

      // Update cycle status to 'dispensing' if currently ready_to_dispense or dispensing
      if (cycle.overall_status === 'ready_to_dispense' || cycle.overall_status === 'dispensing') {
        try {
          await transitionCycleStatus(tx, cycle_id, ctx.orgId, 'dispensing', ctx.userId);
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            return validationError(`ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`);
          }
          if (err instanceof VersionConflictError) {
            return conflict(err.message);
          }
          throw err;
        }
      }

      if (priority === 'emergency') {
        const bypassRecipients = await tx.membership.findMany({
          where: {
            org_id: ctx.orgId,
            is_active: true,
            role: { in: [...ADMIN_MEMBER_ROLES] },
            user: {
              is_active: true,
            },
          },
          select: {
            user_id: true,
          },
        });

        const explicitUserIds = Array.from(
          new Set(
            [
              assigned_to &&
              [
                cycle.case_?.primary_pharmacist_id,
                cycle.case_?.backup_pharmacist_id,
                ...cycle.visit_schedules.map((schedule) => schedule.pharmacist_id),
              ].includes(assigned_to)
                ? assigned_to
                : null,
              cycle.case_?.primary_pharmacist_id ?? null,
              cycle.case_?.backup_pharmacist_id ?? null,
              ...cycle.visit_schedules.map((schedule) => schedule.pharmacist_id),
              ...bypassRecipients.map((member) => member.user_id),
            ].filter((value): value is string => Boolean(value)),
          ),
        );

        await dispatchNotificationEvent(tx, {
          orgId: ctx.orgId,
          eventType: 'dispense_task_emergency_created',
          type: 'urgent',
          title: '緊急の調剤対応が追加されました',
          message: `${task.cycle.case_.patient.name} の緊急調剤タスクを確認してください${due_date ? `（期限 ${due_date.slice(0, 10)}）` : ''}`,
          link: buildDispenseTaskNotificationHref(task.id),
          metadata: {
            task_id: task.id,
            cycle_id,
            patient_id: task.cycle.patient_id,
            priority,
          },
          explicitUserIds,
          dedupeKey: `dispense-task-emergency:${task.id}`,
        });
      }

      return task;
    });

    return success(created, 201);
  },
  {
    permission: 'canDispense',
    message: '調剤タスクの作成権限がありません',
  },
);
