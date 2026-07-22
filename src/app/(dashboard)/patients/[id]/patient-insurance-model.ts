import { z } from 'zod';

const nullableIsoDateTimeSchema = z.string().datetime().nullable();

// Keep the client cache bounded to the route projection consumed by this workspace while
// rejecting drift in the envelope and bucket containers.
export const insuranceRecordSchema = z.object({
  id: z.string().min(1),
  insurance_type: z.enum(['medical', 'care', 'public_subsidy']),
  application_status: z.enum(['confirmed', 'applying', 'change_pending', 'not_applicable']),
  application_submitted_at: nullableIsoDateTimeSchema,
  decision_at: nullableIsoDateTimeSchema,
  public_program_code: z.string().nullable(),
  previous_care_level: z.string().nullable(),
  provisional_care_level: z.string().nullable(),
  confirmed_care_level: z.string().nullable(),
  insurer_number: z.string().nullable(),
  symbol: z.string().nullable(),
  number: z.string().nullable(),
  branch_number: z.string().nullable(),
  copay_ratio: z.number().int().min(0).max(100).nullable(),
  valid_from: nullableIsoDateTimeSchema,
  valid_until: nullableIsoDateTimeSchema,
  is_active: z.boolean(),
  notes: z.string().nullable(),
  updated_at: z.string().datetime(),
});

export const insuranceResponseSchema = z
  .object({
    data: z
      .object({
        current: z.array(insuranceRecordSchema),
        upcoming: z.array(insuranceRecordSchema),
        history: z.array(insuranceRecordSchema),
      })
      .strict(),
  })
  .strict();

export type InsuranceRecord = z.infer<typeof insuranceRecordSchema>;
export type InsuranceResponse = z.infer<typeof insuranceResponseSchema>;

export const OFFICIAL_CARE_LEVEL_VALUES = [
  'support_1',
  'support_2',
  'care_1',
  'care_2',
  'care_3',
  'care_4',
  'care_5',
] as const;

type OfficialCareLevel = (typeof OFFICIAL_CARE_LEVEL_VALUES)[number];

export const IDENTIFIER_LABELS = {
  medical: {
    insurerNumber: '保険者番号',
    number: '被保険者等番号',
  },
  care: {
    insurerNumber: '介護保険者番号',
    number: '介護保険被保険者番号',
  },
  public_subsidy: {
    insurerNumber: '公費負担者番号',
    number: '受給者番号',
  },
} as const;

export type InsuranceFormState = {
  insurance_type: InsuranceRecord['insurance_type'];
  application_status: InsuranceRecord['application_status'];
  application_submitted_at: string;
  decision_at: string;
  public_program_code: string;
  previous_care_level: string;
  provisional_care_level: string;
  confirmed_care_level: string;
  insurer_number: string;
  symbol: string;
  number: string;
  branch_number: string;
  copay_ratio: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  notes: string;
};

export type InsuranceFormErrors = Partial<Record<keyof InsuranceFormState, string>>;

export type SaveInsuranceArgs =
  | {
      insuranceId: string;
      expectedUpdatedAt: string;
      form: InsuranceFormState;
    }
  | {
      insuranceId?: undefined;
      expectedUpdatedAt?: never;
      form: InsuranceFormState;
    };

export const EMPTY_FORM: InsuranceFormState = {
  insurance_type: 'medical',
  application_status: 'confirmed',
  application_submitted_at: '',
  decision_at: '',
  public_program_code: '',
  previous_care_level: '',
  provisional_care_level: '',
  confirmed_care_level: '',
  insurer_number: '',
  symbol: '',
  number: '',
  branch_number: '',
  copay_ratio: '',
  valid_from: '',
  valid_until: '',
  is_active: true,
  notes: '',
};

function isOfficialCareLevel(value: string): value is OfficialCareLevel {
  return OFFICIAL_CARE_LEVEL_VALUES.includes(value as OfficialCareLevel);
}

