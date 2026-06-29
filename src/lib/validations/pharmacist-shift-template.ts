import { z } from 'zod';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);
const optionalTrimmedStringSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();
const optionalTimeSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .refine((value) => value === undefined || timePattern.test(value), {
    message: '時刻形式が不正です（HH:mm）',
  })
  .optional();

function timeToMinutes(value: string | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

export const upsertShiftTemplateSchema = z
  .object({
    user_id: requiredTrimmedStringSchema('薬剤師IDは必須です'),
    site_id: requiredTrimmedStringSchema('店舗IDは必須です'),
    weekday: z.number().int().min(0).max(6),
    available: z.boolean().default(true),
    available_from: optionalTimeSchema,
    available_to: optionalTimeSchema,
    note: optionalTrimmedStringSchema,
  })
  .superRefine((data, ctx) => {
    const from = timeToMinutes(data.available_from);
    const to = timeToMinutes(data.available_to);
    if (from != null && to != null && to < from) {
      ctx.addIssue({
        code: 'custom',
        path: ['available_to'],
        message: '終了時刻は開始時刻以降にしてください',
      });
    }
  });
