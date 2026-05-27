import { z } from 'zod';

const timeWindowSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻形式が不正です（HH:mm）');

type TimeWindowInput = {
  time_window_start?: string;
  time_window_end?: string;
};

function timeWindowToMinutes(value: string | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

function validateTimeWindowOrder(data: TimeWindowInput, ctx: z.RefinementCtx) {
  const start = timeWindowToMinutes(data.time_window_start);
  const end = timeWindowToMinutes(data.time_window_end);
  if (start != null && end != null && end <= start) {
    ctx.addIssue({
      code: 'custom',
      path: ['time_window_end'],
      message: '終了時刻は開始時刻より後にしてください',
    });
  }
}

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

export const visitPriorityValues = ['normal', 'urgent', 'emergency'] as const;

export type VisitPriority = (typeof visitPriorityValues)[number];

const createVisitScheduleBaseSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  site_id: z.string().optional(),
  visit_type: z.enum(visitTypeValues, { error: '訪問タイプを選択してください' }),
  priority: z.enum(visitPriorityValues).optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  time_window_start: timeWindowSchema.optional(),
  time_window_end: timeWindowSchema.optional(),
  pharmacist_id: z.string().min(1, '薬剤師IDは必須です'),
  recurrence_rule: z.string().optional(),
  notes: z.string().optional(),
});

export const createVisitScheduleSchema =
  createVisitScheduleBaseSchema.superRefine(validateTimeWindowOrder);

export const updateVisitScheduleSchema = createVisitScheduleBaseSchema
  .partial()
  .extend({
    schedule_status: z.enum(scheduleStatusValues).optional(),
    route_order: z.number().int().nonnegative().optional(),
  })
  .superRefine(validateTimeWindowOrder);

export const generateVisitSchedulesSchema = z
  .object({
    case_id: z.string().min(1, 'ケースIDは必須です'),
    visit_type: z.enum(visitTypeValues),
    pharmacist_id: z.string().min(1, '薬剤師IDは必須です'),
    recurrence_rule: z.string().min(1, 'RRULEは必須です'),
    insurance_type: z.enum(['medical', 'care']).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
    time_window_start: timeWindowSchema.optional(),
    time_window_end: timeWindowSchema.optional(),
  })
  .superRefine(validateTimeWindowOrder);

export type CreateVisitScheduleInput = z.infer<typeof createVisitScheduleSchema>;
export type UpdateVisitScheduleInput = z.infer<typeof updateVisitScheduleSchema>;
export type GenerateVisitSchedulesInput = z.infer<typeof generateVisitSchedulesSchema>;
