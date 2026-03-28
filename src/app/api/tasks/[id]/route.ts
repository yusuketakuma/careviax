import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateTaskSchema } from '@/lib/validations/task';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const existing = await prisma.task.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
    },
  });
  if (!existing) return notFound('タスクが見つかりません');

  const task = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.task.update({
      where: { id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.assigned_to !== undefined
          ? { assigned_to: parsed.data.assigned_to }
          : {}),
        ...(parsed.data.due_date !== undefined
          ? { due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null }
          : {}),
        completed_at:
          parsed.data.status === 'completed'
            ? new Date()
            : parsed.data.status
              ? null
              : existing.completed_at,
      },
    });
  }, { requestContext: ctx });

  return success({ data: task });
}
