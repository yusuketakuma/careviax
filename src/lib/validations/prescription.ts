import { z } from 'zod';
import { dispensingLineMetadataSchema } from './dispensing-line';

function blankStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
}

function requiredTrimmedStringSchema(message: string) {
  return z.string().trim().min(1, message);
}

const optionalTrimmedStringSchema = z.preprocess(
  blankStringToUndefined,
  z.string().trim().optional(),
);

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value: string) {
  if (!dateKeyPattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function dateStringSchema(message: string) {
  return z.string().trim().regex(dateKeyPattern, message).refine(isValidDateKey, message);
}

const optionalDateStringSchema = z.preprocess(
  blankStringToUndefined,
  dateStringSchema('日付形式が不正です').optional(),
);

const prescriptionDocumentUrlSchema = z
  .string()
  .trim()
  .max(2048, '処方せん原本URLは2048文字以内で入力してください')
  .refine((value) => {
    if (value.startsWith('/')) return !value.startsWith('//');

    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return true;
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
  }, '処方せん原本URLは相対パス、HTTPS、またはローカル開発用HTTPで指定してください');

const optionalPrescriptionDocumentUrlSchema = z.preprocess(
  blankStringToUndefined,
  prescriptionDocumentUrlSchema.optional(),
);

/**
 * 処方明細行のコアスキーマ（処方箋記載の医学的情報のみ）。
 * 調剤方法（dispensing_method, packaging_instructions）は含まない。
 */
const corePrescriptionLineBaseSchema = z.object({
  line_number: z.number().int().min(1, '行番号は1以上です'),
  drug_name: requiredTrimmedStringSchema('薬剤名は必須です'),
  drug_code: optionalTrimmedStringSchema,
  dosage_form: optionalTrimmedStringSchema,
  dose: requiredTrimmedStringSchema('用量は必須です'),
  frequency: requiredTrimmedStringSchema('用法は必須です'),
  days: z.number().int().min(1, '投与日数は1以上です'),
  quantity: z.number().positive().optional(),
  unit: optionalTrimmedStringSchema,
  is_generic: z.boolean().default(false),
  is_generic_name_prescription: z.boolean().default(false),
  notes: optionalTrimmedStringSchema,
  route: z.enum(['internal', 'external', 'injection', 'other']).optional(),
  start_date: optionalDateStringSchema,
  end_date: optionalDateStringSchema,
});

function validatePrescriptionLineDateRange(
  line: { start_date?: string; end_date?: string },
  ctx: z.RefinementCtx,
) {
  if (line.start_date && line.end_date && line.start_date > line.end_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_date'],
      message: '終了日は開始日以降にしてください',
    });
  }
}

export const corePrescriptionLineSchema = corePrescriptionLineBaseSchema.superRefine(
  validatePrescriptionLineDateRange,
);

/**
 * 処方明細行の完全スキーマ（コア + 調剤メタデータ）。
 * 処方登録APIの入力として使用。調剤メタデータはドラフト値として扱われる。
 */
export const prescriptionLineSchema = corePrescriptionLineBaseSchema
  .merge(dispensingLineMetadataSchema)
  .superRefine(validatePrescriptionLineDateRange);

export type CorePrescriptionLineInput = z.infer<typeof corePrescriptionLineSchema>;

export const prescriptionInquiryDraftSchema = z.object({
  reason: requiredTrimmedStringSchema('照会理由は必須です'),
  inquiry_to_physician: requiredTrimmedStringSchema('照会先医師名は必須です'),
  inquiry_content: requiredTrimmedStringSchema('照会内容は必須です'),
  request_due_date: optionalDateStringSchema,
});

