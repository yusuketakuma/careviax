import { NextRequest } from 'next/server';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, validationError } from '@/lib/api/response';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '定型シフトの削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const templateId = normalizeRequiredRouteParam(id);
  if (!templateId) return validationError('定型シフトIDが不正です');

  const existing = await prisma.pharmacistShiftTemplate.findFirst({
    where: {
      id: templateId,
      org_id: ctx.orgId,
    },
  });
  if (!existing) return notFound('定型シフトが見つかりません');

  await withOrgContext(ctx.orgId, (tx) =>
    tx.pharmacistShiftTemplate.delete({
      where: { id: templateId },
    }),
  );

  return success({ data: { id: templateId } });
}
