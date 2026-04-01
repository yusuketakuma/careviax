import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound } from '@/lib/api/response';

const updateSiteSchema = z.object({
  name: z.string().min(1, '薬局名は必須です'),
  address: z.string().min(1, '住所は必須です'),
  phone: z.string().optional().nullable(),
  fax: z.string().optional().nullable(),
  is_health_support_pharmacy: z.boolean().default(false),
  is_regional_support: z.boolean().default(false),
  is_specialized_pharmacy: z.boolean().default(false),
  dispensing_fee_category: z.string().optional().nullable(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '薬局情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;
  const site = await prisma.pharmacySite.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      insurance_configs: {
        orderBy: [{ insurance_type: 'asc' }, { effective_from: 'desc' }],
      },
    },
  });
  if (!site) return notFound('薬局情報が見つかりません');

  return success({ data: site });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '薬局情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateSiteSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const existing = await prisma.pharmacySite.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('薬局情報が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const site = await tx.pharmacySite.update({
      where: { id },
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

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'pharmacy_site_updated',
        target_type: 'PharmacySite',
        target_id: id,
        changes: parsed.data,
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return site;
  });

  return success({ data: updated });
}
