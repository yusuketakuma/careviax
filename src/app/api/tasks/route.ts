import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { createTaskSchema } from '@/lib/validations/task';

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const taskType = searchParams.get('task_type') ?? undefined;
  const status = searchParams.get('status') ?? undefined;
  const assignedTo = searchParams.get('assigned_to') ?? undefined;
  const relatedEntityType = searchParams.get('related_entity_type') ?? undefined;
  const relatedEntityId = searchParams.get('related_entity_id') ?? undefined;

  const tasks = await prisma.task.findMany({
    where: {
      org_id: ctx.orgId,
      ...(taskType ? { task_type: taskType } : {}),
      ...(status ? { status: status as never } : {}),
      ...(assignedTo ? { assigned_to: assignedTo } : {}),
      ...(relatedEntityType ? { related_entity_type: relatedEntityType } : {}),
      ...(relatedEntityId ? { related_entity_id: relatedEntityId } : {}),
    },
    orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'desc' }],
  });

  return success({ data: tasks });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const task = await withOrgContext(
    ctx.orgId,
    (tx) =>
    tx.task.create({
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
          parsed.data.metadata != null
            ? (parsed.data.metadata as import('@prisma/client').Prisma.InputJsonValue)
            : undefined,
        },
    }),
    { requestContext: ctx }
  );

  return success({ data: task }, 201);
}
