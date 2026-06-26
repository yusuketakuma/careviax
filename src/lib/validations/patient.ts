import { z } from 'zod';
import { allergyEntrySchema } from './patient-allergy';
import { optionalFaxNumberSchema, optionalPhoneNumberSchema } from '@/lib/validations/phone';
import { dateKeySchema } from '@/lib/validations/date-key';

const dateStringSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');

export const PATIENT_GENDERS = ['male', 'female', 'other'] as const;
export const patientGenderSchema = z.enum(PATIENT_GENDERS, { error: '性別を選択してください' });

export const patientConditionSchema = z.object({
  id: z.string().optional(),
  condition_type: z.enum(['disease', 'problem']),
  name: z.string().min(1, '病名・課題名は必須です'),
  is_primary: z.boolean().default(false),
  is_active: z.boolean().default(true),
  noted_at: dateStringSchema.optional(),
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
  phone: optionalPhoneNumberSchema,
  email: z.string().email('メールアドレス形式が不正です').optional().or(z.literal('')),
  fax: optionalFaxNumberSchema,
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
  phone: optionalPhoneNumberSchema,
  email: z.string().email('メールアドレス形式が不正です').optional().or(z.literal('')),
  fax: optionalFaxNumberSchema,
  address: z.string().optional(),
  is_primary: z.boolean().default(false),
  notes: z.string().optional(),
});

export const intakeRequesterSchema = z.object({
  organization_name: z.string().optional(),
  profession: z.string().optional(),
  contact_name: z.string().optional(),
  contact_name_kana: z.string().optional(),
  phone: optionalPhoneNumberSchema,
  fax: optionalFaxNumberSchema,
  pharmacy_decision_due_date: dateStringSchema.optional(),
  preferred_contact_method: z.string().optional(),
  preferred_contact_method_other: z.string().optional(),
});

export const intakeCareManagerSchema = z.object({
  name: z.string().optional(),
  name_kana: z.string().optional(),
  organization_name: z.string().optional(),
  phone: optionalPhoneNumberSchema,
  fax: optionalFaxNumberSchema,
});

export const intakeVisitingNurseSchema = z.object({
  name: z.string().optional(),
  name_kana: z.string().optional(),
  organization_name: z.string().optional(),
  phone: optionalPhoneNumberSchema,
  fax: optionalFaxNumberSchema,
});

export const homePharmacyAddOn2Schema = z.object({
  candidate: z
    .enum([
      'unknown',
      'not_applicable',
      'add_on_2_ro_candidate',
      'add_on_2_i_single_building_candidate',
      'add_on_2_i_severe_patient_candidate',
    ])
    .optional(),
  single_building_medical_patient_count: z
    .enum(['one', 'two_to_nine', 'ten_or_more', 'unknown'])
    .optional(),
  single_building_resident_count: z
    .enum(['one', 'two_to_nine', 'ten_or_more', 'unknown'])
    .optional(),
  home_care_billing_category: z
    .enum([
      'medical_home_visit',
      'emergency_home_visit',
      'emergency_joint_guidance',
      'care_home_management',
      'preventive_care_home_management',
      'unknown',
    ])
    .optional(),
  medical_home_management_type: z
    .enum(['home_medical_management', 'facility_medical_management', 'unknown'])
    .optional(),
  medical_home_management_section: z
    .enum(['one_i_1', 'one_ro_1', 'two_i', 'three_i', 'other', 'unknown'])
    .optional(),
  comprehensive_support_add_on: z.enum(['yes', 'no', 'unknown']).optional(),
  table_8_2_applicable: z.enum(['yes', 'no', 'unknown']).optional(),
  table_8_3_applicable: z.enum(['yes', 'no', 'unknown']).optional(),
  narcotic_use_categories: z.array(z.string()).optional(),
  aseptic_preparation_need: z.enum(['unnecessary', 'necessary', 'unknown']).optional(),
  pediatric_home_care: z.enum(['yes', 'no', 'unknown']).optional(),
  infant_add_on_candidate: z.enum(['yes', 'no', 'unknown']).optional(),
  medical_care_child: z.enum(['yes', 'no', 'unknown']).optional(),
  visiting_nurse_frequency: z
    .enum(['none', 'less_than_monthly', 'monthly', 'weekly', 'multiple_weekly', 'unknown'])
    .optional(),
  weekly_visiting_nurse: z.enum(['yes', 'no', 'unknown']).optional(),
  nursing_or_family_procedure: z.enum(['yes', 'no', 'unknown']).optional(),
  medical_material_supply: z.enum(['yes', 'no', 'unknown']).optional(),
  advanced_medical_device: z.enum(['yes', 'no', 'unknown']).optional(),
});

