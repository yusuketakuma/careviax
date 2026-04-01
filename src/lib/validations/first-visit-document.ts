import { z } from 'zod';

const emergencyContactSchema = z.object({
  name: z.string().min(1, '氏名は必須です'),
  relationship: z.string().min(1, '続柄は必須です'),
  phone: z.string().min(1, '電話番号は必須です'),
});

export const createFirstVisitDocumentSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().min(1, 'ケースIDは必須です'),
  emergency_contacts: z.array(emergencyContactSchema).min(1, '緊急連絡先を1件以上入力してください'),
  delivered_at: z.string().datetime().optional(),
  delivered_to: z.string().optional(),
});

export type CreateFirstVisitDocumentInput = z.infer<typeof createFirstVisitDocumentSchema>;

export const updateFirstVisitDocumentSchema = z.object({
  delivered_at: z.string().datetime().optional(),
  delivered_to: z.string().optional(),
  emergency_contacts: z
    .array(emergencyContactSchema)
    .min(1)
    .optional(),
});

export type UpdateFirstVisitDocumentInput = z.infer<typeof updateFirstVisitDocumentSchema>;

export type EmergencyContact = z.infer<typeof emergencyContactSchema>;