export const createPrescriptionIntakeSchema = z
  .object({
    cycle_id: z.preprocess(
      blankStringToUndefined,
      requiredTrimmedStringSchema('サイクルIDは必須です').optional(),
    ),
    case_id: z.preprocess(
      blankStringToUndefined,
      requiredTrimmedStringSchema('ケースIDは必須です').optional(),
    ),
    patient_id: z.preprocess(
      blankStringToUndefined,
      requiredTrimmedStringSchema('患者IDは必須です').optional(),
    ),
    qr_draft_id: z.preprocess(
      blankStringToUndefined,
      requiredTrimmedStringSchema('QR下書きIDは必須です').optional(),
    ),
    source_type: z.enum(['paper', 'fax', 'e_prescription', 'facility_batch', 'refill', 'qr_scan'], {
      error: 'ソースタイプを選択してください',
    }),
    prescribed_date: dateStringSchema('日付形式が不正です（YYYY-MM-DD）'),
    prescriber_name: optionalTrimmedStringSchema,
    prescriber_institution_id: optionalTrimmedStringSchema,
    prescriber_institution: optionalTrimmedStringSchema,
    prescription_expiry_date: optionalDateStringSchema,
    original_document_url: optionalPrescriptionDocumentUrlSchema,
    refill_remaining_count: z.number().int().min(0).optional(),
    refill_next_dispense_date: optionalDateStringSchema,
    split_dispense_total: z.number().int().min(1).optional(),
    split_dispense_current: z.number().int().min(1).optional(),
    split_next_dispense_date: optionalDateStringSchema,
    prescription_category: z.enum(['regular', 'emergency']).default('regular'),
    emergency_category: z
      .enum(['planned_disease_exacerbation', 'other_exacerbation', 'online'])
      .optional(),
    lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
    inquiry: prescriptionInquiryDraftSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasCycleId = typeof value.cycle_id === 'string' && value.cycle_id.length > 0;
    const hasCaseAndPatient =
      typeof value.case_id === 'string' &&
      value.case_id.length > 0 &&
      typeof value.patient_id === 'string' &&
      value.patient_id.length > 0;

    if (!hasCycleId && !hasCaseAndPatient) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'サイクルID、または患者IDとケースIDの組み合わせが必要です',
        path: ['cycle_id'],
      });
    }

    if (value.prescription_category === 'emergency' && !value.emergency_category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '緊急処方の場合は緊急区分の選択が必須です',
        path: ['emergency_category'],
      });
    }
  });

export const createFacilityBatchPrescriptionIntakeSchema = z
  .object({
    source_type: z.literal('facility_batch'),
    prescribed_date: dateStringSchema('日付形式が不正です（YYYY-MM-DD）'),
    prescriber_name: optionalTrimmedStringSchema,
    prescriber_institution_id: optionalTrimmedStringSchema,
    prescriber_institution: optionalTrimmedStringSchema,
    original_document_url: optionalPrescriptionDocumentUrlSchema,
    prescription_category: z.enum(['regular', 'emergency']).default('regular'),
    emergency_category: z
      .enum(['planned_disease_exacerbation', 'other_exacerbation', 'online'])
      .optional(),
    entries: z
      .array(
        z.object({
          case_id: requiredTrimmedStringSchema('ケースIDは必須です'),
          patient_id: requiredTrimmedStringSchema('患者IDは必須です'),
          lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
        }),
      )
      .min(2, '施設まとめ処方は2名以上の患者が必要です'),
  })
  .superRefine((value, ctx) => {
    if (value.prescription_category === 'emergency' && !value.emergency_category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '緊急処方の場合は緊急区分の選択が必須です',
        path: ['emergency_category'],
      });
    }
  });

