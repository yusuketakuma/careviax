import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import type { PayerBasis, Prisma } from '@prisma/client';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import {
  ensureHomeCareBillingSsot,
  getHomeCareBillingSsotSummary,
} from '@/server/services/billing-rules';

const BILLING_RULES_ROUTE = '/api/billing-rules';
const payerBasisSchema = z.enum(['medical', 'care', 'self_pay', 'non_billable']);
const ruleTypeSchema = z.enum(['base', 'addition', 'regional_addition', 'reduction']);
const serviceTypeSchema = z.enum(['medical_home_visit', 'care_home_management', 'generic']);
const providerScopeSchema = z.enum(['pharmacy', 'hospital_clinic']);
const selectionModeSchema = z.enum(['auto', 'manual']);
const calculationUnitSchema = z.enum(['point', 'unit', 'percent']);
const billingScopeSchema = z.enum(['custom', 'custom_override']);
const billingScopeQuerySchema = z.enum(['home_care_ssot', 'custom', 'custom_override']);

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

function parseQueryEnum<T>(
  searchParams: URLSearchParams,
  key: string,
  schema: {
    safeParse: (value: string) => { success: true; data: T } | { success: false };
  },
): { ok: true; data: T | undefined } | { ok: false } {
  const raw = searchParams.get(key);
  if (raw === null) return { ok: true, data: undefined };
  const value = raw.trim();
  if (!value) return { ok: false };
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
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
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;

    const { searchParams } = new URL(req.url);
    const parsedRuleType = parseQueryEnum(searchParams, 'rule_type', ruleTypeSchema);
    const parsedBillingScope = parseQueryEnum(
      searchParams,
      'billing_scope',
      billingScopeQuerySchema,
    );
    const parsedServiceType = parseQueryEnum(searchParams, 'service_type', serviceTypeSchema);
    if (!parsedRuleType.ok || !parsedBillingScope.ok || !parsedServiceType.ok) {
      return withSensitiveNoStore(
        validationError('クエリパラメータが不正です', {
          ...(!parsedRuleType.ok ? { rule_type: ['rule_type が不正です'] } : {}),
          ...(!parsedBillingScope.ok ? { billing_scope: ['billing_scope が不正です'] } : {}),
          ...(!parsedServiceType.ok ? { service_type: ['service_type が不正です'] } : {}),
        }),
      );
    }
    const includeInactive = searchParams.get('include_inactive') === 'true';

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      await ensureHomeCareBillingSsot(tx, ctx.orgId);
      const summary = await getHomeCareBillingSsotSummary(tx, ctx.orgId);
      // 有界: BillingRule は算定ルールのマスタ/カタログ（SSOT公式ルール + 管理者が登録するカスタムルール）で、
      // 患者・訪問ごとに増える運用データではない。org あたりの行数は算定制度上の組み合わせ数と管理者運用で
      // 実質的に小さい（数十〜数百件オーダー）ため無制限に成長しない。
      const rules = await tx.billingRule.findMany({
        where: {
          org_id: ctx.orgId,
          ...(parsedRuleType.data ? { rule_type: parsedRuleType.data } : {}),
          ...(parsedBillingScope.data ? { billing_scope: parsedBillingScope.data } : {}),
          ...(parsedServiceType.data ? { service_type: parsedServiceType.data } : {}),
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

    return withSensitiveNoStore(
      success({
        data: result.rules.map((rule) => serializeRule(rule)),
        source: result.source,
        summary: result.summary,
      }),
    );
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'billing_rules_get_unhandled_error',
        route: BILLING_RULES_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const seedParsed = seedBillingRuleSchema.safeParse(payload);
    if (seedParsed.success) {
      const seeded = await withOrgContext(
        ctx.orgId,
        async (tx) => {
          const result = await ensureHomeCareBillingSsot(tx, ctx.orgId);
          await createAuditLogEntry(tx, ctx, {
            action: 'billing_rules_ssot_seeded',
            targetType: 'BillingRule',
            targetId: 'home_care_ssot',
            changes: {
              action: 'seed_home_care_ssot',
              billing_scope: 'home_care_ssot',
            },
          });
          return result;
        },
        { requestContext: ctx },
      );

      return withSensitiveNoStore(
        success(
          {
            message: '在宅請求 SSOT の公式算定ルールを同期しました',
            ...seeded,
          },
          201,
        ),
      );
    }

    const parsed = createBillingRuleSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const rule = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const created = await tx.billingRule.create({
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
        });
        await createAuditLogEntry(tx, ctx, {
          action: 'billing_rule_created',
          targetType: 'BillingRule',
          targetId: created.id,
          changes: { after: buildBillingRuleAuditSnapshot(created) },
        });
        return created;
      },
      { requestContext: ctx },
    );

    return withSensitiveNoStore(success(serializeRule(rule), 201));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'billing_rules_post_unhandled_error',
        route: BILLING_RULES_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}
