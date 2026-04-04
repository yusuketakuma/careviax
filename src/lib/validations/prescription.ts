import { z } from 'zod';
import { dispensingLineMetadataSchema } from './dispensing-line';

const optionalDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です');

/**
 * 処方明細行のコアスキーマ（処方箋記載の医学的情報のみ）。
 * 調剤方法（dispensing_method, packaging_instructions）は含まない。
 */
export const corePrescriptionLineSchema = z.object({
  line_number: z.number().int().min(1, '行番号は1以上です'),
  drug_name: z.string().min(1, '薬剤名は必須です'),
  drug_code: z.string().optional(),
  dosage_form: z.string().optional(),
  dose: z.string().min(1, '用量は必須です'),
  frequency: z.string().min(1, '用法は必須です'),
  days: z.number().int().min(1, '投与日数は1以上です'),
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  is_generic: z.boolean().default(false),
  is_generic_name_prescription: z.boolean().default(false),
  notes: z.string().optional(),
  route: z.enum(['internal', 'external', 'injection', 'other']).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）').optional(),
});

/**
 * 処方明細行の完全スキーマ（コア + 調剤メタデータ）。
 * 処方登録APIの入力として使用。調剤メタデータはドラフト値として扱われる。
 */
export const prescriptionLineSchema = corePrescriptionLineSchema.merge(dispensingLineMetadataSchema);

export type CorePrescriptionLineInput = z.infer<typeof corePrescriptionLineSchema>;

export const prescriptionInquiryDraftSchema = z.object({
  reason: z.string().min(1, '照会理由は必須です'),
  inquiry_to_physician: z.string().min(1, '照会先医師名は必須です'),
  inquiry_content: z.string().min(1, '照会内容は必須です'),
  request_due_date: optionalDateStringSchema.optional(),
});

export const createPrescriptionIntakeSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です').optional(),
  case_id: z.string().min(1, 'ケースIDは必須です').optional(),
  patient_id: z.string().min(1, '患者IDは必須です').optional(),
  source_type: z.enum(['paper', 'fax', 'e_prescription', 'facility_batch', 'refill', 'qr_scan'], {
    error: 'ソースタイプを選択してください',
  }),
  prescribed_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  prescriber_name: z.string().optional(),
  prescriber_institution_id: z.string().optional(),
  prescriber_institution: z.string().optional(),
  original_document_url: z.string().url().optional(),
  refill_remaining_count: z.number().int().min(0).optional(),
  refill_next_dispense_date: optionalDateStringSchema.optional(),
  split_dispense_total: z.number().int().min(1).optional(),
  split_dispense_current: z.number().int().min(1).optional(),
  split_next_dispense_date: optionalDateStringSchema.optional(),
  prescription_category: z.enum(['regular', 'emergency']).default('regular'),
  emergency_category: z.enum(['planned_disease_exacerbation', 'other_exacerbation', 'online']).optional(),
  lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
  inquiry: prescriptionInquiryDraftSchema.optional(),
}).superRefine((value, ctx) => {
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

export const createFacilityBatchPrescriptionIntakeSchema = z.object({
  source_type: z.literal('facility_batch'),
  prescribed_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  prescriber_name: z.string().optional(),
  prescriber_institution_id: z.string().optional(),
  prescriber_institution: z.string().optional(),
  original_document_url: z.string().url().optional(),
  prescription_category: z.enum(['regular', 'emergency']).default('regular'),
  emergency_category: z.enum(['planned_disease_exacerbation', 'other_exacerbation', 'online']).optional(),
  entries: z
    .array(
      z.object({
        case_id: z.string().min(1, 'ケースIDは必須です'),
        patient_id: z.string().min(1, '患者IDは必須です'),
        lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
      })
    )
    .min(2, '施設まとめ処方は2名以上の患者が必要です'),
}).superRefine((value, ctx) => {
  if (value.prescription_category === 'emergency' && !value.emergency_category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '緊急処方の場合は緊急区分の選択が必須です',
      path: ['emergency_category'],
    });
  }
});

export const updatePrescriptionIntakeSchema = z.object({
  prescriber_name: z.string().optional(),
  prescriber_institution_id: z.string().nullable().optional(),
  prescriber_institution: z.string().optional(),
  original_document_url: z.string().url().optional(),
  original_collected_at: z.string().datetime('日時形式が不正です').optional(),
  refill_remaining_count: z.number().int().min(0).optional(),
  refill_next_dispense_date: optionalDateStringSchema.nullable().optional(),
  split_dispense_total: z.number().int().min(1).optional(),
  split_dispense_current: z.number().int().min(1).optional(),
  split_next_dispense_date: optionalDateStringSchema.nullable().optional(),
  prescription_category: z.enum(['regular', 'emergency']).optional(),
  emergency_category: z.enum(['planned_disease_exacerbation', 'other_exacerbation', 'online']).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.prescription_category === 'emergency' && value.emergency_category === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '緊急処方の場合は緊急区分の選択が必須です',
      path: ['emergency_category'],
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
