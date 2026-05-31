import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';

const payerBasisSchema = z.enum(['medical', 'care', 'self_pay', 'non_billable']);
const ruleTypeSchema = z.enum(['base', 'addition', 'regional_addition', 'reduction']);
const serviceTypeSchema = z.enum(['medical_home_visit', 'care_home_management', 'generic']);
const providerScopeSchema = z.enum(['pharmacy', 'hospital_clinic']);
const selectionModeSchema = z.enum(['auto', 'manual']);
const calculationUnitSchema = z.enum(['point', 'unit', 'percent']);
const billingScopeSchema = z.enum(['custom', 'custom_override']);

const updateBillingRuleSchema = z.object({
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

function parseEffectiveDate(value?: string | null) {
  if (value === null) return null;
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
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
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.findFirst({
      where: { id, org_id: ctx.orgId },
    }),
  );

  if (!rule) return notFound('算定ルールが見つかりません');
  return success(serializeRule(rule));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateBillingRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.findFirst({ where: { id, org_id: ctx.orgId } }),
  );
  if (!existing) return notFound('算定ルールが見つかりません');

  if (existing.is_system) {
    const forbiddenKeys = Object.entries(parsed.data)
      .filter(([key, value]) => key !== 'is_active' && value !== undefined)
      .map(([key]) => key);
    if (forbiddenKeys.length > 0) {
      return validationError('SSOTの公式ルールは有効/無効以外を変更できません', {
        fields: forbiddenKeys,
      });
    }
  }

  const { conditions, evidence_requirements, effective_from, effective_to, ...rest } = parsed.data;
  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.update({
      where: { id },
      data: {
        ...rest,
        ...(conditions !== undefined ? { conditions: toPrismaJsonInput(conditions) } : {}),
        ...(evidence_requirements !== undefined
          ? { evidence_requirements: toPrismaJsonInput(evidence_requirements) }
          : {}),
        ...(effective_from !== undefined
          ? { effective_from: parseEffectiveDate(effective_from) }
          : {}),
        ...(effective_to !== undefined ? { effective_to: parseEffectiveDate(effective_to) } : {}),
      },
    }),
  );

  return success(serializeRule(updated));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.findFirst({ where: { id, org_id: ctx.orgId } }),
  );
  if (!existing) return notFound('算定ルールが見つかりません');
  if (existing.is_system) return forbidden('SSOTの公式ルールは削除できません');

  await withOrgContext(ctx.orgId, (tx) => tx.billingRule.delete({ where: { id } }));
  return success({ message: '算定ルールを削除しました' });
}