export const updatePrescriptionIntakeSchema = z
  .object({
    prescriber_name: z.string().optional(),
    prescriber_institution_id: z.string().nullable().optional(),
    prescriber_institution: z.string().optional(),
    original_document_url: optionalPrescriptionDocumentUrlSchema,
    original_collected_at: z.string().datetime('日時形式が不正です').optional(),
    refill_remaining_count: z.number().int().min(0).optional(),
    refill_next_dispense_date: optionalDateStringSchema.nullable().optional(),
    split_dispense_total: z.number().int().min(1).optional(),
    split_dispense_current: z.number().int().min(1).optional(),
    split_next_dispense_date: optionalDateStringSchema.nullable().optional(),
    prescription_category: z.enum(['regular', 'emergency']).optional(),
    emergency_category: z
      .enum(['planned_disease_exacerbation', 'other_exacerbation', 'online'])
      .nullable()
      .optional(),
    original_management: z
      .object({
        reconciliation_result: z.enum(['not_checked', 'matched', 'discrepancy']),
        discrepancy_note: z.string().trim().max(1000).nullable().optional(),
        storage_location: z
          .enum(['not_stored', 'store', 'headquarters', 'electronic', 'patient_copy_only'])
          .nullable()
          .optional(),
        e_prescription_exchange_number: z.string().trim().max(100).nullable().optional(),
        e_prescription_acquired_status: z
          .enum(['not_applicable', 'pending', 'acquired'])
          .default('not_applicable'),
        dispensing_result_registration: z
          .enum(['not_applicable', 'pending', 'registered'])
          .default('not_applicable'),
        note: z.string().trim().max(1000).nullable().optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.prescription_category === 'emergency' && value.emergency_category === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '緊急処方の場合は緊急区分の選択が必須です',
        path: ['emergency_category'],
      });
    }
    if (
      value.original_management?.reconciliation_result === 'discrepancy' &&
      !value.original_management.discrepancy_note?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '差異ありの場合は差異内容を入力してください',
        path: ['original_management', 'discrepancy_note'],
      });
    }
    if (
      value.original_management &&
      ['pending', 'acquired'].includes(value.original_management.e_prescription_acquired_status) &&
      !value.original_management.e_prescription_exchange_number?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '電子処方せん対象では引換番号を入力してください',
        path: ['original_management', 'e_prescription_exchange_number'],
      });
    }
    if (
      value.original_management?.e_prescription_acquired_status === 'pending' &&
      value.original_management.dispensing_result_registration === 'registered'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '電子処方せん取得待ちでは調剤結果登録済みにできません',
        path: ['original_management', 'dispensing_result_registration'],
      });
    }
    if (
      value.original_management &&
      value.original_management.storage_location === 'not_stored' &&
      (value.original_management.reconciliation_result !== 'not_checked' ||
        value.original_management.dispensing_result_registration === 'registered')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '照合済みまたは調剤結果登録済みでは保管場所を記録してください',
        path: ['original_management', 'storage_location'],
      });
    }
  });

export const createInquiryRecordSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  issue_id: z.string().optional(),
  line_id: z.string().optional(),
  reason: z.string().min(1, '照会理由は必須です'),
  inquiry_to_physician: z.string().min(1, '照会先医師名は必須です'),
  inquiry_content: z.string().min(1, '照会内容は必須です'),
  proposal_origin: z.enum(['post_inquiry', 'pre_issuance']).optional(),
  residual_adjustment: z.boolean().optional(),
  inquired_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です'),
  request_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
});

const inquiryLineUpdateSchema = z.object({
  drug_name: z.string().min(1, '薬剤名は必須です').optional(),
  drug_code: z.string().optional(),
  dose: z.string().min(1, '用量は必須です').optional(),
  frequency: z.string().min(1, '用法は必須です').optional(),
  days: z.number().int().min(1, '投与日数は1以上です').optional(),
  packaging_instructions: z.string().optional(),
  route: z.string().optional(),
});

export const updateInquiryRecordSchema = z.object({
  result: z.enum(['changed', 'unchanged', 'pending']).optional(),
  change_detail: z.string().optional(),
  proposal_origin: z.enum(['post_inquiry', 'pre_issuance']).optional(),
  residual_adjustment: z.boolean().optional(),
  resolved_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です')
    .optional(),
  line_update: inquiryLineUpdateSchema.optional(),
});

export type PrescriptionLineInput = z.infer<typeof prescriptionLineSchema>;
export type CreatePrescriptionIntakeInput = z.infer<typeof createPrescriptionIntakeSchema>;
export type CreateFacilityBatchPrescriptionIntakeInput = z.infer<
  typeof createFacilityBatchPrescriptionIntakeSchema
>;
export type UpdatePrescriptionIntakeInput = z.infer<typeof updatePrescriptionIntakeSchema>;
export type CreateInquiryRecordInput = z.infer<typeof createInquiryRecordSchema>;
export type UpdateInquiryRecordInput = z.infer<typeof updateInquiryRecordSchema>;
export type PrescriptionInquiryDraftInput = z.infer<typeof prescriptionInquiryDraftSchema>;
