import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound } from '@/lib/api/response';

const updateConfigSchema = z.object({
  revision_label: z.string().optional().nullable(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です'),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です').optional().nullable(),
  config: z.record(z.string(), z.any()).default({}),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; configId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '保険設定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id, configId } = await params;
  const existing = await prisma.pharmacySiteInsuranceConfig.findFirst({
    where: { id: configId, site_id: id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('保険設定が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const config = await tx.pharmacySiteInsuranceConfig.update({
      where: { id: configId },
      data: {
        revision_label: parsed.data.revision_label ?? null,
        effective_from: new Date(parsed.data.effective_from),
        effective_to: parsed.data.effective_to ? new Date(parsed.data.effective_to) : null,
        config: parsed.data.config,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'insurance_config_updated',
        target_type: 'PharmacySiteInsuranceConfig',
        target_id: configId,
        changes: parsed.data,
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return config;
  });

  return success({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; configId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '保険設定の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id, configId } = await params;
  const existing = await prisma.pharmacySiteInsuranceConfig.findFirst({
    where: { id: configId, site_id: id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('保険設定が見つかりません');

  await withOrgContext(ctx.orgId, async (tx) => {
    await tx.pharmacySiteInsuranceConfig.delete({
      where: { id: configId },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'insurance_config_deleted',
        target_type: 'PharmacySiteInsuranceConfig',
        target_id: configId,
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });
  });

  return success({ ok: true });
}
