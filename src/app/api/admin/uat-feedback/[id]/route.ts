import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const updateUatFeedbackSchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['open', 'triaged', 'in_progress', 'resolved', 'deferred']).optional(),
  owner_user_id: z.string().trim().min(1).nullable().optional(),
  linked_work_item: z.string().trim().max(200).nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'UAT フィードバックの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('UAT フィードバックIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateUatFeedbackSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.uatFeedback.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, status: true, resolved_at: true },
  });
  if (!existing) return notFound('UAT フィードバックが見つかりません');

  if (parsed.data.owner_user_id) {
    const owner = await prisma.user.findFirst({
      where: { id: parsed.data.owner_user_id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!owner) {
      return validationError('割当先ユーザーが見つかりません', {
        owner_user_id: ['同一組織のユーザーを指定してください'],
      });
    }
  }

  const nextStatus = parsed.data.status;
  const resolvedAtUpdate =
    nextStatus === undefined
      ? {}
      : nextStatus === 'resolved' && existing.status !== 'resolved'
        ? { resolved_at: new Date() }
        : nextStatus !== 'resolved' && existing.status === 'resolved'
          ? { resolved_at: null }
          : {};

  const updated = await prisma.uatFeedback.update({
    where: { id },
    data: {
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      ...(parsed.data.owner_user_id !== undefined
        ? { owner_user_id: parsed.data.owner_user_id }
        : {}),
      ...(parsed.data.linked_work_item !== undefined
        ? { linked_work_item: parsed.data.linked_work_item }
        : {}),
      ...(parsed.data.due_date !== undefined
        ? { due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null }
        : {}),
      ...resolvedAtUpdate,
    },
  });

  return success({
    data: {
      ...updated,
      checked_items: Array.isArray(updated.checked_items) ? updated.checked_items : [],
      due_date: updated.due_date?.toISOString() ?? null,
      resolved_at: updated.resolved_at?.toISOString() ?? null,
      created_at: updated.created_at.toISOString(),
      updated_at: updated.updated_at.toISOString(),
    },
  });
}
