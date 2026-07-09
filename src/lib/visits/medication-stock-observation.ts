import { readApiJson } from '@/lib/api/client-json';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { messageFromError } from '@/lib/utils/error-message';
import { isValidDateKey } from '@/lib/validations/date-key';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { buildVisitMedicationStockObservationsApiPath } from '@/lib/visits/api-paths';
import type {
  VisitMedicationStockObservationDraft,
  VisitMedicationStockObservationDraftErrors,
  VisitMedicationStockObservationRequest,
  VisitMedicationStockObservationResponse,
  VisitMedicationStockObservationSourcePreset,
} from '@/types/medication-stock';

export type VisitMedicationStockSubmissionResult =
  | { ok: true; data: VisitMedicationStockObservationResponse }
  | {
      ok: false;
      status: 'error' | 'conflict' | 'unavailable';
      message: string;
    };

const SOURCE_PRESET_FIELDS = {
  pharmacist_counted: {
    source_confidence: 'structured_exact',
    source_context_code: 'pharmacist_direct_observation',
    confirmation_level: 'counted_by_pharmacist',
  },
  patient_reported: {
    source_confidence: 'manual',
    source_context_code: 'patient_report',
    confirmation_level: 'patient_reported',
  },
  caregiver_reported: {
    source_confidence: 'manual',
    source_context_code: 'caregiver_report',
    confirmation_level: 'caregiver_reported',
  },
  facility_staff_reported: {
    source_confidence: 'manual',
    source_context_code: 'facility_staff_report',
    confirmation_level: 'other_professional_reported',
  },
  other_institution_record: {
    source_confidence: 'structured_partial',
    source_context_code: 'record_review',
    confirmation_level: 'other_institution_record',
  },
} as const satisfies Record<
  VisitMedicationStockObservationSourcePreset,
  Pick<
    VisitMedicationStockObservationRequest['observations'][number],
    'source_confidence' | 'source_context_code' | 'confirmation_level'
  >
>;

function parseFiniteNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateDraft(
  draft: VisitMedicationStockObservationDraft,
  observedAt: Date,
): VisitMedicationStockObservationDraftErrors[string] {
  const errors: VisitMedicationStockObservationDraftErrors[string] = {};
  if (!draft.client_observation_id.trim() || draft.client_observation_id.length > 128) {
    errors.client_observation_id = '観測IDを確認できません。入力をやり直してください。';
  }
  if (!draft.stock_item_id.trim()) {
    errors.stock_item_id = '残数管理対象を確認できません。';
  }
  if (!draft.unit.trim() || draft.unit.length > 32) {
    errors.unit = '残数単位を確認できません。';
  }
  if (!draft.source_preset) {
    errors.source_preset = '確認元を選択してください。';
  }

  switch (draft.kind) {
    case 'observed_absolute': {
      const quantity = parseFiniteNumber(draft.quantity_input);
      if (quantity == null || quantity < 0) {
        errors.quantity_input = '今回残数は0以上の数値で入力してください。';
      }
      break;
    }
    case 'usage_delta': {
      const usedQuantity = parseFiniteNumber(draft.used_quantity_input);
      if (usedQuantity == null || usedQuantity <= 0) {
        errors.used_quantity_input = '使用量は0より大きい数値で入力してください。';
      }
      break;
    }
    case 'usage_frequency': {
      const usageQuantity = parseFiniteNumber(draft.usage_quantity_input);
      const usagePeriodDays = parseFiniteNumber(draft.usage_period_days_input);
      if (usageQuantity == null || usageQuantity <= 0) {
        errors.usage_quantity_input = '使用量は0より大きい数値で入力してください。';
      }
      if (
        usagePeriodDays == null ||
        !Number.isInteger(usagePeriodDays) ||
        usagePeriodDays < 1 ||
        usagePeriodDays > 366
      ) {
        errors.usage_period_days_input = '使用期間は1日以上366日以下で入力してください。';
      }
      break;
    }
    case 'not_observed':
      if (!draft.unobserved_reason_code) {
        errors.unobserved_reason_code = '未確認理由を選択してください。';
      }
      break;
    case 'refill_request':
      break;
  }

  if (draft.last_used_date) {
    if (!isValidDateKey(draft.last_used_date)) {
      errors.last_used_date = '最終使用日は正しい日付で入力してください。';
    } else if (draft.last_used_date > japanDateKey(observedAt)) {
      errors.last_used_date = '未来の最終使用日は入力できません。';
    }
  }
  return errors;
}

