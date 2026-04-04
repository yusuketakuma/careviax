import { z } from 'zod';

export const patientPackagingProfileSchema = z.object({
  default_packaging_method: z
    .enum([
      'none',
      'unit_dose',
      'morning_evening_unit_dose',
      'medication_box',
      'calendar_pack',
      'blister_pack',
      'crush_and_pack',
      'other',
    ])
    .nullable()
    .optional(),
  medication_box_color: z.string().max(40, 'BOX色は40文字以内です').optional(),
  notes: z.string().max(200, '配薬メモは200文字以内です').optional(),
  box_config: z.record(z.string(), z.string()).nullable().optional(),
  special_instructions: z.string().max(500, '特記指示は500文字以内です').nullable().optional(),
  cognitive_note: z.string().max(500, '認知機能メモは500文字以内です').nullable().optional(),
});
