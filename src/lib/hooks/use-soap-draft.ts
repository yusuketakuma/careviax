// ─── usesSoapDraft hook ────────────────────────────────────────────────────────
// 訪問記録ウィザードのオフライン自動保存フック。
// IndexedDB (Dexie) を使って structuredSoap と currentStep を永続化する。

import { offlineDb } from '@/lib/stores/offline-db';
import type { StructuredSoap } from '@/types/structured-soap';

export type SoapDraftSnapshot = {
  structuredSoap: StructuredSoap;
  currentStep: number;
};

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
  async function loadDraft(): Promise<SoapDraftSnapshot | null> {
    const draft = await offlineDb.visitDrafts
      .where('scheduleId')
      .equals(scheduleId)
      .first();

    if (!draft?.structuredSoap) return null;

    return {
      structuredSoap: JSON.parse(draft.structuredSoap) as StructuredSoap,
      currentStep: draft.currentStep ?? 0,
    };
  }

  /**
   * ステップ変更のたびにドラフトを保存する。
   * 既存レコードがあれば更新、なければ新規追加する。
   */
  async function saveDraft(soap: StructuredSoap, currentStep: number): Promise<void> {
    const existing = await offlineDb.visitDrafts
      .where('scheduleId')
      .equals(scheduleId)
      .first();

    if (existing?.id !== undefined) {
      await offlineDb.visitDrafts.update(existing.id, {
        structuredSoap: JSON.stringify(soap),
        currentStep,
        updatedAt: new Date(),
      });
    } else {
      await offlineDb.visitDrafts.add({
        scheduleId,
        patientId,
        pharmacistId: '', // sync 時に補完
        structuredSoap: JSON.stringify(soap),
        currentStep,
        createdAt: new Date(),
        updatedAt: new Date(),
        synced: false,
      });
    }
  }

  /**
   * 送信完了後にドラフトを削除する。
   */
  async function clearDraft(): Promise<void> {
    await offlineDb.visitDrafts.where('scheduleId').equals(scheduleId).delete();
  }

  return { loadDraft, saveDraft, clearDraft };
}
