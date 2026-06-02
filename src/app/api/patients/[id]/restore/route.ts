import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, conflict, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '患者の復元権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const existing = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, archived_at: true },
  });
  if (!existing) return notFound('患者が見つかりません');
  if (!existing.archived_at) return conflict('患者はアーカイブされていません');

  const updated = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.patient.update({
        where: { id },
        data: {
          archived_at: null,
          archived_by: null,
        },
        select: { id: true, archived_at: true, archived_by: true },
      });
    },
    { requestContext: ctx },
  );

  return success(updated);
}