export function validateInsuranceForm(form: InsuranceFormState): InsuranceFormErrors {
  const errors: InsuranceFormErrors = {};

  if (form.insurance_type === 'public_subsidy' && !/^\d{2}$/.test(form.public_program_code)) {
    errors.public_program_code = '公費は2桁の法別番号を入力してください。';
  }

  if (form.is_active && form.insurance_type === 'care' && form.application_status === 'confirmed') {
    if (!isOfficialCareLevel(form.confirmed_care_level)) {
      errors.confirmed_care_level = '確定済みの介護保険は認定区分を選択してください。';
    }
  }

  if (
    form.is_active &&
    form.insurance_type === 'care' &&
    form.application_status === 'change_pending'
  ) {
    if (!isOfficialCareLevel(form.previous_care_level)) {
      errors.previous_care_level = '区分変更前の認定区分を選択してください。';
    }
    if (!isOfficialCareLevel(form.provisional_care_level)) {
      errors.provisional_care_level = '区分変更中の暫定区分を選択してください。';
    }
  }

  if (form.valid_from && form.valid_until && form.valid_from > form.valid_until) {
    errors.valid_until = '有効終了日は有効開始日以降にしてください。';
  }

  if (
    form.application_submitted_at &&
    form.decision_at &&
    form.application_submitted_at > form.decision_at
  ) {
    errors.decision_at = '決定日は申請日以降にしてください。';
  }

  if (form.copay_ratio !== '') {
    const ratio = Number(form.copay_ratio);
    if (!Number.isInteger(ratio) || ratio < 0 || ratio > 100) {
      errors.copay_ratio = '自己負担割合は0〜100の整数で入力してください。';
    }
  }

  return errors;
}

function toDateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : '';
}

export function toFormState(record?: InsuranceRecord): InsuranceFormState {
  if (!record) return EMPTY_FORM;

  return {
    insurance_type: record.insurance_type,
    application_status: record.application_status,
    application_submitted_at: toDateInputValue(record.application_submitted_at),
    decision_at: toDateInputValue(record.decision_at),
    public_program_code: record.public_program_code ?? '',
    previous_care_level: record.previous_care_level ?? '',
    provisional_care_level: record.provisional_care_level ?? '',
    confirmed_care_level: record.confirmed_care_level ?? '',
    insurer_number: record.insurer_number ?? '',
    symbol: record.symbol ?? '',
    number: record.number ?? '',
    branch_number: record.branch_number ?? '',
    copay_ratio: record.copay_ratio != null ? String(record.copay_ratio) : '',
    valid_from: toDateInputValue(record.valid_from),
    valid_until: toDateInputValue(record.valid_until),
    is_active: record.is_active,
    notes: record.notes ?? '',
  };
}

export function buildInsurancePayload(form: InsuranceFormState) {
  const isConfirmedCare = form.insurance_type === 'care' && form.application_status === 'confirmed';
  const isPendingCareChange =
    form.insurance_type === 'care' && form.application_status === 'change_pending';

  return {
    insurance_type: form.insurance_type,
    application_status: form.application_status,
    application_submitted_at: form.application_submitted_at || null,
    decision_at: form.decision_at || null,
    public_program_code:
      form.insurance_type === 'public_subsidy' ? form.public_program_code || null : null,
    previous_care_level: isPendingCareChange ? form.previous_care_level || null : null,
    provisional_care_level: isPendingCareChange ? form.provisional_care_level || null : null,
    confirmed_care_level: isConfirmedCare ? form.confirmed_care_level || null : null,
    insurer_number: form.insurer_number || null,
    symbol: form.insurance_type === 'medical' ? form.symbol || null : null,
    number: form.number || null,
    branch_number: form.insurance_type === 'medical' ? form.branch_number || null : null,
    copay_ratio: form.copay_ratio === '' ? null : Number(form.copay_ratio),
    valid_from: form.valid_from || null,
    valid_until: form.valid_until || null,
    is_active: form.is_active,
    notes: form.notes || null,
  };
}

export function mergeInsuranceDraft(
  current: Record<string, InsuranceFormState>,
  id: string,
  base: InsuranceFormState,
  patch: Partial<InsuranceFormState>,
) {
  return {
    ...current,
    [id]: {
      ...(current[id] ?? base),
      ...patch,
    },
  };
}
