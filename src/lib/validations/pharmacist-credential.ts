import { z } from 'zod';
import { normalizeNullablePlainNumber } from '@/lib/validations/plain-number';

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

function trimStringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const optionalNullableTrimmedStringSchema = z
  .preprocess(trimStringOrNull, z.string().min(1).nullable())
  .optional();

const optionalNullableDateStringSchema = z
  .preprocess(trimStringOrNull, z.string().date().nullable())
  .optional();

const optionalNullableBoundedNumberSchema = (max: number) =>
  z
    .preprocess(normalizeNullablePlainNumber, z.number().finite().min(0).max(max).nullable())
    .optional();

function validateCredentialDateOrder(
  data: { issued_date?: string | null; expiry_date?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.issued_date && data.expiry_date && data.issued_date > data.expiry_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiry_date'],
      message: '有効期限は発行日以降の日付を指定してください',
    });
  }
}

export const createPharmacistCredentialSchema = z
  .object({
    user_id: requiredTrimmedStringSchema('対象スタッフは必須です'),
    certification_type: requiredTrimmedStringSchema('認定種別は必須です'),
    certification_number: optionalNullableTrimmedStringSchema,
    issued_date: optionalNullableDateStringSchema,
    expiry_date: optionalNullableDateStringSchema,
    tenure_years: optionalNullableBoundedNumberSchema(80),
    weekly_work_hours: optionalNullableBoundedNumberSchema(168),
  })
  .superRefine(validateCredentialDateOrder);

export const updatePharmacistCredentialSchema = z
  .object({
    user_id: requiredTrimmedStringSchema('対象スタッフは必須です').optional(),
    certification_type: requiredTrimmedStringSchema('認定種別は必須です').optional(),
    certification_number: optionalNullableTrimmedStringSchema,
    issued_date: optionalNullableDateStringSchema,
    expiry_date: optionalNullableDateStringSchema,
    tenure_years: optionalNullableBoundedNumberSchema(80),
    weekly_work_hours: optionalNullableBoundedNumberSchema(168),
  })
  .superRefine(validateCredentialDateOrder);

export type CreatePharmacistCredentialInput = z.infer<typeof createPharmacistCredentialSchema>;
export type UpdatePharmacistCredentialInput = z.infer<typeof updatePharmacistCredentialSchema>;
