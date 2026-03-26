import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateMedicationIssueSchema } from '@/lib/validations/medication';
import { prisma } from '@/lib/db/client';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '服薬課題の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateMedicationIssueSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.medicationIssue.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) return notFound('課題が見つかりません');

  const updateData: Record<string, unknown> = { ...parsed.data };

  // resolved / dismissed になる場合は resolved_by / resolved_at を自動セット
  if (
    parsed.data.status === 'resolved' ||
    parsed.data.status === 'dismissed'
  ) {
    updateData.resolved_by = ctx.userId;
    updateData.resolved_at = new Date();
  }

  const issue = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.medicationIssue.update({
      where: { id },
      data: updateData,
    });
  });

  return success({ data: issue });
}
