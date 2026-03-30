import { z } from 'zod';

export const createPackagingMethodSchema = z.object({
  name: z.string().min(1, '名称は必須です').max(100, '名称は100文字以内です'),
  description: z.string().max(500, '説明は500文字以内です').optional(),
  icon_key: z.string().max(50, 'アイコンキーは50文字以内です').optional(),
  sort_order: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

export const updatePackagingMethodSchema = createPackagingMethodSchema.partial();

export const packagingPreferencesSchema = z.object({
  default_method_id: z.string().optional().nullable(),
  box_config: z
    .object({
      morning: z.boolean().optional(),
      noon: z.boolean().optional(),
      evening: z.boolean().optional(),
      bedtime: z.boolean().optional(),
    })
    .optional(),
  special_instructions: z.string().max(500, '特記事項は500文字以内です').optional().nullable(),
  cognitive_note: z.string().max(500, '認知機能メモは500文字以内です').optional().nullable(),
  staple_required: z.boolean().optional(),
  label_font_size: z.enum(['small', 'medium', 'large']).optional().nullable(),
});

export type CreatePackagingMethodInput = z.input<typeof createPackagingMethodSchema>;
export type UpdatePackagingMethodInput = z.input<typeof updatePackagingMethodSchema>;
export type PackagingPreferencesInput = z.input<typeof packagingPreferencesSchema>;
