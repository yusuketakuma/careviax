import { z } from 'zod';
import { apiDataSchema } from '@/lib/api/response-schemas';
import { isValidDateKey } from '@/lib/validations/date-key';

const dateKeySchema = z.string().refine(isValidDateKey, { message: 'Expected a valid date key' });

const calendarBillingPreviewSchema = z
  .object({
    alerts: z
      .array(
        z
          .object({
            severity: z.enum(['error', 'warning', 'info']),
          })
          .strip(),
      )
      .max(32),
    cadence: z
      .object({
        next_billable_date: dateKeySchema.nullable(),
      })
      .strip(),
  })
  .strip();

export function buildCalendarBillingPreviewResponseSchema(expectedKeys: readonly string[]) {
  const expectedKeySet = new Set(expectedKeys);
  return apiDataSchema(z.record(z.string(), calendarBillingPreviewSchema)).superRefine(
    ({ data }, context) => {
      const actualKeys = Object.keys(data);
      if (
        actualKeys.length !== expectedKeySet.size ||
        actualKeys.some((key) => !expectedKeySet.has(key))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Billing preview keys must exactly match the requested schedules',
        });
      }
    },
  );
}

export type CalendarBillingPreview = z.infer<typeof calendarBillingPreviewSchema>;
