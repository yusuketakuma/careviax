import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { updateEscalationRuleSchema } from '@/lib/validations/escalation-rule';

function serializeCondition(value: Prisma.JsonValue) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'エスカレーションルールの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateEscalationRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.escalationRule.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('エスカレーションルールが見つかりません');

  const updated = await prisma.escalationRule.update({
    where: { id },
    data: {
      ...(parsed.data.trigger_type !== undefined ? { trigger_type: parsed.data.trigger_type } : {}),
      ...(parsed.data.condition !== undefined
        ? { condition: parsed.data.condition as Prisma.InputJsonValue }
        : {}),
      ...(parsed.data.action !== undefined ? { action: parsed.data.action } : {}),
      ...(parsed.data.notify_role !== undefined ? { notify_role: parsed.data.notify_role } : {}),
      ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active } : {}),
    },
  });

  return success({
    data: {
      id: updated.id,
      trigger_type: updated.trigger_type,
      condition: serializeCondition(updated.condition),
      action: updated.action,
      notify_role: updated.notify_role,
      is_active: updated.is_active,
      created_at: updated.created_at.toISOString(),
      updated_at: updated.updated_at.toISOString(),
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'エスカレーションルールの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const existing = await prisma.escalationRule.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('エスカレーションルールが見つかりません');

  await prisma.escalationRule.delete({
    where: { id },
  });

  return success({ message: 'エスカレーションルールを削除しました' });
}
