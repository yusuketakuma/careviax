// ─── usePrescriptionDraft hook ─────────────────────────────────────────────
// 処方受付フォームのオフライン自動保存フック。
// IndexedDB (Dexie) を使ってフォーム状態を永続化する。

import { useCallback } from 'react';
import { offlineDb } from '@/lib/stores/offline-db';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';

export type PrescriptionDraftSnapshot = {
  patientSelection: {
    patientSearch: string;
    selectedPatientId: string;
    selectedPatientName: string;
    selectedCaseId: string;
  };
  prescriptionMeta: {
    sourceType: string;
    prescribedDate: string;
    prescriberName: string;
    selectedPrescriberInstitutionId: string;
    prescriberInstitution: string;
    refillRemainingCount: string;
    refillNextDispenseDate: string;
    splitDispenseTotal: string;
    splitDispenseCurrent: string;
    splitNextDispenseDate: string;
    prescriptionCategory: 'regular' | 'emergency';
    emergencyCategory: string;
  };
  lines: Array<{
    line_number: number;
    drug_name: string;
    dose: string;
    frequency: string;
    days: number;
    drug_code?: string;
    dosage_form?: string;
    quantity?: number;
    unit?: string;
    is_generic: boolean;
    is_generic_name_prescription?: boolean;
    route?: string;
    dispensing_method?: string;
    start_date?: string;
    end_date?: string;
    packaging_instructions?: string;
    notes?: string;
  }>;
  inquiry: {
    inquiryReason: string;
    inquiryToPhysician: string;
    inquiryContent: string;
    inquiryDueDate: string;
    proposalOrigin: 'post_inquiry' | 'pre_issuance';
    residualAdjustment: boolean;
  };
};

/**
 * 処方受付フォームのドラフトを読み書きするフック。
 * org ごとに1件のドラフトを保持する。
 */
export function usePrescriptionDraft(orgId: string) {
  const loadDraft = useCallback(async (): Promise<PrescriptionDraftSnapshot | null> => {
    if (!orgId) return null;
    const draft = await offlineDb.prescriptionDrafts.where('orgId').equals(orgId).first();
    if (!draft) return null;

    const decrypted = await decryptOfflinePayload(draft.payload);
    if (!decrypted) return null;

    return JSON.parse(decrypted) as PrescriptionDraftSnapshot;
  }, [orgId]);

  const saveDraft = useCallback(
    async (snapshot: PrescriptionDraftSnapshot): Promise<void> => {
      if (!orgId) return;
      const payload = await encryptOfflinePayloadRequired(
        JSON.stringify(snapshot),
        'prescription draft payload',
      );
      const existing = await offlineDb.prescriptionDrafts.where('orgId').equals(orgId).first();

      if (existing?.id !== undefined) {
        await offlineDb.prescriptionDrafts.update(existing.id, {
          payload,
          updatedAt: new Date(),
        });
      } else {
        await offlineDb.prescriptionDrafts.add({
          orgId,
          payload,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    },
    [orgId],
  );

  const clearDraft = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    await offlineDb.prescriptionDrafts.where('orgId').equals(orgId).delete();
  }, [orgId]);

  return { loadDraft, saveDraft, clearDraft };
}
