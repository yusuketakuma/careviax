import { z } from 'zod';

export const createBusinessHolidaySchema = z.object({
  site_id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  name: z.string().min(1, '休日名は必須です'),
  holiday_type: z.enum(['public_holiday', 'site_closure', 'org_event']),
  is_closed: z.boolean().default(true),
});

export const updateBusinessHolidaySchema = createBusinessHolidaySchema.extend({
  id: z.string().min(1, '休日IDは必須です').optional(),
});

export type CreateBusinessHolidayInput = z.infer<typeof createBusinessHolidaySchema>;
export type UpdateBusinessHolidayInput = z.infer<typeof updateBusinessHolidaySchema>;
