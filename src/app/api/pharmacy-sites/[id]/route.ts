import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound } from '@/lib/api/response';
import { updatePharmacySiteSchema } from '@/lib/validations/pharmacy-site';

async function getPharmacySite(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id } = await params;
  const siteId = normalizeRequiredRouteParam(id);
  if (!siteId) return validationError('薬局IDが不正です');

  const site = await prisma.pharmacySite.findFirst({
    where: { id: siteId, org_id: ctx.orgId },
    include: {
      insurance_configs: {
        orderBy: [{ insurance_type: 'asc' }, { effective_from: 'desc' }],
      },
    },
  });
  if (!site) return notFound('薬局情報が見つかりません');

  return success({ data: site });
}

async function updatePharmacySite(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePharmacySiteSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const siteId = normalizeRequiredRouteParam(id);
  if (!siteId) return validationError('薬局IDが不正です');

  const existing = await prisma.pharmacySite.findFirst({
    where: { id: siteId, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('薬局情報が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const site = await tx.pharmacySite.update({
      where: { id: siteId },
      data: {
        name: parsed.data.name,
        address: parsed.data.address,
        phone: parsed.data.phone ?? null,
        fax: parsed.data.fax ?? null,
        is_health_support_pharmacy: parsed.data.is_health_support_pharmacy,
        is_regional_support: parsed.data.is_regional_support,
        is_specialized_pharmacy: parsed.data.is_specialized_pharmacy,
        dispensing_fee_category: parsed.data.dispensing_fee_category ?? null,
      },
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'pharmacy_site_updated',
      targetType: 'PharmacySite',
      targetId: siteId,
      changes: parsed.data,
    });

    return site;
  });

  return success({ data: updated });
}

export const GET = withAuthContext(getPharmacySite, {
  permission: 'canAdmin',
  message: '薬局情報の閲覧権限がありません',
});

export const PATCH = withAuthContext(updatePharmacySite, {
  permission: 'canAdmin',
  message: '薬局情報の更新権限がありません',
});
