import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';
import { createPatientSchema } from '@/lib/validations/patient';

export const REFERRAL_TYPES = ['physician', 'care_manager', 'facility', 'family'] as const;

export const referralTypeSchema = z.enum(REFERRAL_TYPES, {
  error: '依頼種別を選択してください',
});

const referralDateSchema = dateKeySchema('日付形式が不正です')
  .optional()
  .or(z.literal(''))
  .transform((value) => (value === '' ? undefined : value));

const referralPatientFieldsSchema = createPatientSchema.pick({
  name: true,
  name_kana: true,
  birth_date: true,
  gender: true,
  phone: true,
  medical_insurance_number: true,
  care_insurance_number: true,
  address: true,
});

export const createReferralSchema = referralPatientFieldsSchema
  .merge(
    z.object({
      referral_type: referralTypeSchema,
      referral_source: z.string().optional(),
      referral_date: referralDateSchema,
      referral_notes: z.string().optional(),
      doc_physician_order: z.boolean().default(false),
      doc_consent: z.boolean().default(false),
      doc_health_insurance: z.boolean().default(false),
      doc_care_insurance: z.boolean().default(false),
      duplicate_acknowledged: z.boolean().optional(),
    }),
  )
  .strict();

export type CreateReferralInput = z.infer<typeof createReferralSchema>;
export type ReferralType = z.infer<typeof referralTypeSchema>;
