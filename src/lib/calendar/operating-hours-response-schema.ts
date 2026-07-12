import { z } from 'zod';

const NON_EMPTY_TEXT = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
const DATE_KEY = z.string().date();
const TIMESTAMP = z.string().datetime({ offset: true });
const TIME = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm time');

const weeklyRowSchema = z
  .object({
    id: NON_EMPTY_TEXT(200).nullable(),
    site_id: NON_EMPTY_TEXT(200),
    weekday: z.number().finite().int().min(0).max(6),
    is_open: z.boolean(),
    open_time: TIME.nullable(),
    close_time: TIME.nullable(),
    note: z.string().max(200).nullable(),
    configured: z.boolean(),
    source: z.enum(['stored', 'default']),
  })
  .strip();

const holidayRowSchema = z
  .object({
    id: NON_EMPTY_TEXT(200).optional(),
    date: DATE_KEY,
    site_id: NON_EMPTY_TEXT(200).nullable(),
    name: NON_EMPTY_TEXT(500).optional(),
    holiday_type: NON_EMPTY_TEXT(200).optional(),
    is_closed: z.boolean(),
    open_time: TIME.nullable(),
    close_time: TIME.nullable(),
  })
  .strip();

const resolvedDaySchema = z
  .object({
    date: DATE_KEY,
    open: z.boolean(),
    source: z.enum(['holiday', 'weekly', 'default']),
    reason: z.enum(['holiday', 'regular_closed']).optional(),
    from: TIME.nullable(),
    to: TIME.nullable(),
  })
  .strip();

const operatingHoursDataFields = {
  site_id: NON_EMPTY_TEXT(200),
  weekly: z.array(weeklyRowSchema).length(7),
  weekly_updated_at: TIMESTAMP.nullable(),
};

const putDataSchema = z.object(operatingHoursDataFields).strict();
const getDataSchema = z
  .object({
    ...operatingHoursDataFields,
    holidays: z.array(holidayRowSchema).optional(),
    resolved_days: z.array(resolvedDaySchema).max(366).optional(),
  })
  .strict();

type OperatingHoursData = z.infer<typeof getDataSchema>;

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function addOperatingHoursInvariants(data: OperatingHoursData, context: z.RefinementCtx) {
  const weekdays = new Set<number>();
  for (const [index, row] of data.weekly.entries()) {
    if (weekdays.has(row.weekday)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index, 'weekday'],
        message: 'Duplicate operating-hours weekday',
      });
    }
    weekdays.add(row.weekday);

    if (row.site_id !== data.site_id) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index, 'site_id'],
        message: 'Weekly row site must match the response site',
      });
    }
    if (row.source === 'default' && (row.configured || row.id !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index],
        message: 'Default weekly rows must not carry stored identity',
      });
    }
    if (row.source === 'stored' && (!row.configured || row.id === null)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index],
        message: 'Stored weekly rows must carry stored identity',
      });
    }

    const hasOpen = row.open_time !== null;
    const hasClose = row.close_time !== null;
    if (!row.is_open && (hasOpen || hasClose)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index],
        message: 'Closed weekly rows must not carry operating times',
      });
    }
    if (hasOpen !== hasClose) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index],
        message: 'Weekly operating times must be provided as a pair',
      });
    }
    if (hasOpen && hasClose && timeToMinutes(row.close_time!) <= timeToMinutes(row.open_time!)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'weekly', index, 'close_time'],
        message: 'Weekly close time must be after open time',
      });
    }
  }

  if (weekdays.size !== 7 || [...weekdays].some((weekday) => !weekdays.has(weekday))) {
    context.addIssue({
      code: 'custom',
      path: ['data', 'weekly'],
      message: 'Weekly operating hours must cover weekdays 0 through 6 exactly once',
    });
  }

  if (data.resolved_days) {
    const dates = new Set<string>();
    for (const [index, day] of data.resolved_days.entries()) {
      if (dates.has(day.date)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'resolved_days', index, 'date'],
          message: 'Duplicate resolved operating-day date',
        });
      }
      dates.add(day.date);

      const hasFrom = day.from !== null;
      const hasTo = day.to !== null;
      if (day.open) {
        if (day.reason !== undefined || hasFrom !== hasTo) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'resolved_days', index],
            message: 'Open resolved days must have paired times and no closed reason',
          });
        }
        if (hasFrom && hasTo && timeToMinutes(day.to!) <= timeToMinutes(day.from!)) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'resolved_days', index, 'to'],
            message: 'Resolved close time must be after from time',
          });
        }
      } else if (day.reason === undefined || hasFrom || hasTo) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'resolved_days', index],
          message: 'Closed resolved days must carry a reason and no times',
        });
      }
    }
  }
}

export const pharmacyOperatingHoursGetResponseSchema = z
  .object({
    data: getDataSchema,
  })
  .strict()
  .superRefine(({ data }, context) => addOperatingHoursInvariants(data, context));

export const pharmacyOperatingHoursPutResponseSchema = z
  .object({
    data: putDataSchema,
  })
  .strict()
  .superRefine(({ data }, context) => addOperatingHoursInvariants(data, context));

export type OperatingHoursWeeklyRow = z.infer<typeof weeklyRowSchema>;
export type OperatingHoursResolvedDay = z.infer<typeof resolvedDaySchema>;
export type PharmacyOperatingHoursGetResponse = z.infer<
  typeof pharmacyOperatingHoursGetResponseSchema
>;
export type PharmacyOperatingHoursPutResponse = z.infer<
  typeof pharmacyOperatingHoursPutResponseSchema
>;
