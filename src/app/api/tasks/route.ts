import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { createTaskSchema, taskPriorityValues, taskStatusValues } from '@/lib/validations/task';
import {
  type DashboardAssignmentScope,
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { z } from 'zod';

const taskStatusSchema = z.enum(taskStatusValues);
const taskPrioritySchema = z.enum(taskPriorityValues);

function canCreateTaskInAssignmentScope(
  scope: DashboardAssignmentScope,
  task: {
    assigned_to?: string | null;
    related_entity_type?: string;
    related_entity_id?: string;
  },
) {
  if (
    scope.caseIds === undefined &&
    scope.patientIds === undefined &&
    scope.assignedToUserId === undefined
  ) {
    return true;
  }

  if (task.assigned_to && task.assigned_to !== scope.assignedToUserId) {
    return false;
  }

  if (!task.related_entity_id) {
    return task.assigned_to === scope.assignedToUserId;
  }

  if (task.related_entity_type === 'patient') {
    return Boolean(scope.patientIds?.includes(task.related_entity_id));
  }

  if (task.related_entity_type === 'case') {
    return Boolean(scope.caseIds?.includes(task.related_entity_id));
  }

  return task.assigned_to === scope.assignedToUserId;
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const taskType = searchParams.get('task_type') ?? undefined;
  const statusParam = searchParams.get('status') ?? undefined;
  const status = statusParam ? taskStatusSchema.safeParse(statusParam) : null;
  if (status && !status.success) {
    return validationError('タスクステータスが不正です', {
      status: ['対応していないステータスです'],
    });
  }
  const priorityParam = searchParams.get('priority') ?? undefined;
  const priority = priorityParam ? taskPrioritySchema.safeParse(priorityParam) : null;
  if (priority && !priority.success) {
    return validationError('タスク優先度が不正です', {
      priority: ['対応していない優先度です'],
    });
  }
  const assignedTo = searchParams.get('assigned_to') ?? undefined;
  const relatedEntityType = searchParams.get('related_entity_type') ?? undefined;
  const relatedEntityId = searchParams.get('related_entity_id') ?? undefined;
  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: ctx.orgId,
    accessContext: ctx,
  });

  const tasks = await prisma.task.findMany({
    where: {
      org_id: ctx.orgId,
      ...buildDashboardTaskAssignmentWhere(assignmentScope),
      ...(taskType ? { task_type: taskType } : {}),
      ...(status ? { status: status.data } : {}),
      ...(priority ? { priority: priority.data } : {}),
      ...(assignedTo ? { assigned_to: assignedTo } : {}),
      ...(relatedEntityType ? { related_entity_type: relatedEntityType } : {}),
      ...(relatedEntityId ? { related_entity_id: relatedEntityId } : {}),
    },
    orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'desc' }],
  });

  const assignedUserIds = Array.from(
    new Set(tasks.map((task) => task.assigned_to).filter((id): id is string => Boolean(id))),
  );
  const assignedUsers =
    assignedUserIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { org_id: ctx.orgId, id: { in: assignedUserIds } },
          select: { id: true, name: true },
        });
  const assignedUserNameById = new Map(assignedUsers.map((user) => [user.id, user.name]));

  return success({
    data: tasks.map((task) => ({
      ...task,
      assigned_to_name: task.assigned_to
        ? (assignedUserNameById.get(task.assigned_to) ?? null)
        : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createTaskSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: ctx.orgId,
    accessContext: ctx,
  });
  if (
    assignmentScope.assignedToUserId &&
    parsed.data.assigned_to &&
    parsed.data.assigned_to !== assignmentScope.assignedToUserId
  ) {
    return validationError('担当外ユーザーへのタスク割り当てはできません');
  }
  if (!canCreateTaskInAssignmentScope(assignmentScope, parsed.data)) {
    return validationError('担当外リソースのタスクは作成できません');
  }
  if (parsed.data.assigned_to) {
    const assignee = await prisma.membership.findFirst({
      where: {
        org_id: ctx.orgId,
        user_id: parsed.data.assigned_to,
        is_active: true,
        user: { is_active: true },
      },
      select: { user_id: true },
    });
    if (!assignee) {
      return validationError('依頼先スタッフが見つかりません');
    }
  }

  const task = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.task.create({
        data: {
          org_id: ctx.orgId,
          task_type: parsed.data.task_type,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          priority: parsed.data.priority,
          assigned_to: parsed.data.assigned_to ?? null,
          due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null,
          sla_due_at: parsed.data.sla_due_at ? new Date(parsed.data.sla_due_at) : null,
          dedupe_key: parsed.data.dedupe_key ?? null,
          related_entity_type: parsed.data.related_entity_type ?? null,
          related_entity_id: parsed.data.related_entity_id ?? null,
          metadata:
            parsed.data.metadata != null ? toPrismaJsonInput(parsed.data.metadata) : undefined,
        },
      });
    },
    { requestContext: ctx },
  );

  return success({ data: task }, 201);
}
