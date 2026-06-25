import { NextRequest } from 'next/server';
import { type Prisma, type TaskStatus } from '@prisma/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { isPrismaErrorCode, isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { canCompleteTaskInline } from '@/lib/tasks/inline-completion';
import { createTaskSchema, taskPriorityValues, taskStatusValues } from '@/lib/validations/task';
import {
  type DashboardAssignmentScope,
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { z } from 'zod';

const taskStatusSchema = z.enum(taskStatusValues);
const taskPrioritySchema = z.enum(taskPriorityValues);
const MAX_TASK_TYPE_FILTERS = 20;
const OPEN_TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress'];
const taskListSelect = {
  id: true,
  task_type: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigned_to: true,
  due_date: true,
  sla_due_at: true,
  completed_at: true,
  related_entity_type: true,
  related_entity_id: true,
  created_at: true,
} satisfies Prisma.TaskSelect;
type TaskListRow = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;

type TaskQueryName =
  | 'task_type'
  | 'task_types'
  | 'status'
  | 'priority'
  | 'assigned_to'
  | 'related_entity_type'
  | 'related_entity_id';

function readStrictOptionalTaskFilter(
  searchParams: URLSearchParams,
  name: Exclude<TaskQueryName, 'task_types'>,
  messages: { blank: string; invalid: string; maxLength?: number },
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
  if (value !== value.trim() || value.length > (messages.maxLength ?? 100)) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.invalid] },
    };
  }

  return { ok: true as const, value };
}

function readOptionalTaskTypesFilter(searchParams: URLSearchParams) {
  const values = searchParams.getAll('task_types');
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      fieldErrors: { task_types: ['task_types は1つだけ指定してください'] },
    };
  }

  const value = values[0];
  if (value.trim().length === 0) {
    return {
      ok: false as const,
      fieldErrors: { task_types: ['task_types には1件以上の種別を指定してください'] },
    };
  }
  if (value.length > 2500) {
    return {
      ok: false as const,
      fieldErrors: { task_types: ['task_types の形式が不正です'] },
    };
  }

  return { ok: true as const, value };
}

function parseTaskTypesFilter(value: string | null) {
  if (!value) return { data: undefined as string[] | undefined, error: null as string | null };

  const types = Array.from(
    new Set(
      value
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean),
    ),
  );

  if (types.length === 0) {
    return { data: undefined, error: 'task_types には1件以上の種別を指定してください' };
  }
  if (types.length > MAX_TASK_TYPE_FILTERS) {
    return {
      data: undefined,
      error: `task_types は${MAX_TASK_TYPE_FILTERS}件以下で指定してください`,
    };
  }
  if (types.some((type) => type.length > 100)) {
    return { data: undefined, error: 'task_types の種別名が長すぎます' };
  }

  return { data: types, error: null };
}

function toTaskListItem(task: TaskListRow, assignedToName: string | null) {
  return {
    id: task.id,
    task_type: task.task_type,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigned_to: task.assigned_to,
    assigned_to_name: assignedToName,
    can_complete_inline: canCompleteTaskInline(task),
    due_date: task.due_date,
    sla_due_at: task.sla_due_at,
    completed_at: task.completed_at,
    related_entity_type: task.related_entity_type,
    related_entity_id: task.related_entity_id,
    created_at: task.created_at,
  };
}

