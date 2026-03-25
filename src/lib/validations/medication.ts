import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// MedicationProfile
// ────────────────────────────────────────────────────────────────────────────

export const createMedicationProfileSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  drug_master_id: z.string().optional(),
  drug_name: z.string().min(1, '薬剤名は必須です'),
  dose: z.string().optional(),
  frequency: z.string().optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  prescriber: z.string().optional(),
  is_current: z.boolean().optional().default(true),
  source: z.enum(['qr_scan', 'manual', 'prescription']).optional(),
});

export type CreateMedicationProfileInput = z.infer<typeof createMedicationProfileSchema>;

// ────────────────────────────────────────────────────────────────────────────
// MedicationIssue
// ────────────────────────────────────────────────────────────────────────────

export const createMedicationIssueSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  title: z.string().min(1, 'タイトルは必須です'),
  description: z.string().min(1, '説明は必須です'),
  status: z
    .enum(['open', 'in_progress', 'resolved', 'dismissed'])
    .optional()
    .default('open'),
  priority: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .default('medium'),
  category: z
    .enum(['adherence', 'side_effect', 'interaction', 'duplicate', 'other'])
    .optional(),
});

export type CreateMedicationIssueInput = z.infer<typeof createMedicationIssueSchema>;

export const updateMedicationIssueSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  category: z
    .enum(['adherence', 'side_effect', 'interaction', 'duplicate', 'other'])
    .optional(),
});

export type UpdateMedicationIssueInput = z.infer<typeof updateMedicationIssueSchema>;
