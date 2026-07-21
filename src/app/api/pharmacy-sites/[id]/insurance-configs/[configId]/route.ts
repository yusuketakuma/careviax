import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { success, validationError, notFound } from '@/lib/api/response';
import { normalizeJsonInput, toPrismaJsonInput } from '@/lib/db/json';
import {
  pharmacySiteInsuranceConfigUpdateSchema,
  rangesOverlap,
} from '@/lib/validations/pharmacy-site-insurance-config';

type InsuranceConfigRouteContext = AuthRouteContext<{ id: string; configId: string }>;

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

async function authenticatedPATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: InsuranceConfigRouteContext,
) {
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

  const nextStart = new Date(parsed.data.effective_from);
  const nextEnd = parsed.data.effective_to ? new Date(parsed.data.effective_to) : null;
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const initial = await tx.pharmacySiteInsuranceConfig.findFirst({
        where: { id: insuranceConfigId, site_id: siteId, org_id: ctx.orgId },
        select: { id: true, insurance_type: true },
      });
      if (!initial) return { kind: 'not_found' as const };

      await acquireAdvisoryTxLock(
        tx,
        'insurance_config_dedup',
        `${ctx.orgId}:${siteId}:${initial.insurance_type}`,
      );
      const existing = await tx.pharmacySiteInsuranceConfig.findFirst({
        where: { id: insuranceConfigId, site_id: siteId, org_id: ctx.orgId },
        select: { id: true, insurance_type: true },
      });
      if (!existing) return { kind: 'not_found' as const };

      const overlappingConfigs = await tx.pharmacySiteInsuranceConfig.findMany({
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
        return { kind: 'overlap' as const };
      }

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

      return { kind: 'updated' as const, config };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'not_found') return notFound('保険設定が見つかりません');
  if (result.kind === 'overlap') {
    return validationError('同一保険種別で適用期間が重複する設定は更新できません');
  }

  return success({ data: toInsuranceConfigResponse(result.config) });
}

export const PATCH = withAuthContext(authenticatedPATCH, {
  permission: 'canAdmin',
  message: '保険設定の更新権限がありません',
});

async function authenticatedDELETE(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: InsuranceConfigRouteContext,
) {
  const { id, configId } = await params;
  const siteId = normalizeRequiredRouteParam(id);
  if (!siteId) return validationError('薬局IDが不正です');
  const insuranceConfigId = normalizeRequiredRouteParam(configId);
  if (!insuranceConfigId) return validationError('保険設定IDが不正です');

  const deleted = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const initial = await tx.pharmacySiteInsuranceConfig.findFirst({
        where: { id: insuranceConfigId, site_id: siteId, org_id: ctx.orgId },
        select: { id: true, insurance_type: true },
      });
      if (!initial) return false;
      await acquireAdvisoryTxLock(
        tx,
        'insurance_config_dedup',
        `${ctx.orgId}:${siteId}:${initial.insurance_type}`,
      );
      const existing = await tx.pharmacySiteInsuranceConfig.findFirst({
        where: { id: insuranceConfigId, site_id: siteId, org_id: ctx.orgId },
        select: { id: true },
      });
      if (!existing) return false;

      await tx.pharmacySiteInsuranceConfig.delete({
        where: { id: insuranceConfigId },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'insurance_config_deleted',
        targetType: 'PharmacySiteInsuranceConfig',
        targetId: insuranceConfigId,
      });
      return true;
    },
    { requestContext: ctx },
  );

  if (!deleted) return notFound('保険設定が見つかりません');

  return success({ data: { id: insuranceConfigId } });
}

export const DELETE = withAuthContext(authenticatedDELETE, {
  permission: 'canAdmin',
  message: '保険設定の削除権限がありません',
});
