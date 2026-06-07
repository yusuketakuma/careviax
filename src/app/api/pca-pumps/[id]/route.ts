import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { updatePcaPumpSchema } from '@/lib/validations/pca-pump-rental';

function serializePump(item: {
  maintenance_due_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    ...item,
    maintenance_due_at: item.maintenance_due_at?.toISOString().slice(0, 10) ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプ台帳の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('PCAポンプIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePcaPumpSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.pcaPump.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('PCAポンプが見つかりません');

  const updated = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.pcaPump.update({
        where: { id },
        data: {
          ...(parsed.data.asset_code !== undefined ? { asset_code: parsed.data.asset_code } : {}),
          ...(parsed.data.serial_number !== undefined
            ? { serial_number: parsed.data.serial_number || null }
            : {}),
          ...(parsed.data.model_name !== undefined ? { model_name: parsed.data.model_name } : {}),
          ...(parsed.data.manufacturer !== undefined
            ? { manufacturer: parsed.data.manufacturer || null }
            : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...(parsed.data.maintenance_due_at !== undefined
            ? {
                maintenance_due_at: parsed.data.maintenance_due_at
                  ? new Date(parsed.data.maintenance_due_at)
                  : null,
              }
            : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
        },
      }),
    { requestContext: ctx },
  );

  return success({ data: serializePump(updated) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプ台帳の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('PCAポンプIDが不正です');

  const existing = await prisma.pcaPump.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, _count: { select: { rentals: true } } },
  });
  if (!existing) return notFound('PCAポンプが見つかりません');
  if (existing._count.rentals > 0) {
    return validationError('貸出履歴があるPCAポンプは削除できません。退役に変更してください');
  }

  await withOrgContext(ctx.orgId, (tx) => tx.pcaPump.delete({ where: { id } }), {
    requestContext: ctx,
  });

  return success({ data: { id } });
}
