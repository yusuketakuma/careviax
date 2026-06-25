import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { dateKeySchema } from '@/lib/validations/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { resolvePharmacyContractCreationStatus } from '@/server/services/pharmacy-partnerships';

const dateOnlySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const contractStatusSchema = z.enum([
  'draft',
  'pending_base_approval',
  'pending_partner_approval',
  'active',
  'expired',
  'terminated',
  'suspended',
]);
const creatableContractStatusSchema = z.enum([
  'draft',
  'pending_base_approval',
  'pending_partner_approval',
  'active',
]);
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

const createPharmacyContractSchema = z
  .object({
    partnership_id: z.string().trim().min(1, '薬局間連携IDは必須です'),
    status: creatableContractStatusSchema.default('draft'),
    effective_from: dateOnlySchema,
    effective_to: dateOnlySchema.optional().nullable(),
    closing_day: z.number().int().min(1).max(31).nullable().optional(),
    payment_due_rule: z.record(z.string(), z.unknown()).optional(),
    terms_snapshot: z.record(z.string(), z.unknown()).optional(),
    base_approved_by: optionalTrimmedString(128),
    partner_approved_by: optionalTrimmedString(128),
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
      if (!value.base_approved_by) {
        ctx.addIssue({
          code: 'custom',
          path: ['base_approved_by'],
          message: '有効化する契約には基幹薬局側の承認記録が必要です',
        });
      }
      if (!value.partner_approved_by) {
        ctx.addIssue({
          code: 'custom',
          path: ['partner_approved_by'],
          message: '有効化する契約には協力薬局側の承認記録が必要です',
        });
      }
    }
  });

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  return { ok: true as const, value };
}

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

function toSafeVersion<T extends object>(version: T | null | undefined) {
  if (!version) return null;
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

function toSafeContract<T extends object>(row: T) {
  const source = row as T & {
    payment_due_rule?: unknown;
    versions?: object[];
  };
  const { payment_due_rule: paymentDueRule, versions, ...safe } = source;
  return {
    ...safe,
    has_payment_due_rule: paymentDueRule !== undefined && paymentDueRule !== null,
    latest_version: toSafeVersion(versions?.[0]),
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const rawStatusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!rawStatusResult.ok) return rawStatusResult.response;
    const rawStatus = rawStatusResult.value;
    const status = rawStatus ? contractStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return validationError('検索条件が不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const partnershipIdResult = readPresentOptionalSearchParam(
      searchParams,
      'partnership_id',
      '薬局間連携IDを指定してください',
    );
    if (!partnershipIdResult.ok) return partnershipIdResult.response;
    const partnershipId = partnershipIdResult.value;
    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.pharmacyContract.findMany({
        where: {
          org_id: ctx.orgId,
          ...(partnershipId ? { partnership_id: partnershipId } : {}),
          ...(status ? { status: status.data } : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        include: {
          partnership: {
            select: {
              id: true,
              status: true,
              base_site: { select: { id: true, name: true } },
              partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
          versions: {
            orderBy: [{ version_no: 'desc' }],
            take: 1,
            include: {
              fee_rules: {
                where: { is_active: true },
                orderBy: { created_at: 'asc' },
                take: 1,
              },
            },
          },
        },
      }),
    );

    const page = buildCursorPage(rows, limit, (row) => row.id);
    return success({
      ...page,
      data: page.data.map(toSafeContract),
    });
  },
  {
    permission: 'canVisit',
    message: '薬局間契約の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacyContractSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const effectiveFrom = optionalDate(parsed.data.effective_from);
    const effectiveTo = optionalDate(parsed.data.effective_to);
    if (!effectiveFrom) return validationError('日付形式が不正です（YYYY-MM-DD）');

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const partnership = await tx.pharmacyPartnership.findFirst({
        where: { id: parsed.data.partnership_id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          partner_pharmacy: { select: { status: true } },
        },
      });

      if (!partnership) return { response: notFound('薬局間連携が見つかりません') };
      const contractStatus = resolvePharmacyContractCreationStatus({
        requestedStatus: parsed.data.status,
        hasBaseApproval: Boolean(parsed.data.base_approved_by),
        hasPartnerApproval: Boolean(parsed.data.partner_approved_by),
        partnershipStatus: partnership.status,
        partnerPharmacyStatus: partnership.partner_pharmacy.status,
      });
      if (!contractStatus.allowed) {
        return { response: conflict('有効な薬局間連携でのみ契約を有効化できます') };
      }

      if (contractStatus.nextStatus === 'active') {
        const overlappingContract = await tx.pharmacyContract.findFirst({
          where: {
            org_id: ctx.orgId,
            partnership_id: parsed.data.partnership_id,
            status: 'active',
            ...activePeriodOverlapWhere(effectiveFrom, effectiveTo),
          },
          select: { id: true },
        });
        if (overlappingContract) {
          return { response: conflict('同じ期間に有効な薬局間契約がすでに存在します') };
        }
      }

      const isActive = contractStatus.nextStatus === 'active';
      const contract = await tx.pharmacyContract.create({
        data: {
          org_id: ctx.orgId,
          partnership_id: parsed.data.partnership_id,
          status: contractStatus.nextStatus,
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          closing_day: parsed.data.closing_day ?? null,
          payment_due_rule: toJsonInputOrUndefined(parsed.data.payment_due_rule),
          base_approved_by: parsed.data.base_approved_by ?? null,
          base_approved_at: parsed.data.base_approved_by ? now : null,
          partner_approved_by: parsed.data.partner_approved_by ?? null,
          partner_approved_at: parsed.data.partner_approved_by ? now : null,
          created_by: ctx.userId,
          updated_by: ctx.userId,
          versions: {
            create: {
              org_id: ctx.orgId,
              version_no: 1,
              status: isActive ? 'active' : 'draft',
              effective_from: effectiveFrom,
              effective_to: effectiveTo,
              terms_snapshot: toPrismaJsonInput(parsed.data.terms_snapshot ?? {}),
              approved_by_base: parsed.data.base_approved_by ?? null,
              approved_by_partner: parsed.data.partner_approved_by ?? null,
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
          },
        },
        include: {
          partnership: {
            select: {
              id: true,
              status: true,
              base_site: { select: { id: true, name: true } },
              partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
          versions: {
            orderBy: [{ version_no: 'desc' }],
            take: 1,
            include: {
              fee_rules: {
                where: { is_active: true },
                orderBy: { created_at: 'asc' },
                take: 1,
              },
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacy_contract_created',
        targetType: 'PharmacyContract',
        targetId: contract.id,
        changes: {
          partnership_id: parsed.data.partnership_id,
          status: contractStatus.nextStatus,
          version_no: 1,
          version_status: isActive ? 'active' : 'draft',
          effective_from: parsed.data.effective_from,
          effective_to: parsed.data.effective_to ?? null,
          closing_day: parsed.data.closing_day ?? null,
          has_payment_due_rule: parsed.data.payment_due_rule !== undefined,
          billing_model: parsed.data.fee_rule.billing_model,
          unit_price: parsed.data.fee_rule.unit_price ?? null,
          tax_category: parsed.data.fee_rule.tax_category,
          tax_rate_bp: parsed.data.fee_rule.tax_rate_bp ?? null,
          base_approved: Boolean(parsed.data.base_approved_by),
          partner_approved: Boolean(parsed.data.partner_approved_by),
        },
      });

      return { contract };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(toSafeContract(result.contract), 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間契約の作成権限がありません',
  },
);
