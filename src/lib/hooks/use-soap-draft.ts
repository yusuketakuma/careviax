// ─── usesSoapDraft hook ────────────────────────────────────────────────────────
// 訪問記録ウィザードのオフライン自動保存フック。
// IndexedDB (Dexie) を使って structuredSoap と currentStep を永続化する。

import { useCallback } from 'react';
import { offlineDb, type OfflineVisitDraft } from '@/lib/stores/offline-db';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import {
  purgeLegacyPlaintextSoapDraftFields,
  type LegacyPlaintextSoapDraftFields,
} from '@/lib/offline/soap-draft-legacy';
import { parseJsonOrNull, parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';
import type { StructuredSoap } from '@/types/structured-soap';
import type {
  VisitGeoLog,
  VisitGeoPoint,
  VisitLocationPermissionState,
} from '@/lib/visit-location';

export type SoapDraftResidualMedication = {
  drug_master_id?: string;
  drug_name: string;
  drug_code?: string;
  prescribed_quantity?: number;
  prescribed_daily_dose?: number;
  remaining_quantity: number;
  is_prohibited_reduction: boolean;
};

export type SoapDraftSnapshot = {
  structuredSoap: StructuredSoap;
  currentStep: number;
  visitDate: string | null;
  outcomeStatus: string | null;
  receiptPersonName: string | null;
  receiptPersonRelation: string | null;
  receiptAt: string | null;
  nextVisitSuggestionDate: string | null;
  cancellationReason: string | null;
  postponeReason: string | null;
  revisitReason: string | null;
  residualMedications: SoapDraftResidualMedication[];
  visitGeoLog: VisitGeoLog | null;
};

export type SoapDraftMetadata = {
  visitDate?: string;
  outcomeStatus?: string;
  receiptPersonName?: string;
  receiptPersonRelation?: string;
  receiptAt?: string;
  nextVisitSuggestionDate?: string;
  cancellationReason?: string;
  postponeReason?: string;
  revisitReason?: string;
  residualMedications?: SoapDraftResidualMedication[];
  visitGeoLog?: VisitGeoLog | null;
};

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readCurrentStep(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readNullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readSoapSubjective(value: unknown): StructuredSoap['subjective'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    symptom_checks: readStringArray(object.symptom_checks),
    free_text: readOptionalString(object.free_text),
  };
}

function readSoapObjective(value: unknown): StructuredSoap['objective'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    ...(object as Partial<StructuredSoap['objective']>),
    medication_status: typeof object.medication_status === 'string' ? object.medication_status : '',
    adherence_score:
      object.adherence_score === 1 ||
      object.adherence_score === 2 ||
      object.adherence_score === 3 ||
      object.adherence_score === 4 ||
      object.adherence_score === 5
        ? object.adherence_score
        : 3,
    side_effect_checks: readStringArray(object.side_effect_checks),
    free_text: readOptionalString(object.free_text),
  };
}

function readSoapAssessment(value: unknown): StructuredSoap['assessment'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    problem_checks: readStringArray(object.problem_checks),
    severity: readOptionalString(object.severity),
    drug_related_problems: readStringArray(object.drug_related_problems),
    free_text: readOptionalString(object.free_text),
  };
}

function readSoapPlan(value: unknown): StructuredSoap['plan'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    intervention_checks: readStringArray(object.intervention_checks),
    next_visit_date: readOptionalString(object.next_visit_date),
    prescription_proposal: readOptionalString(object.prescription_proposal),
    physician_report_items: readOptionalString(object.physician_report_items),
    care_manager_report_items: readOptionalString(object.care_manager_report_items),
    care_service_coordination: readOptionalString(object.care_service_coordination),
    free_text: readOptionalString(object.free_text),
  };
}

function readStructuredSoapPayload(payload: string): StructuredSoap | null {
  const object = parseJsonObjectOrNull(payload);
  if (!object) return null;

  const subjective = readSoapSubjective(object.subjective);
  const objective = readSoapObjective(object.objective);
  const assessment = readSoapAssessment(object.assessment);
  const plan = readSoapPlan(object.plan);
  if (!subjective || !objective || !assessment || !plan) return null;

  return {
    ...(object as Partial<StructuredSoap>),
    subjective,
    objective,
    assessment,
    plan,
  };
}

function readResidualMedication(value: unknown): SoapDraftResidualMedication | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.drug_name !== 'string') return null;
  if (
    typeof object.remaining_quantity !== 'number' ||
    !Number.isFinite(object.remaining_quantity)
  ) {
    return null;
  }
  if (typeof object.is_prohibited_reduction !== 'boolean') return null;

  return {
    drug_master_id: readOptionalString(object.drug_master_id),
    drug_name: object.drug_name,
    drug_code: readOptionalString(object.drug_code),
    prescribed_quantity: readOptionalNumber(object.prescribed_quantity),
    prescribed_daily_dose: readOptionalNumber(object.prescribed_daily_dose),
    remaining_quantity: object.remaining_quantity,
    is_prohibited_reduction: object.is_prohibited_reduction,
  };
}

function readResidualMedicationsPayload(payload: string | null | undefined) {
  if (!payload) return [];
  const parsed = parseJsonOrNull(payload);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const medication = readResidualMedication(item);
    return medication ? [medication] : [];
  });
}

function readVisitLocationPermissionState(value: unknown): VisitLocationPermissionState | null {
  switch (value) {
    case 'granted':
    case 'prompt':
    case 'denied':
    case 'unsupported':
    case 'unavailable':
      return value;
    default:
      return null;
  }
}

