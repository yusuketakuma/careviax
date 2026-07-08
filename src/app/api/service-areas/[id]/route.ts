import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const updateServiceAreaSchema = z.object({
  site_id: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  area_type: z.enum(['radius', 'polygon']).optional(),
  geo_data: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateServiceAreaSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const serviceAreaId = normalizeRequiredRouteParam(id);
  if (!serviceAreaId) return validationError('訪問エリアIDが不正です');

  if (parsed.data.site_id !== undefined) {
    const refResult = await validateOrgReferences(ctx.orgId, {
      site_id: parsed.data.site_id,
    });
    if (!refResult.ok) return refResult.response;
  }

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.findFirst({
      where: { id: serviceAreaId, org_id: ctx.orgId },
      select: { id: true },
    }),
  );
  if (!existing) return notFound('訪問エリアが見つかりません');

  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.update({
      where: { id: serviceAreaId },
      data: {
        ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.area_type ? { area_type: parsed.data.area_type } : {}),
        ...(parsed.data.geo_data !== undefined
          ? { geo_data: toPrismaJsonInput(parsed.data.geo_data) }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      },
    }),
  );

  return success({ data: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const serviceAreaId = normalizeRequiredRouteParam(id);
  if (!serviceAreaId) return validationError('訪問エリアIDが不正です');

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.findFirst({
      where: { id: serviceAreaId, org_id: ctx.orgId },
      select: { id: true },
    }),
  );
  if (!existing) return notFound('訪問エリアが見つかりません');

  await withOrgContext(ctx.orgId, (tx) => tx.serviceArea.delete({ where: { id: serviceAreaId } }));
  return success({ data: { id: serviceAreaId } });
}
