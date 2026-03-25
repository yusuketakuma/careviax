import { z } from 'zod';

export const createPatientSchema = z.object({
  name: z.string().min(1, '氏名は必須です'),
  name_kana: z.string().min(1, 'フリガナは必須です'),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  gender: z.enum(['male', 'female', 'other'], {
    errorMap: () => ({ message: '性別を選択してください' }),
  }),
  phone: z.string().optional(),
  medical_insurance_number: z.string().optional(),
  care_insurance_number: z.string().optional(),
  address: z.string().optional(),
});

export const updatePatientSchema = createPatientSchema.partial();

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
