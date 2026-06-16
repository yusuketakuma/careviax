import { z } from 'zod';
import { phoneNumberSchema } from '@/lib/validations/phone';

const requiredPhoneNumberSchema = z
  .string()
  .trim()
  .min(1, '電話番号は必須です')
  .pipe(phoneNumberSchema);

const emergencyContactSchema = z.object({
  name: z.string().min(1, '氏名は必須です'),
  relationship: z.string().min(1, '続柄は必須です'),
  phone: requiredPhoneNumberSchema,
});

const documentUrlSchema = z
  .string()
  .trim()
  .max(2048, '文書URLは2048文字以内で入力してください')
  .refine((value) => {
    if (value.startsWith('/')) return !value.startsWith('//');

    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return true;
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
  }, '文書URLは相対パス、HTTPS、またはローカル開発用HTTPで指定してください');

const documentActionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）');

export const createFirstVisitDocumentSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().min(1, 'ケースIDは必須です'),
  template_id: z.string().min(1, 'テンプレートIDは必須です').optional(),
  emergency_contacts: z
    .array(emergencyContactSchema)
    .min(1, '緊急連絡先を1件以上入力してください')
    .optional(),
  delivered_at: z.string().datetime().optional(),
  delivered_to: z.string().optional(),
  document_url: documentUrlSchema.optional(),
});

export type CreateFirstVisitDocumentInput = z.infer<typeof createFirstVisitDocumentSchema>;

export const updateFirstVisitDocumentSchema = z
  .object({
    delivered_at: z.string().datetime().optional().nullable(),
    delivered_to: z.string().optional().nullable(),
    emergency_contacts: z.array(emergencyContactSchema).min(1).optional(),
    document_url: documentUrlSchema.optional().nullable(),
    document_action: z
      .object({
        action: z.enum([
          'generated',
          'printed',
          'recovered',
          'image_saved',
          'replaced',
          'invalidated',
        ]),
        document_type: z
          .enum([
            'contract',
            'important_matters',
            'consent',
            'privacy_consent',
            'first_visit_document',
            'other',
          ])
          .default('first_visit_document'),
        template_name: z.string().trim().max(120).optional().nullable(),
        template_version: z.string().trim().max(40).optional().nullable(),
        print_batch_id: z
          .string()
          .trim()
          .max(80)
          .regex(/^[A-Za-z0-9_-]+$/, '印刷バッチIDは英数字、_、-で指定してください')
          .optional()
          .nullable(),
        storage_location: z
          .enum(['store', 'headquarters', 'patient_home_copy_only', 'electronic', 'unknown'])
          .optional()
          .nullable(),
        contract_date: documentActionDateSchema.optional().nullable(),
        explanation_date: documentActionDateSchema.optional().nullable(),
        explanation_staff_name: z.string().trim().max(80).optional().nullable(),
        signer_type: z.enum(['self', 'family', 'proxy', 'guardian', 'other']).optional().nullable(),
        signer_name: z.string().trim().max(80).optional().nullable(),
        signer_relationship: z.string().trim().max(80).optional().nullable(),
        reason: z.string().trim().max(1000).optional().nullable(),
        note: z.string().trim().max(1000).optional().nullable(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const action = value.document_action?.action;
    if (value.document_action?.print_batch_id && action !== 'printed') {
      ctx.addIssue({
        code: 'custom',
        path: ['document_action', 'print_batch_id'],
        message: '印刷バッチIDは印刷履歴でのみ指定できます',
      });
    }

    if (!['replaced', 'invalidated'].includes(action ?? '')) return;
    if (value.document_action?.reason?.trim()) return;

    ctx.addIssue({
      code: 'custom',
      path: ['document_action', 'reason'],
      message: '差替え・無効化では理由を入力してください',
    });
  });

export type UpdateFirstVisitDocumentInput = z.infer<typeof updateFirstVisitDocumentSchema>;

export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

export const recordFirstVisitDocumentPrintBatchSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  document_ids: z
    .array(z.string().min(1, '初回文書IDは必須です'))
    .min(1, '印刷対象の初回文書を1件以上選択してください')
    .max(50, '一度に印刷できる初回文書は50件までです'),
  save_copy: z.boolean().default(true),
});

export type RecordFirstVisitDocumentPrintBatchInput = z.infer<
  typeof recordFirstVisitDocumentPrintBatchSchema
>;
