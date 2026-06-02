import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import {
  pharmacySiteInsuranceConfigUpdateSchema,
  rangesOverlap,
} from '@/lib/validations/pharmacy-site-insurance-config';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; configId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '保険設定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = pharmacySiteInsuranceConfigUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id, configId } = await params;
  const siteId = normalizeRequiredRouteParam(id);
  if (!siteId) return validationError('薬局IDが不正です');
  const insuranceConfigId = normalizeRequiredRouteParam(configId);
  if (!insuranceConfigId) return validationError('保険設定IDが不正です');

  const existing = await prisma.pharmacySiteInsuranceConfig.findFirst({
    where: { id: insuranceConfigId, site_id: siteId, org_id: ctx.orgId },
    select: { id: true, insurance_type: true },
  });
  if (!existing) return notFound('保険設定が見つかりません');

  const nextStart = new Date(parsed.data.effective_from);
  const nextEnd = parsed.data.effective_to ? new Date(parsed.data.effective_to) : null;
  const overlappingConfigs = await prisma.pharmacySiteInsuranceConfig.findMany({
    where: {
      org_id: ctx.orgId,
      site_id: siteId,
      insurance_type: existing.insurance_type,
      id: { not: insuranceConfigId },
    },
  });
  if (
    overlappingConfigs.some((config) =>
      rangesOverlap({
        nextStart,
        nextEnd,
        currentStart: config.effective_from,
        currentEnd: config.effective_to,
      }),
    )
  ) {
    return validationError('同一保険種別で適用期間が重複する設定は更新できません');
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const config = await tx.pharmacySiteInsuranceConfig.update({
      where: { id: insuranceConfigId },
      data: {
        revision_label: parsed.data.revision_label ?? null,
        effective_from: nextStart,
        effective_to: nextEnd,
        config: toPrismaJsonInput(parsed.data.config),
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'insurance_config_updated',
        target_type: 'PharmacySiteInsuranceConfig',
        target_id: insuranceConfigId,
        changes: toPrismaJsonInput(parsed.data),
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
  { params }: { params: Promise<{ id: string; configId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '保険設定の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id, configId } = await params;
  const siteId = normalizeRequiredRouteParam(id);
  if (!siteId) return validationError('薬局IDが不正です');
  const insuranceConfigId = normalizeRequiredRouteParam(configId);
  if (!insuranceConfigId) return validationError('保険設定IDが不正です');

  const existing = await prisma.pharmacySiteInsuranceConfig.findFirst({
    where: { id: insuranceConfigId, site_id: siteId, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('保険設定が見つかりません');

  await withOrgContext(ctx.orgId, async (tx) => {
    await tx.pharmacySiteInsuranceConfig.delete({
      where: { id: insuranceConfigId },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'insurance_config_deleted',
        target_type: 'PharmacySiteInsuranceConfig',
        target_id: insuranceConfigId,
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });
  });

  return success({ ok: true });
}
