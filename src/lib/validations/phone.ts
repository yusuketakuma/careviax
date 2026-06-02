import { z } from 'zod';

const contactNumberCharacterPattern = /^\+?[\d\s()-]+$/;

function trimStringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimOptionalString(value: string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimOptionalNullableString(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function contactNumberSchema(message: string) {
  return z
    .string()
    .trim()
    .refine((value) => contactNumberCharacterPattern.test(value), {
      message,
    })
    .refine(
      (value) => {
        if (!contactNumberCharacterPattern.test(value)) return true;
        const digits = value.replace(/\D/g, '');
        if (value.startsWith('+')) {
          return digits.length >= 8 && digits.length <= 15;
        }
        return digits.length >= 10 && digits.length <= 11;
      },
      { message },
    );
}

export const phoneNumberSchema = contactNumberSchema('電話番号形式が不正です');

export const faxNumberSchema = contactNumberSchema('FAX番号形式が不正です');

export const nullablePhoneNumberSchema = z.preprocess(
  trimStringOrNull,
  phoneNumberSchema.nullable(),
);

const optionalContactNumberInputSchema = z.union([z.string(), z.null()]).optional();

export const optionalPhoneNumberSchema = optionalContactNumberInputSchema
  .transform(trimOptionalString)
  .pipe(phoneNumberSchema.optional());

export const optionalNullablePhoneNumberSchema = optionalContactNumberInputSchema
  .transform(trimOptionalNullableString)
  .pipe(phoneNumberSchema.nullable().optional());

export const nullableFaxNumberSchema = z.preprocess(trimStringOrNull, faxNumberSchema.nullable());

export const optionalFaxNumberSchema = optionalContactNumberInputSchema
  .transform(trimOptionalString)
  .pipe(faxNumberSchema.optional());

export const optionalNullableFaxNumberSchema = optionalContactNumberInputSchema
  .transform(trimOptionalNullableString)
  .pipe(faxNumberSchema.nullable().optional());