function parseTaskListFilters(searchParams: URLSearchParams) {
  const taskTypeResult = readStrictOptionalTaskFilter(searchParams, 'task_type', {
    blank: 'タスク種別を指定してください',
    invalid: 'タスク種別の形式が不正です',
  });
  if (!taskTypeResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', taskTypeResult.fieldErrors),
    };
  }

  const taskTypesResult = readOptionalTaskTypesFilter(searchParams);
  if (!taskTypesResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', taskTypesResult.fieldErrors),
    };
  }

  if (taskTypeResult.value && taskTypesResult.value) {
    return {
      ok: false as const,
      response: validationError('task_type と task_types は同時に指定できません'),
    };
  }

  const taskTypes = parseTaskTypesFilter(taskTypesResult.value ?? null);
  if (taskTypes.error) {
    return {
      ok: false as const,
      response: validationError(taskTypes.error, {
        task_types: [taskTypes.error],
      }),
    };
  }

  const statusResult = readStrictOptionalTaskFilter(searchParams, 'status', {
    blank: 'ステータスを指定してください',
    invalid: '対応していないステータスです',
  });
  if (!statusResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', statusResult.fieldErrors),
    };
  }

  const status =
    statusResult.value && statusResult.value !== 'open'
      ? taskStatusSchema.safeParse(statusResult.value)
      : null;
  if (status && !status.success) {
    return {
      ok: false as const,
      response: validationError('タスクステータスが不正です', {
        status: ['対応していないステータスです'],
      }),
    };
  }

  const priorityResult = readStrictOptionalTaskFilter(searchParams, 'priority', {
    blank: '優先度を指定してください',
    invalid: '対応していない優先度です',
  });
  if (!priorityResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', priorityResult.fieldErrors),
    };
  }

  const priority = priorityResult.value ? taskPrioritySchema.safeParse(priorityResult.value) : null;
  if (priority && !priority.success) {
    return {
      ok: false as const,
      response: validationError('タスク優先度が不正です', {
        priority: ['対応していない優先度です'],
      }),
    };
  }

  const assignedToResult = readStrictOptionalTaskFilter(searchParams, 'assigned_to', {
    blank: '担当者IDを指定してください',
    invalid: '担当者IDの形式が不正です',
  });
  if (!assignedToResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', assignedToResult.fieldErrors),
    };
  }

  const relatedEntityTypeResult = readStrictOptionalTaskFilter(
    searchParams,
    'related_entity_type',
    {
      blank: '関連リソース種別を指定してください',
      invalid: '関連リソース種別の形式が不正です',
    },
  );
  if (!relatedEntityTypeResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', relatedEntityTypeResult.fieldErrors),
    };
  }

  const relatedEntityIdResult = readStrictOptionalTaskFilter(searchParams, 'related_entity_id', {
    blank: '関連リソースIDを指定してください',
    invalid: '関連リソースIDの形式が不正です',
    maxLength: 191,
  });
  if (!relatedEntityIdResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', relatedEntityIdResult.fieldErrors),
    };
  }

  return {
    ok: true as const,
    taskType: taskTypeResult.value,
    taskTypes: taskTypes.data,
    statusParam: statusResult.value,
    status: status?.data,
    priority: priority?.data,
    assignedTo: assignedToResult.value,
    relatedEntityType: relatedEntityTypeResult.value,
    relatedEntityId: relatedEntityIdResult.value,
  };
}

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

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);
  const filters = parseTaskListFilters(searchParams);
  if (!filters.ok) return filters.response;

  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: ctx.orgId,
    accessContext: ctx,
  });

  const taskWhere: Prisma.TaskWhereInput = {
    org_id: ctx.orgId,
    ...buildDashboardTaskAssignmentWhere(assignmentScope),
    ...(filters.taskType ? { task_type: filters.taskType } : {}),
    ...(filters.taskTypes ? { task_type: { in: filters.taskTypes } } : {}),
    ...(filters.statusParam === 'open'
      ? { status: { in: OPEN_TASK_STATUSES } }
      : filters.status
        ? { status: filters.status }
        : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assignedTo ? { assigned_to: filters.assignedTo } : {}),
    ...(filters.relatedEntityType ? { related_entity_type: filters.relatedEntityType } : {}),
    ...(filters.relatedEntityId ? { related_entity_id: filters.relatedEntityId } : {}),
  };

  const tasks = await prisma.task
    .findMany({
      where: taskWhere,
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: taskListSelect,
    })
    .catch((cause) => {
      if (isPrismaErrorCode(cause, 'P2025')) {
        return null;
      }
      throw cause;
    });
  if (!tasks) {
    return validationError('ページカーソルが不正です', {
      cursor: ['指定されたカーソルのタスクが見つかりません'],
    });
  }

  const page = buildCursorPage(tasks, limit, (task) => task.id);
  const assignedUserIds = Array.from(
    new Set(page.data.map((task) => task.assigned_to).filter((id): id is string => Boolean(id))),
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
    data: page.data.map((task) =>
      toTaskListItem(
        task,
        task.assigned_to ? (assignedUserNameById.get(task.assigned_to) ?? null) : null,
      ),
    ),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  });
}

export async function GET(req: NextRequest) {
  return withSensitiveNoStore(await authenticatedGET(req));
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
  if (parsed.data.related_entity_type === 'patient' && parsed.data.related_entity_id) {
    const writable = await requireWritablePatient(prisma, ctx, parsed.data.related_entity_id);
    if ('response' in writable) return writable.response;
  }
  if (parsed.data.related_entity_type === 'case' && parsed.data.related_entity_id) {
    const careCase = await prisma.careCase.findFirst({
      where: {
        id: parsed.data.related_entity_id,
        org_id: ctx.orgId,
      },
      select: { patient_id: true },
    });
    if (!careCase) return validationError('担当外リソースのタスクは作成できません');
    const writable = await requireWritablePatient(prisma, ctx, careCase.patient_id);
    if ('response' in writable) return writable.response;
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

  try {
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
  } catch (cause) {
    if (parsed.data.dedupe_key && isPrismaUniqueConstraintError(cause)) {
      const existingTask = await prisma.task.findFirst({
        where: {
          org_id: ctx.orgId,
          dedupe_key: parsed.data.dedupe_key,
        },
      });
      if (existingTask) {
        return success({ data: existingTask }, 200);
      }
    }
    throw cause;
  }
}
