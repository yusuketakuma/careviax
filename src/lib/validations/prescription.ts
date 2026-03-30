import { z } from 'zod';

export const prescriptionLineSchema = z.object({
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
  packaging_instructions: z.string().optional(),
  notes: z.string().optional(),
  route: z.enum(['internal', 'external', 'injection', 'other']).optional(),
  dispensing_method: z.enum(['standard', 'unit_dose', 'crushed', 'other']).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）').optional(),
});

export const createPrescriptionIntakeSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  source_type: z.enum(['paper', 'fax', 'e_prescription', 'facility_batch', 'refill'], {
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
  refill_next_dispense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional(),
  split_dispense_total: z.number().int().min(1).optional(),
  split_dispense_current: z.number().int().min(1).optional(),
  split_next_dispense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional(),
  lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
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
  entries: z
    .array(
      z.object({
        case_id: z.string().min(1, 'ケースIDは必須です'),
        patient_id: z.string().min(1, '患者IDは必須です'),
        lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
      })
    )
    .min(2, '施設まとめ処方は2名以上の患者が必要です'),
});

export const updatePrescriptionIntakeSchema = z.object({
  prescriber_name: z.string().optional(),
  prescriber_institution_id: z.string().nullable().optional(),
  prescriber_institution: z.string().optional(),
  original_document_url: z.string().url().optional(),
  original_collected_at: z.string().datetime('日時形式が不正です').optional(),
  refill_remaining_count: z.number().int().min(0).optional(),
  refill_next_dispense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional(),
  split_dispense_total: z.number().int().min(1).optional(),
  split_dispense_current: z.number().int().min(1).optional(),
  split_next_dispense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional(),
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
  dose: z.string().min(1, '用量は必須です').optional(),
  frequency: z.string().min(1, '用法は必須です').optional(),
  days: z.number().int().min(1, '投与日数は1以上です').optional(),
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
