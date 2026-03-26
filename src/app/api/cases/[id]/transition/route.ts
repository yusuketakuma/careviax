import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { caseTransitionSchema, caseStatusTransitions } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケース更新の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = caseTransitionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { from, to } = parsed.data;

  const existing = await prisma.careCase.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('ケースが見つかりません');

  if (existing.status !== from) {
    return validationError(`現在のステータスが一致しません（現在: ${existing.status}）`);
  }

  const allowed = caseStatusTransitions[from];
  if (!allowed.includes(to)) {
    return validationError(`${from} から ${to} への遷移は許可されていません`);
  }

  const careCase = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.careCase.update({
      where: { id },
      data: { status: to },
    });
  });

  return success(careCase);
}
