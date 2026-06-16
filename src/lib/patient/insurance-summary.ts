export const INSURANCE_TYPE_LABELS = {
  medical: '医療保険',
  care: '介護保険',
  public_subsidy: '公費',
} as const;

export const INSURANCE_SUMMARY_TYPE_LABELS = {
  medical: '医療',
  care: '介護',
  public_subsidy: '公費',
} as const;

export const APPLICATION_STATUS_LABELS = {
  confirmed: '確定済み',
  applying: '申請中',
  change_pending: '区分変更中',
  not_applicable: '対象外',
  expired: '期限切れ',
  inactive: '無効',
} as const;

export const APPLICATION_EDITABLE_STATUS_LABELS = {
  confirmed: APPLICATION_STATUS_LABELS.confirmed,
  applying: APPLICATION_STATUS_LABELS.applying,
  change_pending: APPLICATION_STATUS_LABELS.change_pending,
  not_applicable: APPLICATION_STATUS_LABELS.not_applicable,
} as const;

export const CARE_LEVEL_LABELS = {
  support_1: '要支援1',
  support_2: '要支援2',
  care_1: '要介護1',
  care_2: '要介護2',
  care_3: '要介護3',
  care_4: '要介護4',
  care_5: '要介護5',
  applying: '申請中',
  not_applied: '未申請',
  not_eligible: '非該当',
} as const;

export type PatientInsuranceType = keyof typeof INSURANCE_TYPE_LABELS;
export type PatientInsuranceApplicationStatus =
  | 'confirmed'
  | 'applying'
  | 'change_pending'
  | 'not_applicable';

export type PatientInsuranceClassifiable = {
  is_active: boolean;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
};

export type PatientInsuranceSummaryRecord = Partial<PatientInsuranceClassifiable> & {
  insurance_type: string;
  application_status: string | null;
  public_program_code?: string | null;
  copay_ratio?: number | null;
};

export type PatientInsurancePublicSummary = {
  insurance_type: string;
  status_label: string;
  period_label: string;
  copay_label: string | null;
  expires_soon: boolean;
};

const INSURANCE_EXPIRING_DAYS = 30;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatInsuranceDateKey(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function formatCopayRatio(value: number | null | undefined) {
  return value == null ? '—' : `${value}%`;
}

export function formatCareLevel(value: string | null | undefined) {
  if (!value) return '—';
  return CARE_LEVEL_LABELS[value as keyof typeof CARE_LEVEL_LABELS] ?? value;
}

function daysUntil(value: Date | string | null | undefined, now: Date): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60_000));
}

export function classifyPatientInsurances<T extends PatientInsuranceClassifiable>(
  insurances: T[],
  today: Date,
) {
  return {
    current: insurances.filter((insurance) => {
      const validFrom = toDate(insurance.valid_from);
      const validUntil = toDate(insurance.valid_until);
      return (
        insurance.is_active &&
        (!insurance.valid_from || (validFrom != null && validFrom <= today)) &&
        (!insurance.valid_until || (validUntil != null && validUntil >= today))
      );
    }),
    upcoming: insurances.filter((insurance) => {
      const validFrom = toDate(insurance.valid_from);
      return insurance.is_active && validFrom != null && validFrom > today;
    }),
    history: insurances.filter((insurance) => {
      const validUntil = toDate(insurance.valid_until);
      return !insurance.is_active || (validUntil != null && validUntil < today);
    }),
    all: insurances,
  };
}

export function summarizePatientInsurance(
  insurance: PatientInsuranceSummaryRecord,
  now: Date,
): PatientInsurancePublicSummary {
  const until = formatInsuranceDateKey(insurance.valid_until);
  const from = formatInsuranceDateKey(insurance.valid_from);
  const days = daysUntil(insurance.valid_until, now);
  const expiresSoon = days != null && days >= 0 && days <= INSURANCE_EXPIRING_DAYS;
  const expired = days != null && days < 0;
  const isActive = insurance.is_active !== false;
  const typeLabel =
    INSURANCE_SUMMARY_TYPE_LABELS[
      insurance.insurance_type as keyof typeof INSURANCE_SUMMARY_TYPE_LABELS
    ] ?? insurance.insurance_type;
  const programLabel =
    insurance.insurance_type === 'public_subsidy' && insurance.public_program_code
      ? ` ${insurance.public_program_code}`
      : '';
  const statusLabel = !isActive
    ? APPLICATION_STATUS_LABELS.inactive
    : expired
      ? APPLICATION_STATUS_LABELS.expired
      : (APPLICATION_STATUS_LABELS[
          insurance.application_status as keyof typeof APPLICATION_STATUS_LABELS
        ] ??
        insurance.application_status ??
        '未確認');

  return {
    insurance_type: `${typeLabel}${programLabel}`,
    status_label: statusLabel,
    period_label: [from, until].filter(Boolean).join(' - ') || '期限未設定',
    copay_label: insurance.copay_ratio != null ? formatCopayRatio(insurance.copay_ratio) : null,
    expires_soon:
      !isActive || expiresSoon || expired || insurance.application_status !== 'confirmed',
  };
}

export function summarizePatientInsurances(insurances: PatientInsuranceSummaryRecord[], now: Date) {
  return insurances.map((insurance) => summarizePatientInsurance(insurance, now));
}
