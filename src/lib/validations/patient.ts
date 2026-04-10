import { z } from 'zod';
import { allergyEntrySchema } from './patient-allergy';

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
  external_professional_id: z.string().optional(),
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

export const intakeRequesterSchema = z.object({
  organization_name: z.string().optional(),
  profession: z.string().optional(),
  contact_name: z.string().optional(),
  contact_name_kana: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
  pharmacy_decision_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  preferred_contact_method: z.string().optional(),
  preferred_contact_method_other: z.string().optional(),
});

export const intakeCareManagerSchema = z.object({
  name: z.string().optional(),
  name_kana: z.string().optional(),
  organization_name: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
});

export const intakeVisitingNurseSchema = z.object({
  name: z.string().optional(),
  name_kana: z.string().optional(),
  organization_name: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
});

export const patientIntakeSchema = z
  .object({
    age: z.number().int().min(0).max(150).optional(),
    primary_disease: z.string().optional(),
    contact_phone: z.string().optional(),
    contact_mobile: z.string().optional(),
    primary_contact_preference: z.string().optional(),
    visit_before_contact_required: z.boolean().optional(),
    first_visit_preferred_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
      .optional(),
    first_visit_time_slot: z.enum(['morning', 'afternoon', 'specific']).optional(),
    first_visit_time_note: z.string().optional(),
    care_level: z.string().optional(),
    adl_level: z.string().optional(),
    dementia_level: z.string().optional(),
    medication_support_methods: z.array(z.string()).optional(),
    medication_support_other: z.string().optional(),
    parking_available: z.boolean().optional(),
    mcs_linked: z.boolean().optional(),
    money_management: z.string().optional(),
    family_key_person: z.string().optional(),
    ent_prescription: z.boolean().optional(),
    ent_period_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
      .optional(),
    ent_period_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
      .optional(),
    narcotics_base: z.boolean().optional(),
    narcotics_rescue: z.boolean().optional(),
    allergy_history: z.string().optional(),
    infection_isolation: z.string().optional(),
    swallowing_route: z.string().optional(),
    residual_medication_status: z.string().optional(),
    other_clinical_notes: z.string().optional(),
    special_medical_procedures: z.array(z.string()).optional(),
    special_medical_notes: z.string().optional(),
    intake_note: z.string().optional(),
    care_manager: intakeCareManagerSchema.optional(),
    visiting_nurse: intakeVisitingNurseSchema.optional(),
    postal_code: z.string().optional(),
    housing_type: z.string().optional(),
    facility_name: z.string().optional(),
    emergency_contact: z
      .object({
        name: z.string().optional(),
        relation: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional(),
    initial_transition_management_expected: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.ent_period_from != null && data.ent_period_to != null) {
        return data.ent_period_from <= data.ent_period_to;
      }
      return true;
    },
    {
      message: '在宅経管栄養期間の開始日は終了日以前である必要があります',
      path: ['ent_period_from'],
    },
  )
  .refine(
    (data) => {
      if (data.ent_prescription === true) {
        return data.ent_period_from != null || data.ent_period_to != null;
      }
      return true;
    },
    {
      message: '在宅経管栄養を有効にする場合は期間を指定してください',
      path: ['ent_prescription'],
    },
  );

export const createPatientSchema = z.object({
  name: z.string().min(1, '氏名は必須です'),
  name_kana: z.string().min(1, 'フリガナは必須です'),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  gender: z.enum(['male', 'female', 'other'], { error: '性別を選択してください' }),
  phone: z.string().optional(),
  medical_insurance_number: z.string().optional(),
  care_insurance_number: z.string().optional(),
  billing_support_flag: z.boolean().optional(),
  address: z.string().optional(),
  building_id: z.string().optional(),
  facility_id: z.string().optional(),
  facility_unit_id: z.string().optional(),
  unit_name: z.string().optional(),
  allergy_info: z.array(allergyEntrySchema).optional(),
  notes: z.string().optional(),
  conditions: z.array(patientConditionSchema).optional(),
  contacts: z.array(patientContactSchema).optional(),
  requester: intakeRequesterSchema.optional(),
  intake: patientIntakeSchema.optional(),
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
