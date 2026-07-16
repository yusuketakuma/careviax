import { z } from 'zod';

export const SELF_REPORT_REPORTER_NAME_MAX_LENGTH = 100;

const unsafeReporterNameCharacterPattern = /[\p{Cc}\p{Cf}]/u;

export const selfReportReporterNameSchema = z
  .string()
  .transform((value) => value.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .min(1, '報告者氏名は必須です')
      .max(
        SELF_REPORT_REPORTER_NAME_MAX_LENGTH,
        `報告者氏名は${SELF_REPORT_REPORTER_NAME_MAX_LENGTH}文字以内で入力してください`,
      )
      .refine((value) => !unsafeReporterNameCharacterPattern.test(value), {
        message: '報告者氏名に使用できない文字が含まれています',
      }),
  );

export const selfReportStatusSchema = z.enum([
  'submitted',
  'triaged',
  'converted_to_task',
  'resolved',
  'dismissed',
]);
