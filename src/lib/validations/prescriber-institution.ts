import { z } from 'zod';
import {
  optionalFaxNumberSchema,
  optionalNullableFaxNumberSchema,
  optionalNullablePhoneNumberSchema,
  optionalPhoneNumberSchema,
} from '@/lib/validations/phone';

export const createPrescriberInstitutionSchema = z.object({
  name: z.string().trim().min(1, '医療機関名は必須です'),
  institution_code: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: optionalPhoneNumberSchema,
  fax: optionalFaxNumberSchema,
  notes: z.string().trim().optional(),
});

export const updatePrescriberInstitutionSchema = z.object({
  name: z.string().trim().min(1).optional(),
  institution_code: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  phone: optionalNullablePhoneNumberSchema,
  fax: optionalNullableFaxNumberSchema,
  notes: z.string().trim().nullable().optional(),
});
