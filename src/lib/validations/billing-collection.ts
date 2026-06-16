import { z } from 'zod';

export const billingCollectionStatusSchema = z.enum([
  'unbilled',
  'billed',
  'scheduled',
  'collected',
  'partial',
  'unpaid',
  'dunning',
  'waived',
  'refunded',
  'offset',
]);

export const billingCollectionDocumentIssueStatusSchema = z.enum([
  'not_required',
  'not_issued',
  'issued',
]);

const optionalAmountSchema = z.number().int().min(0).max(99_999_999).optional().nullable();
const optionalTextSchema = z.string().trim().max(200).optional().nullable();

const statusesRequiringBilledAmount = new Set([
  'billed',
  'scheduled',
  'collected',
  'partial',
  'unpaid',
  'dunning',
]);

export const updateBillingCollectionSchema = z
  .object({
    status: billingCollectionStatusSchema,
    billed_amount: optionalAmountSchema,
    collected_amount: optionalAmountSchema,
    payment_method: optionalTextSchema,
    payer_name: optionalTextSchema,
    billed_at: z.string().datetime().optional().nullable(),
    scheduled_collection_at: z.string().datetime().optional().nullable(),
    collected_at: z.string().datetime().optional().nullable(),
    receipt_number: optionalTextSchema,
    receipt_issue_status: billingCollectionDocumentIssueStatusSchema.optional(),
    invoice_issue_status: billingCollectionDocumentIssueStatusSchema.optional(),
    save_receipt_copy: z.boolean().optional().default(false),
    unpaid_reason: z.string().trim().max(500).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const billedAmount = value.billed_amount ?? null;
    const collectedAmount = value.collected_amount ?? null;

    if (statusesRequiringBilledAmount.has(value.status) && billedAmount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billed_amount'],
        message: '請求額は必須です',
      });
    }
    if (value.status === 'scheduled' && !value.scheduled_collection_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduled_collection_at'],
        message: '集金予定日は必須です',
      });
    }
    if (
      ['billed', 'scheduled', 'unpaid', 'dunning'].includes(value.status) &&
      collectedAmount != null &&
      collectedAmount > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['collected_amount'],
        message: '入金済みの金額がある場合は一部入金または集金済を選択してください',
      });
    }
    if (
      billedAmount != null &&
      collectedAmount != null &&
      collectedAmount > billedAmount &&
      value.status !== 'refunded'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['collected_amount'],
        message: '入金額は請求額以下で入力してください',
      });
    }
    if (value.status === 'collected') {
      if (billedAmount == null || billedAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['billed_amount'],
          message: '集金済では請求額を1円以上で入力してください',
        });
      }
      if (collectedAmount == null || collectedAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collected_amount'],
          message: '集金済では入金額を1円以上で入力してください',
        });
      }
      if (!value.collected_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collected_at'],
          message: '集金済では入金日時が必須です',
        });
      }
      if (billedAmount != null && collectedAmount != null && collectedAmount !== billedAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collected_amount'],
          message: '集金済では入金額を請求額と一致させてください',
        });
      }
    }
    if (value.status === 'partial') {
      if (billedAmount == null || billedAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['billed_amount'],
          message: '一部入金では請求額を1円以上で入力してください',
        });
      }
      if (collectedAmount == null || collectedAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collected_amount'],
          message: '一部入金では入金額を1円以上で入力してください',
        });
      }
      if (!value.collected_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collected_at'],
          message: '一部入金では入金日時が必須です',
        });
      }
      if (billedAmount != null && collectedAmount != null && collectedAmount >= billedAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collected_amount'],
          message: '一部入金では入金額を請求額未満にしてください',
        });
      }
    }
    if (value.status === 'dunning' && !value.unpaid_reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unpaid_reason'],
        message: '督促中では未収理由を入力してください',
      });
    }
  });

export type BillingCollectionStatus = z.infer<typeof billingCollectionStatusSchema>;
export type BillingCollectionDocumentIssueStatus = z.infer<
  typeof billingCollectionDocumentIssueStatusSchema
>;
export type UpdateBillingCollectionInput = z.infer<typeof updateBillingCollectionSchema>;

export const billingPaymentProfileSchema = z
  .object({
    payer_type: z.enum(['self', 'family', 'guardian', 'facility', 'other']),
    payer_name: z.string().trim().max(120).optional().nullable(),
    payer_relation: z.string().trim().max(80).optional().nullable(),
    billing_address_mode: z
      .enum(['same_as_patient', 'different', 'facility'])
      .default('same_as_patient'),
    billing_address: z.string().trim().max(500).optional().nullable(),
    payment_method: z.enum([
      'cash',
      'bank_transfer',
      'bank_debit',
      'credit_card',
      'facility_billing',
      'corporate_billing',
      'other',
    ]),
    collection_timing: z.enum(['per_visit', 'month_end', 'next_month', 'facility_batch', 'other']),
    receipt_issue: z.enum(['paper', 'pdf', 'none']),
    invoice_issue: z.enum(['yes', 'no']),
    unpaid_tolerance: z.enum(['none', 'one_month', 'custom']),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.payer_type !== 'self' && !value.payer_name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payer_name'],
        message: '本人以外の支払者では支払者名が必須です',
      });
    }
    if (
      ['family', 'guardian', 'other'].includes(value.payer_type) &&
      !value.payer_relation?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payer_relation'],
        message: '家族・代理人・その他の支払者では続柄が必須です',
      });
    }
    if (value.billing_address_mode !== 'same_as_patient' && !value.billing_address?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing_address'],
        message: '患者住所と異なる請求先では請求先住所が必須です',
      });
    }
    if (value.unpaid_tolerance === 'custom' && !value.note?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: '個別の未収許容条件は備考に記録してください',
      });
    }
  });

export type BillingPaymentProfileInput = z.infer<typeof billingPaymentProfileSchema>;
