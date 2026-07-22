import { z } from 'zod';
import { formatDateLabel } from '@/lib/ui/date-format';

export type ProfessionType =
  | 'physician'
  | 'nurse'
  | 'care_manager'
  | 'medical_social_worker'
  | 'physical_therapist'
  | 'occupational_therapist'
  | 'speech_therapist'
  | 'registered_dietitian'
  | 'dentist'
  | 'dental_hygienist'
  | 'home_helper'
  | 'care_staff'
  | 'other';

export type ContactMethod = 'email' | 'fax' | 'phone' | 'in_person' | 'postal' | 'ses';

export type ExternalProfessional = {
  id: string;
  profession_type: ProfessionType;
  name: string;
  facility_id: string | null;
  facility_name: string | null;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: ContactMethod | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  address: string | null;
  notes: string | null;
  patient_count: number;
  created_at: string;
  updated_at: string;
};

export type ExternalProfessionalsResponse = {
  data: ExternalProfessional[];
  meta: {
    total_count: number;
    visible_count: number;
    hidden_count: number;
    truncated: boolean;
    count_basis: 'external_professionals';
    has_more: boolean;
    limit?: number;
    filters_applied: {
      q: string | null;
      profession_type: ProfessionType | null;
      facility_id: string | null;
      preferred_contact_method: ContactMethod | null;
    };
  };
};

export type FacilityOption = {
  id: string;
  name: string;
};

export type FacilitiesResponse = {
  data: FacilityOption[];
};

export type LinkedPatient = {
  id: string;
  role: string;
  is_primary: boolean;
  case_id: string;
  case_status: string;
  patient_id: string;
  patient_name: string;
  patient_name_kana: string | null;
  archived_at: string | null;
  archive?: {
    status: 'active' | 'archived';
    archived: boolean;
    archived_at: string | null;
  };
};

export type LinkedPatientsResponse = {
  data: LinkedPatient[];
  meta: {
    limit: number;
    total_count: number;
    visible_count: number;
    hidden_count: number;
    has_more: boolean;
    count_basis: 'care_team_links';
    filters_applied: {
      external_professional_id: string;
      archive_status: 'active' | 'archived' | 'all';
      assignment_scoped: boolean;
    };
  };
};

export type FormState = {
  profession_type: ProfessionType;
  name: string;
  facility_id: string;
  organization_name: string;
  department: string;
  phone: string;
  email: string;
  fax: string;
  preferred_contact_method: ContactMethod | typeof NONE_VALUE;
  preferred_contact_time: string;
  address: string;
  notes: string;
};

export const NONE_VALUE = '__none__';
export const EMPTY_PROFESSIONALS: ExternalProfessional[] = [];
export const EMPTY_FACILITY_OPTIONS: FacilityOption[] = [];
export const EMPTY_LINKED_PATIENTS: LinkedPatient[] = [];
export const LINKED_PATIENT_LIMIT = 20;

export const PROFESSION_TYPES: Array<{ value: ProfessionType; label: string }> = [
  { value: 'physician', label: '医師' },
  { value: 'nurse', label: '訪問看護師' },
  { value: 'care_manager', label: 'ケアマネジャー' },
  { value: 'medical_social_worker', label: 'MSW' },
  { value: 'physical_therapist', label: '理学療法士' },
  { value: 'occupational_therapist', label: '作業療法士' },
  { value: 'speech_therapist', label: '言語聴覚士' },
  { value: 'registered_dietitian', label: '管理栄養士' },
  { value: 'dentist', label: '歯科医師' },
  { value: 'dental_hygienist', label: '歯科衛生士' },
  { value: 'home_helper', label: 'ヘルパー' },
  { value: 'care_staff', label: '介護職員' },
  { value: 'other', label: 'その他他職種' },
];

export const CONTACT_METHODS: Array<{ value: ContactMethod; label: string }> = [
  { value: 'fax', label: 'FAX' },
  { value: 'phone', label: '電話' },
  { value: 'email', label: 'メール' },
  { value: 'postal', label: '郵送' },
  { value: 'in_person', label: '対面' },
  { value: 'ses', label: 'SESメール' },
];

const professionTypeSchema = z.custom<ProfessionType>(
  (value) => typeof value === 'string' && PROFESSION_TYPES.some((option) => option.value === value),
);

const contactMethodSchema = z.custom<ContactMethod>(
  (value) => typeof value === 'string' && CONTACT_METHODS.some((option) => option.value === value),
);

const externalProfessionalSchema = z.custom<ExternalProfessional>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.name === 'string';
});

