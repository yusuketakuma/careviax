import { z } from 'zod';

export const patientConditionSchema = z.object({
  id: z.string().optional(),
  condition_type: z.enum(['disease', 'problem']),
  name: z.string().min(1, '病名・課題名は必須です'),
  is_primary: z.boolean().default(false),
  is_active: z.boolean().default(true),
  noted_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  notes: z.string().optional(),
});

export const patientContactSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '氏名は必須です'),
  relation: z.enum([
    'self',
    'spouse',
    'child',
    'parent',
    'sibling',
    'care_manager',
    'physician',
    'nurse',
    'facility_staff',
    'other',
  ]),
  phone: z.string().optional(),
  email: z.string().email('メールアドレス形式が不正です').optional().or(z.literal('')),
  fax: z.string().optional(),
  organization_name: z.string().optional(),
  department: z.string().optional(),
  address: z.string().optional(),
  is_primary: z.boolean().default(false),
  is_emergency_contact: z.boolean().default(false),
  notes: z.string().optional(),
});

export const careTeamLinkSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['physician', 'nurse', 'care_manager', 'pharmacist', 'other']),
  name: z.string().min(1, '氏名は必須です'),
  organization_name: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('メールアドレス形式が不正です').optional().or(z.literal('')),
  fax: z.string().optional(),
  address: z.string().optional(),
  is_primary: z.boolean().default(false),
  notes: z.string().optional(),
});

export const createPatientSchema = z.object({
  name: z.string().min(1, '氏名は必須です'),
  name_kana: z.string().min(1, 'フリガナは必須です'),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  gender: z.enum(['male', 'female', 'other'], { error: '性別を選択してください' }),
  phone: z.string().optional(),
  medical_insurance_number: z.string().optional(),
  care_insurance_number: z.string().optional(),
  address: z.string().optional(),
  building_id: z.string().optional(),
  unit_name: z.string().optional(),
  allergy_info: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  conditions: z.array(patientConditionSchema).optional(),
  contacts: z.array(patientContactSchema).optional(),
});

export const updatePatientSchema = createPatientSchema.partial();

export const updatePatientConditionsSchema = z.object({
  conditions: z.array(patientConditionSchema),
});

export const updatePatientContactsSchema = z.object({
  contacts: z.array(patientContactSchema),
});

export const updatePatientCareTeamSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  links: z.array(careTeamLinkSchema),
});

export type CreatePatientInput = z.input<typeof createPatientSchema>;
export type UpdatePatientInput = z.input<typeof updatePatientSchema>;
