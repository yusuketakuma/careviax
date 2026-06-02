import { z } from 'zod';
import { MANAGEABLE_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { normalizeNullablePlainNumber } from '@/lib/validations/plain-number';
import { nullablePhoneNumberSchema } from '@/lib/validations/phone';

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

function trimStringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const nullableTrimmedStringSchema = z.preprocess(trimStringOrNull, z.string().min(1).nullable());

const nullableDateStringSchema = z.preprocess(trimStringOrNull, z.string().date().nullable());

const nullableBoundedNumberSchema = (max: number) =>
  z.preprocess(normalizeNullablePlainNumber, z.number().finite().min(0).max(max).nullable());

const manageableRoleSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.enum(MANAGEABLE_MEMBER_ROLES),
);

export const pharmacistImportRowSchema = z
  .object({
    name: requiredTrimmedStringSchema('氏名は必須です'),
    name_kana: requiredTrimmedStringSchema('フリガナは必須です'),
    email: z
      .string()
      .trim()
      .email('メールアドレス形式が不正です')
      .transform((value) => value.toLowerCase()),
    phone: nullablePhoneNumberSchema,
    role: manageableRoleSchema,
    site_name: nullableTrimmedStringSchema,
    certification_type: nullableTrimmedStringSchema,
    certification_number: nullableTrimmedStringSchema,
    issued_date: nullableDateStringSchema,
    expiry_date: nullableDateStringSchema,
    tenure_years: nullableBoundedNumberSchema(80),
    weekly_work_hours: nullableBoundedNumberSchema(168),
  })
  .superRefine((row, ctx) => {
    const hasCredentialDetails =
      row.certification_number !== null ||
      row.issued_date !== null ||
      row.expiry_date !== null ||
      row.tenure_years !== null ||
      row.weekly_work_hours !== null;

    if (!row.certification_type && hasCredentialDetails) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['certification_type'],
        message: '認定情報を入力する場合は認定種別が必須です',
      });
    }

    if (row.issued_date && row.expiry_date && row.issued_date > row.expiry_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiry_date'],
        message: '有効期限は発行日以降の日付を指定してください',
      });
    }
  });

export type PharmacistImportRow = z.infer<typeof pharmacistImportRowSchema>;

export const pharmacistImportEnvelopeSchema = z.object({
  rows: z.array(z.unknown()).min(1, 'CSV 行がありません').max(300, '一度に 300 行までです'),
});

export const pharmacistImportSchema = z.object({
  rows: z
    .array(pharmacistImportRowSchema)
    .min(1, 'CSV 行がありません')
    .max(300, '一度に 300 行までです'),
});

export function normalizePharmacistImportLookupKey(value: string) {
  return value.trim().toLowerCase();
}
