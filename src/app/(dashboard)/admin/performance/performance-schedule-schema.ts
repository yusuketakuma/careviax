import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1).max(500);

export const performanceScheduleSchema = z
  .object({
    id: nonEmptyText,
    scheduled_date: z.string().datetime({ offset: true }),
    priority: z.enum(['normal', 'urgent', 'emergency']),
    assignment_mode: z.enum(['primary', 'fallback']),
    confirmed_at: z.string().datetime({ offset: true }).nullable(),
    case_: z.object({ patient: z.object({ name: nonEmptyText }).strip() }).strip(),
    override_request: z
      .object({
        status: z.enum(['pending', 'completed', 'cancelled']),
        reason: nonEmptyText,
      })
      .strip()
      .nullable(),
  })
  .strip();

export type PerformanceSchedule = z.infer<typeof performanceScheduleSchema>;
