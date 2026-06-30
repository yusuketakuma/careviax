import { formatUtcDateKey } from '@/lib/date-key';
import {
  buildPatientArchiveSummary,
  type PatientArchiveSummary,
} from '@/lib/patient/archive-summary';
import { formatLabAnalyteLabel } from '@/lib/patient/lab-analytes';
import {
  classifyPatientInsurances,
  summarizePatientInsurances,
  type PatientInsurancePublicSummary,
  type PatientInsuranceSummaryRecord,
} from '@/lib/patient/insurance-summary';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const LAB_STALE_DAYS = 90;

export type PatientOperationalLabFlag = {
  analyte_code: string;
  analyte_label: string;
  value_label: string;
  measured_at: string;
  abnormal: boolean;
  stale: boolean;
  abnormal_flag: string | null;
};

export type PatientOperationalSummary = {
  patient_id: string;
  name: string;
  archive: PatientArchiveSummary;
  insurance: {
    current: PatientInsurancePublicSummary[];
    current_count: number;
    missing: boolean;
    expires_soon_count: number;
  };
  safety: {
    has_allergy: boolean;
    allergy_label: string | null;
    critical_lab_count: number;
    stale_lab_count: number;
    lab_flags: PatientOperationalLabFlag[];
  };
};

export type PatientOperationalSummaryInput = {
  id: string;
  name: string;
  archived_at?: Date | string | null;
  allergy_info?: unknown;
  insurances?: PatientInsuranceSummaryRecord[] | null;
  lab_observations?: Array<{
    analyte_code: string;
    value_numeric: number | null;
    value_text?: string | null;
    unit: string | null;
    measured_at: Date | string;
    abnormal_flag: string | null;
  }> | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOlderThanDays(value: Date | string | null | undefined, now: Date, days: number) {
  const date = toDate(value);
  if (!date) return true;
  return now.getTime() - date.getTime() > days * 24 * 60 * 60_000;
}

function formatLabValue(lab: {
  value_numeric: number | null;
  value_text?: string | null;
  unit: string | null;
}) {
  if (lab.value_text?.trim()) return lab.value_text.trim();
  if (lab.value_numeric == null) return '値未入力';
  return `${lab.value_numeric}${lab.unit ? ` ${lab.unit}` : ''}`;
}

export function hasPatientAllergyInfo(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && !['なし', 'none', '無し'].includes(trimmed.toLowerCase());
  }
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

export function buildPatientOperationalSummary(
  patient: PatientOperationalSummaryInput,
  now = new Date(),
): PatientOperationalSummary {
  const today = utcDateFromLocalKey(japanDateKey(now));
  const insurances = (patient.insurances ?? []).map((insurance) => ({
    ...insurance,
    is_active: insurance.is_active !== false,
    valid_from: insurance.valid_from ?? null,
    valid_until: insurance.valid_until ?? null,
  }));
  const currentInsurances = classifyPatientInsurances(insurances, today).current;
  const currentInsuranceSummaries = summarizePatientInsurances(currentInsurances, today);
  const labFlags = (patient.lab_observations ?? [])
    .map((lab): PatientOperationalLabFlag => {
      const measuredAt = toDate(lab.measured_at);
      const stale = isOlderThanDays(lab.measured_at, now, LAB_STALE_DAYS);
      const abnormal = Boolean(lab.abnormal_flag);
      return {
        analyte_code: lab.analyte_code,
        analyte_label: formatLabAnalyteLabel(lab.analyte_code),
        value_label: formatLabValue(lab),
        measured_at: measuredAt ? formatUtcDateKey(measuredAt) : '不明',
        abnormal,
        stale,
        abnormal_flag: lab.abnormal_flag,
      };
    })
    .filter((lab) => lab.abnormal || lab.stale);
  const hasAllergy = hasPatientAllergyInfo(patient.allergy_info);

  return {
    patient_id: patient.id,
    name: patient.name,
    archive: buildPatientArchiveSummary(patient.archived_at ?? null),
    insurance: {
      current: currentInsuranceSummaries,
      current_count: currentInsurances.length,
      missing: currentInsurances.length === 0,
      expires_soon_count: currentInsuranceSummaries.filter((item) => item.expires_soon).length,
    },
    safety: {
      has_allergy: hasAllergy,
      allergy_label: hasAllergy ? 'アレルギーあり' : null,
      critical_lab_count: labFlags.filter((lab) => lab.abnormal).length,
      stale_lab_count: labFlags.filter((lab) => lab.stale).length,
      lab_flags: labFlags.slice(0, 3),
    },
  };
}
