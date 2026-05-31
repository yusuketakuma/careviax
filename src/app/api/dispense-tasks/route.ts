import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { ADMIN_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
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

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const status = searchParams.get('status') ?? undefined;
  const cycle_id = searchParams.get('cycle_id') ?? undefined;
  const assigned_to = searchParams.get('assigned_to') ?? undefined;
  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(req);

  const where = {
    org_id: req.orgId,
    ...(status ? { status } : {}),
    ...(cycle_id ? { cycle_id } : {}),
    ...(assigned_to ? { assigned_to } : {}),
    ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
  };

  const tasks = await prisma.dispenseTask.findMany({
    where,
    orderBy: [{ created_at: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: cycleInclude,
  });

  const hasMore = tasks.length > limit;
  const data = hasMore ? tasks.slice(0, limit) : tasks;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, nextCursor, hasMore });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createDispenseTaskSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { cycle_id, priority, due_date, assigned_to } = parsed.data;
  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(req);

  const cycle = await prisma.medicationCycle.findFirst({
    where: {
      id: cycle_id,
      org_id: req.orgId,
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

  const created = await withOrgContext(req.orgId, async (tx) => {
    const task = await tx.dispenseTask.create({
      data: {
        org_id: req.orgId,
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
        await transitionCycleStatus(tx, cycle_id, req.orgId, 'dispensing', req.userId);
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
          org_id: req.orgId,
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
        orgId: req.orgId,
        eventType: 'dispense_task_emergency_created',
        type: 'urgent',
        title: '緊急の調剤対応が追加されました',
        message: `${task.cycle.case_.patient.name} の緊急調剤タスクを確認してください${due_date ? `（期限 ${due_date.slice(0, 10)}）` : ''}`,
        link: `/dispensing/${task.id}`,
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
}, {
  permission: 'canDispense',
  message: '調剤タスクの作成権限がありません',
});
