import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';

function blankStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
}

const optionalDateStringSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional();
const optionalTrimmedStringSchema = z.preprocess(
  blankStringToUndefined,
  z.string().trim().optional(),
);

// ────────────────────────────────────────────────────────────────────────────
// MedicationProfile
// ────────────────────────────────────────────────────────────────────────────

export const createMedicationProfileSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  drug_master_id: optionalTrimmedStringSchema,
  drug_name: z.string().min(1, '薬剤名は必須です'),
  dose: z.string().optional(),
  frequency: z.string().optional(),
  start_date: optionalDateStringSchema,
  end_date: optionalDateStringSchema,
  prescriber: z.string().optional(),
  is_current: z.boolean().optional().default(true),
  source: z.enum(['qr_scan', 'manual', 'prescription']).optional(),
});

export type CreateMedicationProfileInput = z.infer<typeof createMedicationProfileSchema>;

// ────────────────────────────────────────────────────────────────────────────
// MedicationIssue
// ────────────────────────────────────────────────────────────────────────────

export const medicationIssueStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'dismissed']);

export const createMedicationIssueSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  title: z.string().min(1, 'タイトルは必須です'),
  description: z.string().min(1, '説明は必須です'),
  status: medicationIssueStatusSchema.optional().default('open'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional().default('medium'),
  category: z.enum(['adherence', 'side_effect', 'interaction', 'duplicate', 'other']).optional(),
});

export type CreateMedicationIssueInput = z.infer<typeof createMedicationIssueSchema>;

export const updateMedicationIssueSchema = z.object({
  status: medicationIssueStatusSchema.optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  category: z.enum(['adherence', 'side_effect', 'interaction', 'duplicate', 'other']).optional(),
  promote_to_medication_profile: z.boolean().optional(),
});

export type UpdateMedicationIssueInput = z.infer<typeof updateMedicationIssueSchema>;

// ────────────────────────────────────────────────────────────────────────────
// MedicationCycle
// ────────────────────────────────────────────────────────────────────────────

export const createMedicationCycleSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  patient_id: z.string().min(1, '患者IDは必須です'),
});

export type CreateMedicationCycleInput = z.infer<typeof createMedicationCycleSchema>;

// ────────────────────────────────────────────────────────────────────────────
// WorkflowException
// ────────────────────────────────────────────────────────────────────────────

export const resolveWorkflowExceptionSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
});

export type ResolveWorkflowExceptionInput = z.infer<typeof resolveWorkflowExceptionSchema>;
