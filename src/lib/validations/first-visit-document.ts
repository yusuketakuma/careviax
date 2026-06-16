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

export const updateFirstVisitDocumentSchema = z.object({
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
      storage_location: z
        .enum(['store', 'headquarters', 'patient_home_copy_only', 'electronic', 'unknown'])
        .optional()
        .nullable(),
      reason: z.string().trim().max(1000).optional().nullable(),
      note: z.string().trim().max(1000).optional().nullable(),
    })
    .optional(),
});

export type UpdateFirstVisitDocumentInput = z.infer<typeof updateFirstVisitDocumentSchema>;

export type EmergencyContact = z.infer<typeof emergencyContactSchema>;
