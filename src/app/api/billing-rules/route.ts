import { NextRequest } from 'next/server';
import type { PayerBasis, Prisma } from '@prisma/client';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import {
  ensureHomeCareBillingSsot,
  getHomeCareBillingSsotSummary,
} from '@/server/services/home-care-billing-ssot';

const payerBasisSchema = z.enum(['medical', 'care', 'self_pay', 'non_billable']);
const ruleTypeSchema = z.enum(['base', 'addition', 'regional_addition', 'reduction']);
const serviceTypeSchema = z.enum(['medical_home_visit', 'care_home_management', 'generic']);
const providerScopeSchema = z.enum(['pharmacy', 'hospital_clinic']);
const selectionModeSchema = z.enum(['auto', 'manual']);
const calculationUnitSchema = z.enum(['point', 'unit', 'percent']);
const billingScopeSchema = z.enum(['custom', 'custom_override']);

const createBillingRuleSchema = z.object({
  billing_scope: billingScopeSchema.default('custom'),
  rule_type: ruleTypeSchema,
  service_type: serviceTypeSchema.default('generic'),
  payer_basis: payerBasisSchema.optional(),
  provider_scope: providerScopeSchema.nullable().optional(),
  selection_mode: selectionModeSchema.default('manual'),
  calculation_unit: calculationUnitSchema.default('point'),
  display_order: z.number().int().default(1000),
  name: z.string().min(1),
  code: z.string().trim().min(1).optional(),
  conditions: z.record(z.string(), z.unknown()).default({}),
  evidence_requirements: z.record(z.string(), z.unknown()).optional(),
  source_url: z.string().trim().url().optional(),
  source_note: z.string().trim().min(1).optional(),
  amount: z.number().int().default(0),
  effective_from: z.string().date().optional(),
  effective_to: z.string().date().optional(),
  is_active: z.boolean().default(true),
});

const seedBillingRuleSchema = z.object({
  action: z.literal('seed_home_care_ssot'),
});

function parseEffectiveDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function serializeRule(
  rule: {
    payer_basis: PayerBasis | null;
    provider_scope: string | null;
    calculation_unit: string;
    billing_scope: string;
    source_note: string | null;
    source_url: string | null;
    is_system: boolean;
    amount: number;
    conditions: Prisma.JsonValue | null;
    evidence_requirements: Prisma.JsonValue | null;
  } & Record<string, unknown>,
) {
  return {
    ...rule,
    conditions: readJsonObject(rule.conditions) ?? {},
    evidence_requirements: readJsonObject(rule.evidence_requirements) ?? {},
    payer_basis: rule.payer_basis,
    provider_scope: rule.provider_scope,
    calculation_unit: rule.calculation_unit,
    billing_scope: rule.billing_scope,
    source_note: rule.source_note,
    source_url: rule.source_url,
    is_system: rule.is_system,
    amount: rule.amount,
  };
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const ruleType = searchParams.get('rule_type');
  const billingScope = searchParams.get('billing_scope');
  const serviceType = searchParams.get('service_type');
  const includeInactive = searchParams.get('include_inactive') === 'true';

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    await ensureHomeCareBillingSsot(tx, ctx.orgId);
    const summary = await getHomeCareBillingSsotSummary(tx, ctx.orgId);
    const rules = await tx.billingRule.findMany({
      where: {
        org_id: ctx.orgId,
        ...(ruleType ? { rule_type: ruleType } : {}),
        ...(billingScope ? { billing_scope: billingScope } : {}),
        ...(serviceType ? { service_type: serviceType } : {}),
        ...(includeInactive ? {} : { is_active: true }),
      },
      orderBy: [{ billing_scope: 'asc' }, { display_order: 'asc' }, { created_at: 'asc' }],
    });

    return {
      source: summary.source,
      summary: {
        ssot_rule_count: summary.rules.length,
        custom_rule_count: rules.filter((rule) => rule.billing_scope !== 'home_care_ssot').length,
      },
      rules,
    };
  });

  return success({
    data: result.rules.map((rule) => serializeRule(rule)),
    source: result.source,
    summary: result.summary,
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const seedParsed = seedBillingRuleSchema.safeParse(payload);
  if (seedParsed.success) {
    const seeded = await withOrgContext(ctx.orgId, (tx) =>
      ensureHomeCareBillingSsot(tx, ctx.orgId),
    );

    return success(
      {
        message: '在宅請求 SSOT の公式算定ルールを同期しました',
        ...seeded,
      },
      201,
    );
  }

  const parsed = createBillingRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.create({
      data: {
        org_id: ctx.orgId,
        billing_scope: parsed.data.billing_scope,
        rule_type: parsed.data.rule_type,
        service_type: parsed.data.service_type,
        payer_basis: parsed.data.payer_basis,
        provider_scope: parsed.data.provider_scope ?? null,
        selection_mode: parsed.data.selection_mode,
        calculation_unit: parsed.data.calculation_unit,
        display_order: parsed.data.display_order,
        name: parsed.data.name,
        code: parsed.data.code,
        conditions: toPrismaJsonInput(parsed.data.conditions),
        evidence_requirements: toPrismaJsonInput(parsed.data.evidence_requirements ?? {}),
        source_url: parsed.data.source_url,
        source_note: parsed.data.source_note,
        amount: parsed.data.amount,
        effective_from: parseEffectiveDate(parsed.data.effective_from),
        effective_to: parseEffectiveDate(parsed.data.effective_to),
        is_active: parsed.data.is_active,
      },
    }),
  );

  return success(serializeRule(rule), 201);
}