export const patientIntakeSchema = z
  .object({
    age: z.number().int().min(0).max(150).optional(),
    primary_disease: z.string().optional(),
    contact_phone: optionalPhoneNumberSchema,
    contact_mobile: optionalPhoneNumberSchema,
    primary_contact_preference: z.string().optional(),
    visit_before_contact_required: z.boolean().optional(),
    first_visit_preferred_date: dateStringSchema.optional(),
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
    ent_period_from: dateStringSchema.optional(),
    ent_period_to: dateStringSchema.optional(),
    narcotics_base: z.boolean().optional(),
    narcotics_rescue: z.boolean().optional(),
    allergy_history: z.string().optional(),
    infection_isolation: z.string().optional(),
    swallowing_route: z.string().optional(),
    residual_medication_status: z.string().optional(),
    other_clinical_notes: z.string().optional(),
    special_medical_procedures: z.array(z.string()).optional(),
    special_medical_notes: z.string().optional(),
    home_care_status: z
      .enum(['preparing', 'active', 'hospitalized', 'paused', 'ended', 'deceased', 'unknown'])
      .optional(),
    home_start_date: dateStringSchema.optional(),
    home_end_date: dateStringSchema.optional(),
    home_end_reason: z.string().optional(),
    emergency_response: z
      .enum(['normal', 'twenty_four_hour', 'partner_pharmacy', 'unavailable', 'unknown'])
      .optional(),
    after_hours_explanation_date: dateStringSchema.optional(),
    patient_tags: z.array(z.string()).optional(),
    visit_frequency: z.enum(['weekly', 'biweekly', 'monthly', 'ad_hoc', 'unknown']).optional(),
    regular_visit_slot: z.string().optional(),
    visit_available_time_note: z.string().optional(),
    access_key_info: z.string().optional(),
    medication_handover_place: z.string().optional(),
    medication_storage_location: z.string().optional(),
    collection_method: z.string().optional(),
    payer: z.string().optional(),
    medication_manager: z
      .enum(['self', 'family', 'visiting_nurse', 'facility', 'pharmacist', 'unknown'])
      .optional(),
    medication_ability: z.string().optional(),
    missed_dose_pattern: z.string().optional(),
    residual_medication_pattern: z.string().optional(),
    residual_medication_checked_on: dateStringSchema.optional(),
    residual_adjustment_status: z
      .enum(['none', 'pending', 'proposed', 'reflected', 'rejected', 'unknown'])
      .optional(),
    crushing_check_status: z.enum(['yes', 'no', 'unknown']).optional(),
    simple_suspension_check_status: z.enum(['yes', 'no', 'unknown']).optional(),
    egfr_value: z.string().optional(),
    egfr_measured_on: dateStringSchema.optional(),
    weight_kg: z.string().optional(),
    weight_measured_on: dateStringSchema.optional(),
    high_risk_drug_flags: z.array(z.string()).optional(),
    adverse_monitoring_items: z.array(z.string()).optional(),
    pain_score: z.string().optional(),
    rescue_use_count_recent: z.string().optional(),
    constipation_status: z.string().optional(),
    drowsiness_delirium_status: z.string().optional(),
    fall_risk: z.enum(['none', 'low', 'medium', 'high', 'unknown']).optional(),
    pressure_ulcer_status: z.string().optional(),
    medical_material_supplier: z.string().optional(),
    material_exchange_due_note: z.string().optional(),
    device_vendor_contact: z.string().optional(),
    document_status_note: z.string().optional(),
    report_destination_note: z.string().optional(),
    emergency_policy_note: z.string().optional(),
    interprofessional_action_note: z.string().optional(),
    home_pharmacy_add_on_2: homePharmacyAddOn2Schema.optional(),
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
        phone: optionalPhoneNumberSchema,
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
  birth_date: dateStringSchema,
  gender: patientGenderSchema,
  phone: optionalPhoneNumberSchema,
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
  // 担当チーム（患者単位）。空文字は未設定(null)へ正規化し、ID は org-reference で検証する。
  primary_pharmacist_id: z.string().optional(),
  backup_pharmacist_id: z.string().optional(),
  primary_staff_id: z.string().optional(),
  backup_staff_id: z.string().optional(),
});

export const updatePatientSchema = createPatientSchema.partial().extend({
  // 反映導線(訪問記録→患者詳細)の出所。指定時は変更履歴の source を visit_record にする。
  source_visit_record_id: z.string().optional(),
});

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
export type UpdatePatientData = z.infer<typeof updatePatientSchema>;
