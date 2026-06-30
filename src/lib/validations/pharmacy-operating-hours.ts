import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';
import { isValidOperatingWindow, timeStringToMinutes } from '@/lib/calendar/operating-day';

const optionalTrimmedIdSchema = z
  .string()
  .trim()
  .min(1, 'site_id は必須です')
  .max(100, 'site_id が長すぎます');

const optionalDateKeySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional();

const timeSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .refine(
    (value) => value === null || (value.length === 5 && timeStringToMinutes(value) !== null),
    {
      message: '時刻形式が不正です（HH:mm）',
    },
  )
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const noteSchema = z
  .string()
  .trim()
  .max(200, 'メモは200文字以内で入力してください')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const pharmacyOperatingHoursGetQuerySchema = z
  .object({
    site_id: optionalTrimmedIdSchema,
    date_from: optionalDateKeySchema,
    date_to: optionalDateKeySchema,
  })
  .superRefine((value, ctx) => {
    if ((value.date_from && !value.date_to) || (!value.date_from && value.date_to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date_from'],
        message: 'date_from と date_to は両方指定してください',
      });
      return;
    }
    if (value.date_from && value.date_to && value.date_to < value.date_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date_to'],
        message: 'date_to は date_from 以降を指定してください',
      });
    }
  });

export const pharmacyOperatingHoursRowSchema = z
  .object({
    weekday: z.number().int('曜日が不正です').min(0, '曜日が不正です').max(6, '曜日が不正です'),
    is_open: z.boolean(),
    open_time: timeSchema,
    close_time: timeSchema,
    note: noteSchema,
  })
  .superRefine((value, ctx) => {
    const hasOpen = value.open_time !== null;
    const hasClose = value.close_time !== null;

    if (!value.is_open && (hasOpen || hasClose)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['open_time'],
        message: '定休日には営業時間を指定できません',
      });
      return;
    }

    if (hasOpen !== hasClose) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasOpen ? ['close_time'] : ['open_time'],
        message: '開始時刻と終了時刻は両方指定してください',
      });
      return;
    }

    if (!isValidOperatingWindow(value.open_time, value.close_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['close_time'],
        message: '終了時刻は開始時刻より後を指定してください',
      });
    }
  });

export const pharmacyOperatingHoursPutSchema = z
  .object({
    site_id: optionalTrimmedIdSchema,
    expected_weekly_updated_at: z.string().datetime('営業時間設定の版情報が不正です').nullable(),
    rows: z.array(pharmacyOperatingHoursRowSchema).length(7, '営業時間は7曜日分を指定してください'),
  })
  .superRefine((value, ctx) => {
    const weekdays = value.rows.map((row) => row.weekday);
    const uniqueWeekdays = new Set(weekdays);
    if (uniqueWeekdays.size !== weekdays.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows'],
        message: '曜日が重複しています',
      });
      return;
    }
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      if (!uniqueWeekdays.has(weekday)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows'],
          message: '営業時間は0〜6の全曜日を1件ずつ指定してください',
        });
        return;
      }
    }
  });

export type PharmacyOperatingHoursPutInput = z.infer<typeof pharmacyOperatingHoursPutSchema>;
