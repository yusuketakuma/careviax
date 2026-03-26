import { z } from 'zod';

export const visitTypeValues = [
  'initial',
  'regular',
  'temporary',
  'revisit',
  'delivery_only',
  'emergency',
  'physician_co_visit',
] as const;

export type VisitType = (typeof visitTypeValues)[number];

export const scheduleStatusValues = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
  'completed',
  'cancelled',
  'postponed',
  'rescheduled',
  'no_show',
] as const;

export type ScheduleStatus = (typeof scheduleStatusValues)[number];

export const visitPriorityValues = [
  'normal',
  'urgent',
  'emergency',
] as const;

export type VisitPriority = (typeof visitPriorityValues)[number];

export const createVisitScheduleSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  site_id: z.string().optional(),
  visit_type: z.enum(visitTypeValues, { error: '訪問タイプを選択してください' }),
  priority: z.enum(visitPriorityValues).optional(),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  time_window_start: z.string().optional(),
  time_window_end: z.string().optional(),
  pharmacist_id: z.string().min(1, '薬剤師IDは必須です'),
  recurrence_rule: z.string().optional(),
  notes: z.string().optional(),
});

export const updateVisitScheduleSchema = createVisitScheduleSchema
  .partial()
  .extend({
    schedule_status: z.enum(scheduleStatusValues).optional(),
    route_order: z.number().int().nonnegative().optional(),
  });

export const generateVisitSchedulesSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  visit_type: z.enum(visitTypeValues),
  pharmacist_id: z.string().min(1, '薬剤師IDは必須です'),
  recurrence_rule: z.string().min(1, 'RRULEは必須です'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  time_window_start: z.string().optional(),
  time_window_end: z.string().optional(),
});

export type CreateVisitScheduleInput = z.infer<typeof createVisitScheduleSchema>;
export type UpdateVisitScheduleInput = z.infer<typeof updateVisitScheduleSchema>;
export type GenerateVisitSchedulesInput = z.infer<typeof generateVisitSchedulesSchema>;
