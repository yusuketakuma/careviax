import { z } from 'zod';
import {
  optionalNullableFaxNumberSchema,
  optionalNullablePhoneNumberSchema,
} from '@/lib/validations/phone';

export const updatePharmacySiteSchema = z.object({
  name: z.string().trim().min(1, '薬局名は必須です'),
  address: z.string().trim().min(1, '住所は必須です'),
  phone: optionalNullablePhoneNumberSchema,
  fax: optionalNullableFaxNumberSchema,
  is_health_support_pharmacy: z.boolean().default(false),
  is_regional_support: z.boolean().default(false),
  is_specialized_pharmacy: z.boolean().default(false),
  dispensing_fee_category: z.string().trim().optional().nullable(),
});
