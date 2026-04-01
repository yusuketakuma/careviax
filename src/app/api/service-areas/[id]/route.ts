import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';

const updateServiceAreaSchema = z.object({
  site_id: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  area_type: z.enum(['radius', 'polygon']).optional(),
  geo_data: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateServiceAreaSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  if (parsed.data.site_id !== undefined) {
    const refResult = await validateOrgReferences(ctx.orgId, {
      site_id: parsed.data.site_id,
    });
    if (!refResult.ok) return refResult.response;
  }

  const { id } = await params;
  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    })
  );
  if (!existing) return notFound('訪問エリアが見つかりません');

  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.update({
      where: { id },
      data: {
        ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.area_type ? { area_type: parsed.data.area_type } : {}),
        ...(parsed.data.geo_data
          ? { geo_data: parsed.data.geo_data as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      },
    })
  );

  return success({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    })
  );
  if (!existing) return notFound('訪問エリアが見つかりません');

  await withOrgContext(ctx.orgId, (tx) => tx.serviceArea.delete({ where: { id } }));
  return success({ message: '訪問エリアを削除しました' });
}
