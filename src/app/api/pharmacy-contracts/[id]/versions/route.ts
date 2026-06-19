import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { dateKeySchema } from '@/lib/validations/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { resolvePharmacyContractVersionCreationStatus } from '@/server/services/pharmacy-partnerships';

const dateOnlySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const contractVersionStatusSchema = z.enum(['draft', 'active']);
const billingModelSchema = z.enum([
  'free',
  'fixed_per_visit',
  'per_visit_with_addon',
  'expense_reimbursement',
]);
const taxCategorySchema = z.enum([
  'taxable',
  'tax_exempt',
  'non_taxable',
  'out_of_scope',
  'tax_pending',
]);

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

const feeRuleSchema = z
  .object({
    billing_model: billingModelSchema.default('free'),
    unit_price: z.number().int().min(0).nullable().optional(),
    addon_rules: z.record(z.string(), z.unknown()).optional(),
    expense_rules: z.record(z.string(), z.unknown()).optional(),
    tax_category: taxCategorySchema.default('tax_pending'),
    tax_rate_bp: z.number().int().min(0).max(10000).nullable().optional(),
    rounding_rule: optionalTrimmedString(64),
  })
  .superRefine((value, ctx) => {
    if (
      (value.billing_model === 'fixed_per_visit' ||
        value.billing_model === 'per_visit_with_addon') &&
      (!value.unit_price || value.unit_price <= 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['unit_price'],
        message: '有償の1訪問単価は1円以上で指定してください',
      });
    }
  });

const createContractVersionSchema = z
  .object({
    status: contractVersionStatusSchema.default('draft'),
    effective_from: dateOnlySchema,
    effective_to: dateOnlySchema.optional().nullable(),
    change_reason: optionalTrimmedString(1000),
    terms_snapshot: z.record(z.string(), z.unknown()).optional(),
    approved_by_base: optionalTrimmedString(128),
    approved_by_partner: optionalTrimmedString(128),
    fee_rule: feeRuleSchema.default({ billing_model: 'free', tax_category: 'tax_pending' }),
  })
  .superRefine((value, ctx) => {
    if (value.effective_to && value.effective_to < value.effective_from) {
      ctx.addIssue({
        code: 'custom',
        path: ['effective_to'],
        message: '終了日は開始日以降を指定してください',
      });
    }
    if (value.status === 'active') {
      if (!value.approved_by_base) {
        ctx.addIssue({
          code: 'custom',
          path: ['approved_by_base'],
          message: '有効化する契約版には基幹薬局側の承認記録が必要です',
        });
      }
      if (!value.approved_by_partner) {
        ctx.addIssue({
          code: 'custom',
          path: ['approved_by_partner'],
          message: '有効化する契約版には協力薬局側の承認記録が必要です',
        });
      }
    }
  });

function optionalDate(value: string | null | undefined) {
  return value ? utcDateFromLocalKey(value) : null;
}

function activePeriodOverlapWhere(start: Date, end: Date | null) {
  return {
    ...(end ? { effective_from: { lte: end } } : {}),
    OR: [{ effective_to: null }, { effective_to: { gte: start } }],
  };
}

function toJsonInputOrUndefined(value: unknown) {
  return value === undefined ? undefined : toPrismaJsonInput(value);
}

function toSafeFeeRule<T extends object>(feeRule: T | null | undefined) {
  if (!feeRule) return null;
  const source = feeRule as T & {
    addon_rules?: unknown;
    expense_rules?: unknown;
  };
  const { addon_rules: addonRules, expense_rules: expenseRules, ...safe } = source;
  return {
    ...safe,
    has_addon_rules: addonRules !== undefined && addonRules !== null,
    has_expense_rules: expenseRules !== undefined && expenseRules !== null,
  };
}