export const externalProfessionalsResponseSchema: z.ZodType<ExternalProfessionalsResponse> = z
  .object({
    data: z.array(externalProfessionalSchema),
    meta: z
      .object({
        total_count: z.number().int().nonnegative(),
        visible_count: z.number().int().nonnegative(),
        hidden_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
        count_basis: z.literal('external_professionals'),
        has_more: z.boolean(),
        limit: z.number().int().positive().optional(),
        filters_applied: z
          .object({
            q: z.string().nullable(),
            profession_type: professionTypeSchema.nullable(),
            facility_id: z.string().nullable(),
            preferred_contact_method: contactMethodSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const linkedPatientSchema = z.custom<LinkedPatient>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.patient_id === 'string';
});

export const linkedPatientsResponseSchema: z.ZodType<LinkedPatientsResponse> = z
  .object({
    data: z.array(linkedPatientSchema),
    meta: z
      .object({
        limit: z.number().int().positive(),
        total_count: z.number().int().nonnegative(),
        visible_count: z.number().int().nonnegative(),
        hidden_count: z.number().int().nonnegative(),
        has_more: z.boolean(),
        count_basis: z.literal('care_team_links'),
        filters_applied: z
          .object({
            external_professional_id: z.string(),
            archive_status: z.enum(['active', 'archived', 'all']),
            assignment_scoped: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const facilitiesResponseSchema: z.ZodType<FacilitiesResponse> = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(200),
          name: z.string().trim().min(1).max(500),
        })
        .strip(),
    ),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    for (const [index, facility] of data.entries()) {
      if (ids.has(facility.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate facility identity',
        });
      }
      ids.add(facility.id);
    }
  });

export function createEmptyForm(): FormState {
  return {
    profession_type: 'nurse',
    name: '',
    facility_id: NONE_VALUE,
    organization_name: '',
    department: '',
    phone: '',
    email: '',
    fax: '',
    preferred_contact_method: NONE_VALUE,
    preferred_contact_time: '',
    address: '',
    notes: '',
  };
}

export function toForm(item: ExternalProfessional): FormState {
  return {
    profession_type: item.profession_type,
    name: item.name,
    facility_id: item.facility_id ?? NONE_VALUE,
    organization_name: item.organization_name ?? '',
    department: item.department ?? '',
    phone: item.phone ?? '',
    email: item.email ?? '',
    fax: item.fax ?? '',
    preferred_contact_method: item.preferred_contact_method ?? NONE_VALUE,
    preferred_contact_time: item.preferred_contact_time ?? '',
    address: item.address ?? '',
    notes: item.notes ?? '',
  };
}

export function normalizeForm(form?: Partial<FormState> | null): FormState {
  return {
    profession_type: form?.profession_type ?? 'nurse',
    name: form?.name ?? '',
    facility_id: form?.facility_id ?? NONE_VALUE,
    organization_name: form?.organization_name ?? '',
    department: form?.department ?? '',
    phone: form?.phone ?? '',
    email: form?.email ?? '',
    fax: form?.fax ?? '',
    preferred_contact_method: form?.preferred_contact_method ?? NONE_VALUE,
    preferred_contact_time: form?.preferred_contact_time ?? '',
    address: form?.address ?? '',
    notes: form?.notes ?? '',
  };
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function trimOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getProfessionLabel(type: ProfessionType) {
  return PROFESSION_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function getContactMethodLabel(method: ContactMethod | null) {
  if (!method) return '送付方法未設定';
  return CONTACT_METHODS.find((item) => item.value === method)?.label ?? method;
}

export function getCareTeamRoleLabel(role: string) {
  switch (role) {
    case 'physician':
      return '医師';
    case 'nurse':
      return '訪問看護師';
    case 'care_manager':
      return 'ケアマネジャー';
    case 'pharmacist':
      return '薬剤師';
    default:
      return 'その他';
  }
}

export function getCaseStatusLabel(status: string) {
  switch (status) {
    case 'active':
      return '有効ケース';
    case 'closed':
      return '終了ケース';
    case 'archived':
      return 'アーカイブ';
    default:
      return status;
  }
}

export function formatOptionalDateTime(value: string | null) {
  if (!value) return '記録なし';
  return formatDateLabel(value, { pattern: 'yyyy/M/d HH:mm' });
}

export function buildCreatePayload(form: FormState) {
  return {
    profession_type: form.profession_type,
    name: form.name.trim(),
    facility_id: form.facility_id === NONE_VALUE ? undefined : form.facility_id,
    organization_name: trimOrUndefined(form.organization_name),
    department: trimOrUndefined(form.department),
    phone: trimOrUndefined(form.phone),
    email: trimOrUndefined(form.email),
    fax: trimOrUndefined(form.fax),
    preferred_contact_method:
      form.preferred_contact_method === NONE_VALUE ? undefined : form.preferred_contact_method,
    preferred_contact_time: trimOrUndefined(form.preferred_contact_time),
    address: trimOrUndefined(form.address),
    notes: trimOrUndefined(form.notes),
  };
}

export function buildUpdatePayload(form: FormState) {
  return {
    profession_type: form.profession_type,
    name: form.name.trim(),
    facility_id: form.facility_id === NONE_VALUE ? null : form.facility_id,
    organization_name: trimOrNull(form.organization_name),
    department: trimOrNull(form.department),
    phone: trimOrNull(form.phone),
    email: trimOrNull(form.email),
    fax: trimOrNull(form.fax),
    preferred_contact_method:
      form.preferred_contact_method === NONE_VALUE ? null : form.preferred_contact_method,
    preferred_contact_time: trimOrNull(form.preferred_contact_time),
    address: trimOrNull(form.address),
    notes: trimOrNull(form.notes),
  };
}

export function getFormBlocker(form: FormState) {
  if (!form.name.trim()) return '氏名は必須です。';
  return null;
}

export const externalProfessionalFormSchema = z
  .object({
    profession_type: z.custom<ProfessionType>(),
    name: z.string(),
    facility_id: z.string(),
    organization_name: z.string(),
    department: z.string(),
    phone: z.string(),
    email: z.string(),
    fax: z.string(),
    preferred_contact_method: z.custom<FormState['preferred_contact_method']>(),
    preferred_contact_time: z.string(),
    address: z.string(),
    notes: z.string(),
  })
  .superRefine((value, ctx) => {
    const form = normalizeForm(value);
    const blocker = getFormBlocker(form);
    if (!blocker) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['name'],
      message: blocker,
    });
  });

export function matchesProfessionalQuery(item: ExternalProfessional, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    item.name,
    getProfessionLabel(item.profession_type),
    item.facility_name ?? '',
    item.organization_name ?? '',
    item.department ?? '',
    item.phone ?? '',
    item.email ?? '',
    item.fax ?? '',
    item.address ?? '',
    item.notes ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}
