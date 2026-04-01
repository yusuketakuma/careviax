import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateInterventionSchema } from '@/lib/validations/intervention';
import { prisma } from '@/lib/db/client';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '介入記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const intervention = await prisma.intervention.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!intervention) return notFound('介入記録が見つかりません');

  return success({ data: intervention });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '介入記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateInterventionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.intervention.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('介入記録が見つかりません');

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.performed_at) {
    updateData.performed_at = new Date(parsed.data.performed_at);
  }

  const intervention = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.intervention.update({
      where: { id },
      data: updateData,
    });
  });

  return success({ data: intervention });
}