function toSafeVersion<T extends object>(version: T) {
  const source = version as T & {
    terms_snapshot?: unknown;
    fee_rules?: object[];
  };
  const { terms_snapshot: termsSnapshot, fee_rules: feeRules, ...safe } = source;
  return {
    ...safe,
    has_terms_snapshot: termsSnapshot !== undefined && termsSnapshot !== null,
    active_fee_rule: toSafeFeeRule(feeRules?.[0]),
  };
}

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const contractId = normalizeRequiredRouteParam(rawId);
    if (!contractId) return validationError('薬局間契約IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createContractVersionSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const effectiveFrom = optionalDate(parsed.data.effective_from);
    const effectiveTo = optionalDate(parsed.data.effective_to);
    if (!effectiveFrom) return validationError('日付形式が不正です（YYYY-MM-DD）');

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const contract = await tx.pharmacyContract.findFirst({
        where: { id: contractId, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          partnership_id: true,
          partnership: {
            select: {
              status: true,
              partner_pharmacy: { select: { status: true } },
            },
          },
        },
      });

      if (!contract) return { response: notFound('薬局間契約が見つかりません') };
      const versionStatus = resolvePharmacyContractVersionCreationStatus({
        requestedStatus: parsed.data.status,
        contractStatus: contract.status,
        hasBaseApproval: Boolean(parsed.data.approved_by_base),
        hasPartnerApproval: Boolean(parsed.data.approved_by_partner),
        partnershipStatus: contract.partnership.status,
        partnerPharmacyStatus: contract.partnership.partner_pharmacy.status,
      });
      if (!versionStatus.allowed) {
        return {
          response: conflict(
            versionStatus.blocker === 'terminal_contract'
              ? '期限切れまたは終了済みの契約には版を追加できません'
              : '有効な契約と薬局間連携でのみ契約版を有効化できます',
          ),
        };
      }

      if (versionStatus.nextStatus === 'active') {
        const overlappingVersion = await tx.pharmacyContractVersion.findFirst({
          where: {
            org_id: ctx.orgId,
            contract_id: contractId,
            status: 'active',
            ...activePeriodOverlapWhere(effectiveFrom, effectiveTo),
          },
          select: { id: true },
        });
        if (overlappingVersion) {
          return { response: conflict('同じ期間に有効な契約版がすでに存在します') };
        }
      }

      const latestVersion = await tx.pharmacyContractVersion.findFirst({
        where: { org_id: ctx.orgId, contract_id: contractId },
        orderBy: { version_no: 'desc' },
        select: { version_no: true },
      });
      const nextVersionNo = (latestVersion?.version_no ?? 0) + 1;
      const isActive = versionStatus.nextStatus === 'active';

      const version = await tx.pharmacyContractVersion.create({
        data: {
          org_id: ctx.orgId,
          contract_id: contractId,
          version_no: nextVersionNo,
          status: versionStatus.nextStatus,
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          change_reason: parsed.data.change_reason ?? null,
          terms_snapshot: toPrismaJsonInput(parsed.data.terms_snapshot ?? {}),
          approved_by_base: parsed.data.approved_by_base ?? null,
          approved_by_partner: parsed.data.approved_by_partner ?? null,
          approved_at: isActive ? now : null,
          created_by: ctx.userId,
          fee_rules: {
            create: {
              org_id: ctx.orgId,
              billing_model: parsed.data.fee_rule.billing_model,
              unit_price: parsed.data.fee_rule.unit_price ?? null,
              addon_rules: toJsonInputOrUndefined(parsed.data.fee_rule.addon_rules),
              expense_rules: toJsonInputOrUndefined(parsed.data.fee_rule.expense_rules),
              tax_category: parsed.data.fee_rule.tax_category,
              tax_rate_bp: parsed.data.fee_rule.tax_rate_bp ?? null,
              rounding_rule: parsed.data.fee_rule.rounding_rule ?? null,
              is_active: true,
            },
          },
        },
        include: {
          fee_rules: {
            where: { is_active: true },
            orderBy: { created_at: 'asc' },
            take: 1,
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacy_contract_version_created',
        targetType: 'PharmacyContractVersion',
        targetId: version.id,
        changes: {
          contract_id: contractId,
          partnership_id: contract.partnership_id,
          version_no: nextVersionNo,
          status: versionStatus.nextStatus,
          effective_from: parsed.data.effective_from,
          effective_to: parsed.data.effective_to ?? null,
          change_reason_length: parsed.data.change_reason?.length ?? 0,
          billing_model: parsed.data.fee_rule.billing_model,
          unit_price: parsed.data.fee_rule.unit_price ?? null,
          tax_category: parsed.data.fee_rule.tax_category,
          tax_rate_bp: parsed.data.fee_rule.tax_rate_bp ?? null,
          base_approved: Boolean(parsed.data.approved_by_base),
          partner_approved: Boolean(parsed.data.approved_by_partner),
        },
      });

      return { version };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(toSafeVersion(result.version), 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間契約版の作成権限がありません',
  },
);
