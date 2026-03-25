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
});

export const createPrescriptionIntakeSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  source_type: z.enum(['paper', 'fax', 'e_prescription', 'facility_batch', 'refill'], {
    errorMap: () => ({ message: 'ソースタイプを選択してください' }),
  }),
  prescribed_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  prescriber_name: z.string().optional(),
  prescriber_institution: z.string().optional(),
  original_document_url: z.string().url().optional(),
  refill_remaining_count: z.number().int().min(0).optional(),
  refill_next_dispense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional(),
  split_dispense_total: z.number().int().min(1).optional(),
  split_dispense_current: z.number().int().min(1).optional(),
  lines: z.array(prescriptionLineSchema).min(1, '処方明細は1行以上必要です'),
});

export const updatePrescriptionIntakeSchema = z.object({
  prescriber_name: z.string().optional(),
  prescriber_institution: z.string().optional(),
  original_document_url: z.string().url().optional(),
  refill_remaining_count: z.number().int().min(0).optional(),
  refill_next_dispense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional(),
});

export const createInquiryRecordSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  line_id: z.string().optional(),
  reason: z.string().min(1, '照会理由は必須です'),
  inquiry_to_physician: z.string().min(1, '照会先医師名は必須です'),
  inquiry_content: z.string().min(1, '照会内容は必須です'),
  inquired_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です'),
});

export const updateInquiryRecordSchema = z.object({
  result: z.enum(['changed', 'unchanged', 'pending']).optional(),
  change_detail: z.string().optional(),
  resolved_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です')
    .optional(),
});

export type PrescriptionLineInput = z.infer<typeof prescriptionLineSchema>;
export type CreatePrescriptionIntakeInput = z.infer<typeof createPrescriptionIntakeSchema>;
export type UpdatePrescriptionIntakeInput = z.infer<typeof updatePrescriptionIntakeSchema>;
export type CreateInquiryRecordInput = z.infer<typeof createInquiryRecordSchema>;
export type UpdateInquiryRecordInput = z.infer<typeof updateInquiryRecordSchema>;
