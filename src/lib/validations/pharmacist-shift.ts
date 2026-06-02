import { z } from 'zod';

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function isValidDateKey(value: string) {
  if (!dateKeyPattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

const dateKeySchema = z
  .string()
  .trim()
  .regex(dateKeyPattern, '日付形式が不正です（YYYY-MM-DD）')
  .refine(isValidDateKey, '日付形式が不正です（YYYY-MM-DD）');

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

export const pharmacistShiftRowSchema = z.object({
  site_id: requiredTrimmedStringSchema('店舗IDは必須です'),
  user_id: requiredTrimmedStringSchema('薬剤師IDは必須です'),
  date: dateKeySchema,
  available: z.boolean().default(true),
  available_from: optionalTimeSchema,
  available_to: optionalTimeSchema,
  note: optionalNoteSchema,
});

export const createPharmacistShiftSchema = pharmacistShiftRowSchema;

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
