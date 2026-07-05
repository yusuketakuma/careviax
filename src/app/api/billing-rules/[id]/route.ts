import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import {
  conflict,
  forbidden,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { logger } from '@/lib/utils/logger';

const BILLING_RULE_ROUTE = '/api/billing-rules/:id';
const payerBasisSchema = z.enum(['medical', 'care', 'self_pay', 'non_billable']);
const ruleTypeSchema = z.enum(['base', 'addition', 'regional_addition', 'reduction']);
const serviceTypeSchema = z.enum(['medical_home_visit', 'care_home_management', 'generic']);
const providerScopeSchema = z.enum(['pharmacy', 'hospital_clinic']);
const selectionModeSchema = z.enum(['auto', 'manual']);
const calculationUnitSchema = z.enum(['point', 'unit', 'percent']);
const billingScopeSchema = z.enum(['custom', 'custom_override']);

const updateBillingRuleSchema = z.object({
  expected_updated_at: z.string().datetime('算定ルールの版情報が不正です'),
  billing_scope: billingScopeSchema.optional(),
  rule_type: ruleTypeSchema.optional(),
  service_type: serviceTypeSchema.optional(),
  payer_basis: payerBasisSchema.nullable().optional(),
  provider_scope: providerScopeSchema.nullable().optional(),
  selection_mode: selectionModeSchema.optional(),
  calculation_unit: calculationUnitSchema.optional(),
  display_order: z.number().int().optional(),
  name: z.string().min(1).optional(),
  code: z.string().trim().min(1).optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  evidence_requirements: z.record(z.string(), z.unknown()).optional(),
  source_url: z.string().trim().url().optional(),
  source_note: z.string().trim().min(1).optional(),
  amount: z.number().int().optional(),
  effective_from: z.string().date().nullable().optional(),
  effective_to: z.string().date().nullable().optional(),
  is_active: z.boolean().optional(),
});

const deleteBillingRuleQuerySchema = z.object({
  expected_updated_at: z.string().datetime('算定ルールの版情報が不正です'),
});

function parseEffectiveDate(value?: string | null) {
  if (value === null) return null;
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function staleBillingRuleConflict(expectedUpdatedAt: string, currentUpdatedAt: Date | null) {
  return conflict('算定ルールが更新されています。再読み込みしてください', {
    conflict_type: 'stale_billing_rule',
    expected_updated_at: expectedUpdatedAt,
    current_updated_at: currentUpdatedAt?.toISOString() ?? null,
  });
}

function buildBillingRuleAuditSnapshot(rule: Record<string, unknown>): Prisma.InputJsonObject {
  return {
    billing_scope: typeof rule.billing_scope === 'string' ? rule.billing_scope : null,
    rule_type: typeof rule.rule_type === 'string' ? rule.rule_type : null,
    service_type: typeof rule.service_type === 'string' ? rule.service_type : null,
    payer_basis: typeof rule.payer_basis === 'string' ? rule.payer_basis : null,
    provider_scope: typeof rule.provider_scope === 'string' ? rule.provider_scope : null,
    selection_mode: typeof rule.selection_mode === 'string' ? rule.selection_mode : null,
    calculation_unit: typeof rule.calculation_unit === 'string' ? rule.calculation_unit : null,
    display_order: typeof rule.display_order === 'number' ? rule.display_order : null,
    name: typeof rule.name === 'string' ? rule.name : null,
    code: typeof rule.code === 'string' ? rule.code : null,
    amount: typeof rule.amount === 'number' ? rule.amount : null,
    is_active: typeof rule.is_active === 'boolean' ? rule.is_active : null,
    is_system: typeof rule.is_system === 'boolean' ? rule.is_system : null,
  };
}

function serializeRule(
  rule: {
    conditions: Prisma.JsonValue | null;
    evidence_requirements: Prisma.JsonValue | null;
  } & Record<string, unknown>,
) {
  return {
    ...rule,
    conditions: readJsonObject(rule.conditions) ?? {},
    evidence_requirements: readJsonObject(rule.evidence_requirements) ?? {},
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;
    const { id } = await params;
    const ruleId = normalizeRequiredRouteParam(id);
    if (!ruleId) return withSensitiveNoStore(validationError('算定ルールIDが不正です'));

    const rule = await withOrgContext(ctx.orgId, (tx) =>
      tx.billingRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
      }),
    );

    if (!rule) return withSensitiveNoStore(notFound('算定ルールが見つかりません'));
    return withSensitiveNoStore(success(serializeRule(rule)));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'billing_rules_id_get_unhandled_error',
        route: BILLING_RULE_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;
    const { id } = await params;
    const ruleId = normalizeRequiredRouteParam(id);
    if (!ruleId) return withSensitiveNoStore(validationError('算定ルールIDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = updateBillingRuleSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const existing = await tx.billingRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
        });
        if (!existing) return { status: 'not_found' as const };

        const {
          expected_updated_at: expectedUpdatedAtRaw,
          conditions,
          evidence_requirements,
          effective_from,
          effective_to,
          ...rest
        } = parsed.data;
        const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
        if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
          return {
            status: 'stale' as const,
            currentUpdatedAt: existing.updated_at,
          };
        }

        if (existing.is_system) {
          const forbiddenKeys = Object.entries(parsed.data)
            .filter(
              ([key, value]) =>
                key !== 'is_active' && key !== 'expected_updated_at' && value !== undefined,
            )
            .map(([key]) => key);
          if (forbiddenKeys.length > 0) {
            return { status: 'system_forbidden_fields' as const, forbiddenKeys };
          }
        }

        const claimed = await tx.billingRule.updateMany({
          where: { id: ruleId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
          data: {
            ...rest,
            ...(conditions !== undefined ? { conditions: toPrismaJsonInput(conditions) } : {}),
            ...(evidence_requirements !== undefined
              ? { evidence_requirements: toPrismaJsonInput(evidence_requirements) }
              : {}),
            ...(effective_from !== undefined
              ? { effective_from: parseEffectiveDate(effective_from) }
              : {}),
            ...(effective_to !== undefined
              ? { effective_to: parseEffectiveDate(effective_to) }
              : {}),
          },
        });
        if (claimed.count !== 1) {
          const current = await tx.billingRule.findFirst({
            where: { id: ruleId, org_id: ctx.orgId },
            select: { updated_at: true },
          });
          return {
            status: 'stale' as const,
            currentUpdatedAt: current?.updated_at ?? null,
          };
        }

        const updated = await tx.billingRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
        });
        if (!updated) return { status: 'not_found' as const };

        await createAuditLogEntry(tx, ctx, {
          action: 'billing_rule_updated',
          targetType: 'BillingRule',
          targetId: updated.id,
          changes: {
            before: buildBillingRuleAuditSnapshot(existing),
            after: buildBillingRuleAuditSnapshot(updated),
          },
        });
        return { status: 'updated' as const, updated };
      },
      { requestContext: ctx },
    );

    if (result.status === 'not_found') {
      return withSensitiveNoStore(notFound('算定ルールが見つかりません'));
    }
    if (result.status === 'stale') {
      return withSensitiveNoStore(
        staleBillingRuleConflict(parsed.data.expected_updated_at, result.currentUpdatedAt),
      );
    }
    if (result.status === 'system_forbidden_fields') {
      return withSensitiveNoStore(
        validationError('SSOTの公式ルールは有効/無効以外を変更できません', {
          fields: result.forbiddenKeys,
        }),
      );
    }
    return withSensitiveNoStore(success(serializeRule(result.updated)));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'billing_rules_id_patch_unhandled_error',
        route: BILLING_RULE_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;
    const { id } = await params;
    const ruleId = normalizeRequiredRouteParam(id);
    if (!ruleId) return withSensitiveNoStore(validationError('算定ルールIDが不正です'));

    const parsedQuery = deleteBillingRuleQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );
    if (!parsedQuery.success) {
      return withSensitiveNoStore(
        validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors),
      );
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const existing = await tx.billingRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
        });
        if (!existing) return { status: 'not_found' as const };
        if (existing.is_system) return { status: 'system_rule' as const };

        const expectedUpdatedAt = new Date(parsedQuery.data.expected_updated_at);
        if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
          return {
            status: 'stale' as const,
            currentUpdatedAt: existing.updated_at,
          };
        }

        const deleted = await tx.billingRule.deleteMany({
          where: { id: ruleId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        });
        if (deleted.count !== 1) {
          const current = await tx.billingRule.findFirst({
            where: { id: ruleId, org_id: ctx.orgId },
            select: { updated_at: true },
          });
          return {
            status: 'stale' as const,
            currentUpdatedAt: current?.updated_at ?? null,
          };
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'billing_rule_deleted',
          targetType: 'BillingRule',
          targetId: existing.id,
          changes: { before: buildBillingRuleAuditSnapshot(existing) },
        });
        return { status: 'deleted' as const };
      },
      { requestContext: ctx },
    );

    if (result.status === 'not_found') {
      return withSensitiveNoStore(notFound('算定ルールが見つかりません'));
    }
    if (result.status === 'system_rule') {
      return withSensitiveNoStore(forbidden('SSOTの公式ルールは削除できません'));
    }
    if (result.status === 'stale') {
      return withSensitiveNoStore(
        staleBillingRuleConflict(parsedQuery.data.expected_updated_at, result.currentUpdatedAt),
      );
    }
    return withSensitiveNoStore(success({ message: '算定ルールを削除しました' }));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'billing_rules_id_delete_unhandled_error',
        route: BILLING_RULE_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}
