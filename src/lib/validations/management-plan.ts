import { z } from 'zod';

const contentSchema = z.record(z.string(), z.unknown()).default({});

export const createManagementPlanSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  title: z.string().min(1, 'タイトルは必須です').default('訪問薬剤管理指導計画書'),
  summary: z.string().optional(),
  content: contentSchema,
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from の形式が不正です（YYYY-MM-DD）')
    .optional(),
  next_review_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'next_review_date の形式が不正です（YYYY-MM-DD）')
    .optional(),
  source_plan_id: z.string().optional(),
});

export const updateManagementPlanSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    title: z.string().min(1, 'タイトルは必須です').optional(),
    summary: z.string().optional(),
    content: contentSchema.optional(),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from の形式が不正です（YYYY-MM-DD）')
      .optional(),
    next_review_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'next_review_date の形式が不正です（YYYY-MM-DD）')
      .optional(),
  }),
  z.object({
    action: z.literal('approve'),
  }),
  z.object({
    action: z.literal('archive'),
  }),
]);