export function validateVisitMedicationStockObservationDrafts(
  drafts: readonly VisitMedicationStockObservationDraft[],
  observedAt: Date = new Date(),
): VisitMedicationStockObservationDraftErrors {
  const errors: VisitMedicationStockObservationDraftErrors = {};
  const seenClientIds = new Set<string>();

  for (const draft of drafts) {
    const draftErrors = validateDraft(draft, observedAt);
    if (seenClientIds.has(draft.client_observation_id)) {
      draftErrors.client_observation_id = '同じ観測IDが重複しています。入力をやり直してください。';
    }
    seenClientIds.add(draft.client_observation_id);
    if (Object.keys(draftErrors).length > 0) {
      errors[draft.client_observation_id || draft.stock_item_id] = draftErrors;
    }
  }
  return errors;
}

export function buildVisitMedicationStockObservationRequest(
  drafts: readonly VisitMedicationStockObservationDraft[],
  observedAt: Date = new Date(),
):
  | { ok: true; data: VisitMedicationStockObservationRequest }
  | { ok: false; errors: VisitMedicationStockObservationDraftErrors } {
  const errors = validateVisitMedicationStockObservationDrafts(drafts, observedAt);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      observed_at: observedAt.toISOString(),
      observations: drafts.map((draft) => {
        const sourceFields =
          SOURCE_PRESET_FIELDS[draft.source_preset as VisitMedicationStockObservationSourcePreset];
        return {
          client_observation_id: draft.client_observation_id,
          stock_item_id: draft.stock_item_id,
          kind: draft.kind,
          unit: draft.unit,
          ...(draft.kind === 'observed_absolute' ? { quantity: Number(draft.quantity_input) } : {}),
          ...(draft.kind === 'usage_delta'
            ? { used_quantity: Number(draft.used_quantity_input) }
            : {}),
          ...(draft.kind === 'usage_frequency'
            ? {
                usage_quantity: Number(draft.usage_quantity_input),
                usage_period_days: Number(draft.usage_period_days_input),
              }
            : {}),
          ...(draft.last_used_date
            ? {
                last_used_at: `${draft.last_used_date}T00:00:00+09:00`,
                last_used_precision: 'date_only' as const,
              }
            : {}),
          ...(draft.kind === 'not_observed'
            ? { unobserved_reason_code: draft.unobserved_reason_code || undefined }
            : {}),
          ...sourceFields,
        };
      }),
    },
  };
}

export async function submitVisitMedicationStockObservations(input: {
  visitRecordId: string;
  orgId: string;
  idempotencyKey: string;
  request: VisitMedicationStockObservationRequest;
  fetchImpl?: typeof fetch;
}): Promise<VisitMedicationStockSubmissionResult> {
  try {
    const response = await (input.fetchImpl ?? fetch)(
      buildVisitMedicationStockObservationsApiPath(input.visitRecordId),
      {
        method: 'POST',
        headers: {
          ...buildOrgJsonHeaders(input.orgId),
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify(input.request),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
      return {
        ok: false,
        status:
          response.status === 409 ? 'conflict' : response.status === 503 ? 'unavailable' : 'error',
        message:
          typeof payload?.message === 'string'
            ? payload.message
            : '残数観測を登録できませんでした。入力内容を保持しています。',
      };
    }
    return {
      ok: true,
      data: await readApiJson<VisitMedicationStockObservationResponse>(
        response,
        '残数観測の登録結果を確認できませんでした',
      ),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      message: messageFromError(
        error,
        '残数観測を登録できませんでした。入力内容を保持しています。',
      ),
    };
  }
}
