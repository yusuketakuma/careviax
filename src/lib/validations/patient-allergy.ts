import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';

const optionalDateStringSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional();

export const allergyEntrySchema = z.object({
  drug_name: z.string().min(1),
  drug_code: z.string().trim().min(1).optional(),
  therapeutic_category: z.string().optional(),
  substance: z.string().optional(),
  category: z.enum(['drug', 'food', 'other']),
  severity: z.enum(['mild', 'moderate', 'severe', 'unknown']),
  confirmed_at: optionalDateStringSchema,
  source: z.string().optional(),
});

export type AllergyEntry = z.infer<typeof allergyEntrySchema>;
