import { z } from 'zod';

export const createInterventionSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  issue_id: z.string().optional(),
  type: z.enum([
    'dose_adjustment',
    'drug_change',
    'side_effect_management',
    'adherence_support',
    'prescriber_consultation',
    'patient_education',
    'other',
  ]),
  description: z.string().min(1, '介入内容は必須です'),
  outcome: z.string().optional(),
  performed_at: z.string().datetime({ message: '日時形式が不正です' }),
});

export type CreateInterventionInput = z.infer<typeof createInterventionSchema>;

export const updateInterventionSchema = z.object({
  outcome: z.string().optional(),
  description: z.string().min(1).optional(),
  performed_at: z.string().datetime().optional(),
});

export type UpdateInterventionInput = z.infer<typeof updateInterventionSchema>;
