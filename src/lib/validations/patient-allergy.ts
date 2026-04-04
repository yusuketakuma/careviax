import { z } from 'zod';

export const allergyEntrySchema = z.object({
  drug_name: z.string().min(1),
  therapeutic_category: z.string().optional(),
  substance: z.string().optional(),
  category: z.enum(['drug', 'food', 'other']),
  severity: z.enum(['mild', 'moderate', 'severe', 'unknown']),
  confirmed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  source: z.string().optional(),
});

export type AllergyEntry = z.infer<typeof allergyEntrySchema>;
