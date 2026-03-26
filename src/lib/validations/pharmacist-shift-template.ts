import { z } from 'zod';

export const upsertShiftTemplateSchema = z.object({
  user_id: z.string().min(1, '薬剤師IDは必須です'),
  site_id: z.string().min(1, '店舗IDは必須です'),
  weekday: z.number().int().min(0).max(6),
  available: z.boolean().default(true),
  available_from: z.string().regex(/^\d{2}:\d{2}$/, '時刻形式が不正です（HH:mm）').optional(),
  available_to: z.string().regex(/^\d{2}:\d{2}$/, '時刻形式が不正です（HH:mm）').optional(),
  note: z.string().optional(),
});
