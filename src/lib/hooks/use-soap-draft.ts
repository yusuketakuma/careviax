// ─── usesSoapDraft hook ────────────────────────────────────────────────────────
// 訪問記録ウィザードのオフライン自動保存フック。
// IndexedDB (Dexie) を使って structuredSoap と currentStep を永続化する。

import { useCallback } from 'react';
import { offlineDb, type OfflineVisitDraft } from '@/lib/stores/offline-db';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import type { StructuredSoap } from '@/types/structured-soap';
import type { VisitGeoLog } from '@/lib/visit-location';

export type SoapDraftResidualMedication = {
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

type LegacyPlaintextSoapDraftFields = {
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
};

function purgeLegacyPlaintextSoapDraftFields(
  draft: OfflineVisitDraft & LegacyPlaintextSoapDraftFields,
) {
  delete draft.soapSubjective;
  delete draft.soapObjective;
  delete draft.soapAssessment;
  delete draft.soapPlan;
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

    const residualPayload = await decryptOfflinePayload(draft.residualMedications);
    const visitGeoLogPayload = await decryptOfflinePayload(draft.visitGeoLog);

    return {
      structuredSoap: JSON.parse(structuredSoapPayload) as StructuredSoap,
      currentStep: draft.currentStep ?? 0,
      visitDate: draft.visitDate ?? null,
      outcomeStatus: draft.outcomeStatus ?? null,
      receiptPersonName: draft.receiptPersonName ?? null,
      receiptPersonRelation: draft.receiptPersonRelation ?? null,
      receiptAt: draft.receiptAt ?? null,
      nextVisitSuggestionDate: draft.nextVisitSuggestionDate ?? null,
      cancellationReason: draft.cancellationReason ?? null,
      postponeReason: draft.postponeReason ?? null,
      revisitReason: draft.revisitReason ?? null,
      residualMedications: residualPayload
        ? (JSON.parse(residualPayload) as SoapDraftResidualMedication[])
        : [],
      visitGeoLog: visitGeoLogPayload ? (JSON.parse(visitGeoLogPayload) as VisitGeoLog) : null,
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
      const existing = await offlineDb.visitDrafts.where('scheduleId').equals(scheduleId).first();

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