function readVisitGeoPoint(value: unknown): VisitGeoPoint | null {
  if (value === null) return null;
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.captured_at !== 'string') return null;
  if (typeof object.latitude !== 'number' || !Number.isFinite(object.latitude)) return null;
  if (typeof object.longitude !== 'number' || !Number.isFinite(object.longitude)) return null;
  const accuracy =
    typeof object.accuracy_meters === 'number' && Number.isFinite(object.accuracy_meters)
      ? object.accuracy_meters
      : null;

  return {
    captured_at: object.captured_at,
    latitude: object.latitude,
    longitude: object.longitude,
    accuracy_meters: accuracy,
  };
}

function readVisitGeoLogPayload(payload: string | null | undefined): VisitGeoLog | null {
  if (!payload) return null;
  const object = parseJsonObjectOrNull(payload);
  if (!object) return null;
  if (typeof object.enabled !== 'boolean') return null;
  const permission = readVisitLocationPermissionState(object.permission);
  if (!permission) return null;

  return {
    enabled: object.enabled,
    permission,
    start: readVisitGeoPoint(object.start),
    end: readVisitGeoPoint(object.end),
  };
}

/**
 * 指定した scheduleId に対応するSOAPドラフトを読み書きするフック。
 *
 * @param scheduleId - 訪問スケジュールID（IndexedDB の検索キー）
 * @param patientId  - 患者ID（新規作成時に保存）
 */
export function useSoapDraft(scheduleId: string, patientId: string) {
  /**
   * マウント時に既存ドラフトを読み込む。
   * ドラフトが存在しない、または structuredSoap が未設定なら null を返す。
   */
  const loadDraft = useCallback(async (): Promise<SoapDraftSnapshot | null> => {
    const draft = await offlineDb.visitDrafts.where('scheduleId').equals(scheduleId).first();
    if (!draft) return null;

    const structuredSoapPayload = await decryptOfflinePayload(draft?.structuredSoap);
    if (!structuredSoapPayload) return null;
    const structuredSoap = readStructuredSoapPayload(structuredSoapPayload);
    if (!structuredSoap) return null;

    const residualPayload = await decryptOfflinePayload(draft.residualMedications);
    const visitGeoLogPayload = await decryptOfflinePayload(draft.visitGeoLog);

    return {
      structuredSoap,
      currentStep: readCurrentStep(draft.currentStep),
      visitDate: readNullableString(draft.visitDate),
      outcomeStatus: readNullableString(draft.outcomeStatus),
      receiptPersonName: readNullableString(draft.receiptPersonName),
      receiptPersonRelation: readNullableString(draft.receiptPersonRelation),
      receiptAt: readNullableString(draft.receiptAt),
      nextVisitSuggestionDate: readNullableString(draft.nextVisitSuggestionDate),
      cancellationReason: readNullableString(draft.cancellationReason),
      postponeReason: readNullableString(draft.postponeReason),
      revisitReason: readNullableString(draft.revisitReason),
      residualMedications: readResidualMedicationsPayload(residualPayload),
      visitGeoLog: readVisitGeoLogPayload(visitGeoLogPayload),
    };
  }, [scheduleId]);

  /**
   * ステップ変更のたびにドラフトを保存する。
   * 既存レコードがあれば更新、なければ新規追加する。
   */
  const saveDraft = useCallback(
    async (
      soap: StructuredSoap,
      currentStep: number,
      metadata: SoapDraftMetadata = {},
    ): Promise<void> => {
      const structuredSoap = await encryptOfflinePayloadRequired(
        JSON.stringify(soap),
        'SOAP draft structuredSoap',
      );
      const residualMedications = await encryptOfflinePayloadRequired(
        JSON.stringify(metadata.residualMedications ?? []),
        'SOAP draft residualMedications',
      );
      const visitGeoLog = metadata.visitGeoLog
        ? await encryptOfflinePayloadRequired(
            JSON.stringify(metadata.visitGeoLog),
            'SOAP draft visitGeoLog',
          )
        : undefined;
      const draftPatch = {
        structuredSoap,
        currentStep,
        visitDate: metadata.visitDate,
        outcomeStatus: metadata.outcomeStatus,
        receiptPersonName: metadata.receiptPersonName,
        receiptPersonRelation: metadata.receiptPersonRelation,
        receiptAt: metadata.receiptAt,
        nextVisitSuggestionDate: metadata.nextVisitSuggestionDate,
        cancellationReason: metadata.cancellationReason,
        postponeReason: metadata.postponeReason,
        revisitReason: metadata.revisitReason,
        residualMedications,
        visitGeoLog,
        updatedAt: new Date(),
      } satisfies Partial<OfflineVisitDraft>;

      await offlineDb.transaction('rw', offlineDb.visitDrafts, async () => {
        const existing = await offlineDb.visitDrafts.where('scheduleId').equals(scheduleId).first();

        if (existing?.id !== undefined) {
          await offlineDb.visitDrafts.update(existing.id, (draft) => {
            Object.assign(draft, draftPatch);
            purgeLegacyPlaintextSoapDraftFields(
              draft as OfflineVisitDraft & LegacyPlaintextSoapDraftFields,
            );
          });
        } else {
          await offlineDb.visitDrafts.add({
            scheduleId,
            patientId,
            pharmacistId: '', // sync 時に補完
            ...draftPatch,
            createdAt: new Date(),
            synced: false,
          });
        }
      });
    },
    [patientId, scheduleId],
  );

  /**
   * 送信完了後にドラフトを削除する。
   */
  const clearDraft = useCallback(async (): Promise<void> => {
    await offlineDb.visitDrafts.where('scheduleId').equals(scheduleId).delete();
  }, [scheduleId]);

  return { loadDraft, saveDraft, clearDraft };
}
