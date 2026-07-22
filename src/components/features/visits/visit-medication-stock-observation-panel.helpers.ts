import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import { buildPatientMedicationStockSummaryResponseSchema } from '@/lib/medication-stock/summary-response-schema';
import { buildPatientMedicationStockApiPath } from '@/lib/patient/api-paths';
import type {
  PatientMedicationStockItemDto,
  PatientMedicationStockSummaryResponse,
  VisitMedicationStockObservationDraft,
  VisitMedicationStockObservationKindDto,
  VisitMedicationStockObservationSourcePreset,
  VisitMedicationStockUnobservedReasonCode,
} from '@/types/medication-stock';

export const SUMMARY_FRESHNESS_MS = 5 * 60 * 1000;

export const OBSERVATION_KIND_LABELS: Record<VisitMedicationStockObservationKindDto, string> = {
  observed_absolute: '今回残数',
  usage_delta: '使用量',
  usage_frequency: '使用頻度',
  not_observed: '未確認',
  refill_request: '補充依頼',
};

export const SOURCE_PRESET_LABELS: Record<VisitMedicationStockObservationSourcePreset, string> = {
  pharmacist_counted: '薬剤師が直接確認',
  patient_reported: '患者本人から申告',
  caregiver_reported: '家族・介護者から申告',
  facility_staff_reported: '施設職員から申告',
  other_institution_record: '他院記録で確認',
};

export const UNOBSERVED_REASON_LABELS: Record<VisitMedicationStockUnobservedReasonCode, string> = {
  patient_refused: '患者が確認を希望しなかった',
  caregiver_unavailable: '家族・介護者が不在',
  storage_inaccessible: '保管場所を確認できなかった',
  medication_not_present: '薬剤がその場になかった',
  identity_uncertain: '薬剤を特定できなかった',
  visit_time_limited: '訪問時間内に確認できなかった',
  safety_priority: '他の安全対応を優先した',
  other_institution_unconfirmed: '他院薬の確認が取れなかった',
  unknown: '理由を特定できなかった',
};

export function medicationStockEquivalenceReviewPresentation(status: string) {
  switch (status) {
    case 'not_required':
      return null;
    case 'needs_review':
      return { label: '名寄せ確認が必要', role: 'confirm' as const };
    case 'uncertain':
      return { label: '名寄せ確認を継続', role: 'confirm' as const };
    case 'reviewed':
      return { label: '名寄せ確認済み', role: 'done' as const };
    default:
      return { label: '名寄せ状態を確認中', role: 'blocked' as const };
  }
}

export const CATEGORY_LABELS: Record<string, string> = {
  prn: '頓服',
  topical: '外用',
  external: '外用',
  regular_leftover: '定期残薬',
  otc: 'OTC',
  other: 'その他',
};

export const SOURCE_LABELS: Record<string, string> = {
  prescription: '処方',
  initial_leftover: '初回残薬',
  other_institution: '他院',
  otc: 'OTC',
  manual: '手入力',
  unknown: '不明',
};

export const MANAGING_PARTY_LABELS: Record<string, string> = {
  patient: '患者管理',
  family: '家族管理',
  facility: '施設管理',
  pharmacy: '薬局管理',
  unknown: '管理者不明',
};

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const quantityDifferenceFormatter = new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits: 4,
});

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '未確認';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未確認';
  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '推定不可';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '推定不可';
  return dateFormatter.format(date);
}

export function formatQuantity(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return '不明';
  return `${value}${unit}`;
}

export function formatDailyUsage(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return '不明';
  return `${value}${unit}/日`;
}

export function formatStockLedgerDifference(
  currentQuantity: number | null | undefined,
  priorRecordedQuantity: number | null | undefined,
  unit: string,
) {
  if (
    currentQuantity == null ||
    priorRecordedQuantity == null ||
    !Number.isFinite(currentQuantity) ||
    !Number.isFinite(priorRecordedQuantity)
  ) {
    return '算出不可';
  }

  const difference = Math.round((currentQuantity - priorRecordedQuantity) * 10_000) / 10_000;
  const magnitude = `${quantityDifferenceFormatter.format(Math.abs(difference))}${unit}`;
  if (difference > 0) return `+${magnitude}（増加）`;
  if (difference < 0) return `-${magnitude}（減少）`;
  return `${magnitude}（変化なし）`;
}

function buildMedicationStockPath(patientId: string, itemLimit: number) {
  const params = new URLSearchParams({
    item_limit: String(itemLimit),
    event_limit: '0',
  });
  return `${buildPatientMedicationStockApiPath(patientId)}?${params.toString()}`;
}

export async function fetchMedicationStockSummary({
  patientId,
  orgId,
  itemLimit,
}: {
  patientId: string;
  orgId: string;
  itemLimit: number;
}) {
  const response = await fetch(buildMedicationStockPath(patientId, itemLimit), {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<PatientMedicationStockSummaryResponse>(response, {
    fallbackMessage: '患者の残数管理情報の取得に失敗しました',
    schema: buildPatientMedicationStockSummaryResponseSchema({
      patientId,
      itemLimit,
      eventLimit: 0,
    }),
  });
}

export function createObservationDraft(
  item: PatientMedicationStockItemDto,
  kind: VisitMedicationStockObservationKindDto,
): VisitMedicationStockObservationDraft {
  return {
    client_observation_id: createClientIdempotencyKey('vso'),
    stock_item_id: item.id,
    unit: item.unit,
    kind,
    quantity_input: '',
    used_quantity_input: '',
    usage_quantity_input: '',
    usage_period_days_input: '',
    last_used_date: '',
    unobserved_reason_code: '',
    source_preset: '',
  };
}

export function resetKindFields(
  draft: VisitMedicationStockObservationDraft,
  kind: VisitMedicationStockObservationKindDto,
): VisitMedicationStockObservationDraft {
  return {
    ...draft,
    kind,
    quantity_input: '',
    used_quantity_input: '',
    usage_quantity_input: '',
    usage_period_days_input: '',
    last_used_date: kind === 'not_observed' ? '' : draft.last_used_date,
    unobserved_reason_code: '',
  };
}
