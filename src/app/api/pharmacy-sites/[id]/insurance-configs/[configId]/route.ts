import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeJsonInput, toPrismaJsonInput } from '@/lib/db/json';
import {
  pharmacySiteInsuranceConfigUpdateSchema,
  rangesOverlap,
} from '@/lib/validations/pharmacy-site-insurance-config';

type InsuranceConfigRouteContext = { params: Promise<{ id: string; configId: string }> };

type InsuranceConfigResponseInput = {
  id: string;
  site_id: string;
  insurance_type: string;
  revision_code: string;
  revision_label: string | null;
  effective_from: string | Date;
  effective_to: string | Date | null;
  config: unknown;
};

function serializeDate(value: string | Date | null) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toInsuranceConfigResponse(row: InsuranceConfigResponseInput) {
  const normalizedConfig = normalizeJsonInput(row.config);
  return {
    id: row.id,
    site_id: row.site_id,
    insurance_type: row.insurance_type,
    revision_code: row.revision_code,
    revision_label: row.revision_label,
    effective_from: serializeDate(row.effective_from),
    effective_to: serializeDate(row.effective_to),
    config:
      normalizedConfig && typeof normalizedConfig === 'object' && !Array.isArray(normalizedConfig)
        ? normalizedConfig
        : {},
  };
}

function buildInsuranceConfigUpdateAuditChanges(parsed: {
  revision_label?: string | null;
  effective_from: string;
  effective_to?: string | null;
  config: Record<string, unknown>;
}) {
  return {
    revision_label: parsed.revision_label ?? null,
    effective_from: parsed.effective_from,
    effective_to: parsed.effective_to ?? null,
    config_changed_keys: Object.keys(parsed.config).sort(),
  };
}

async function authenticatedPATCH(req: NextRequest, { params }: InsuranceConfigRouteContext) {
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

    await createAuditLogEntry(tx, ctx, {
      action: 'insurance_config_updated',
      targetType: 'PharmacySiteInsuranceConfig',
      targetId: insuranceConfigId,
      changes: buildInsuranceConfigUpdateAuditChanges(parsed.data),
    });

    return config;
  });

  return success({ data: toInsuranceConfigResponse(updated) });
}

export async function PATCH(req: NextRequest, routeContext: InsuranceConfigRouteContext) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedDELETE(req: NextRequest, { params }: InsuranceConfigRouteContext) {
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

    await createAuditLogEntry(tx, ctx, {
      action: 'insurance_config_deleted',
      targetType: 'PharmacySiteInsuranceConfig',
      targetId: insuranceConfigId,
    });
  });

  return success({ data: { id: insuranceConfigId } });
}

export async function DELETE(req: NextRequest, routeContext: InsuranceConfigRouteContext) {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
}
