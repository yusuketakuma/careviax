import { z } from 'zod';
import { dateKeySchema as createDateKeySchema } from '@/lib/validations/date-key';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

const dateKeySchema = createDateKeySchema('日付形式が不正です（YYYY-MM-DD）');

const optionalTimeSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || timePattern.test(value), {
    message: '時刻形式が不正です（HH:mm または HH:mm:ss）',
  })
  .optional();

const optionalNoteSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .optional();

function timeToSeconds(value: string) {
  const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number);
  return hours * 60 * 60 + minutes * 60 + seconds;
}

export const pharmacistShiftRowSchema = z
  .object({
    site_id: requiredTrimmedStringSchema('店舗IDは必須です'),
    user_id: requiredTrimmedStringSchema('薬剤師IDは必須です'),
    date: dateKeySchema,
    available: z.boolean().default(true),
    available_from: optionalTimeSchema,
    available_to: optionalTimeSchema,
    note: optionalNoteSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.available_from &&
      value.available_to &&
      timeToSeconds(value.available_from) > timeToSeconds(value.available_to)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['available_to'],
        message: '終了時刻は開始時刻以降を指定してください',
      });
    }
  });

export const createPharmacistShiftSchema = pharmacistShiftRowSchema;

const optionalTrimmedIdSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const pharmacistShiftQuerySchema = z
  .object({
    month: dateKeySchema.optional(),
    date_from: dateKeySchema.optional(),
    date_to: dateKeySchema.optional(),
    user_id: optionalTrimmedIdSchema,
    site_id: optionalTrimmedIdSchema,
  })
  .superRefine((value, ctx) => {
    if (value.month && (value.date_from || value.date_to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['month'],
        message: 'month と date_from/date_to は同時に指定できません',
      });
    }
    if (value.date_from && value.date_to && value.date_to < value.date_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date_to'],
        message: 'date_to は date_from 以降を指定してください',
      });
    }
  });

export const bulkPharmacistShiftSchema = z.object({
  rows: z
    .array(pharmacistShiftRowSchema)
    .min(1, '取込対象のシフトがありません')
    .max(500, 'CSV は 500 行までです'),
});

export const availablePharmacistShiftQuerySchema = z
  .object({
    date: dateKeySchema,
    time_from: optionalTimeSchema,
    time_to: optionalTimeSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.time_from &&
      value.time_to &&
      timeToSeconds(value.time_from) > timeToSeconds(value.time_to)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['time_to'],
        message: '終了時刻は開始時刻以降を指定してください',
      });
    }
  });

export function toShiftTimeValue(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`1970-01-01T${value}`);
}
