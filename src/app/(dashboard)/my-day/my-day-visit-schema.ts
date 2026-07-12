import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1).max(500);

export const myDayVisitSchema = z
  .object({
    id: nonEmptyText,
    visit_type: z.enum([
      'initial',
      'regular',
      'temporary',
      'revisit',
      'delivery_only',
      'emergency',
      'physician_co_visit',
    ]),
    schedule_status: z.enum([
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
    ]),
    time_window_start: z.string().datetime({ offset: true }).nullable(),
    time_window_end: z.string().datetime({ offset: true }).nullable(),
    preparation: z
      .object({
        prepared_at: z.string().datetime({ offset: true }).nullable(),
      })
      .strip()
      .nullable(),
    case_: z
      .object({
        patient: z.object({ name: nonEmptyText }).strip(),
      })
      .strip(),
  })
  .strip()
  .superRefine((visit, context) => {
    if (
      visit.time_window_start &&
      visit.time_window_end &&
      visit.time_window_start > visit.time_window_end
    ) {
      context.addIssue({
        code: 'custom',
        path: ['time_window_end'],
        message: 'Visit time window must be ordered',
      });
    }
  });

export type MyDayVisit = z.infer<typeof myDayVisitSchema>;
