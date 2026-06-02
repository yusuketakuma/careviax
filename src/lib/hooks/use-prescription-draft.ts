// ─── usePrescriptionDraft hook ─────────────────────────────────────────────
// 処方受付フォームのオフライン自動保存フック。
// IndexedDB (Dexie) を使ってフォーム状態を永続化する。

import { useCallback } from 'react';
import { offlineDb } from '@/lib/stores/offline-db';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';

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

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPrescriptionCategory(value: unknown): 'regular' | 'emergency' {
  return value === 'emergency' ? 'emergency' : 'regular';
}

function readProposalOrigin(value: unknown): 'post_inquiry' | 'pre_issuance' {
  return value === 'pre_issuance' ? 'pre_issuance' : 'post_inquiry';
}

function readPatientSelection(
  value: unknown,
): PrescriptionDraftSnapshot['patientSelection'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    patientSearch: readString(object.patientSearch),
    selectedPatientId: readString(object.selectedPatientId),
    selectedPatientName: readString(object.selectedPatientName),
    selectedCaseId: readString(object.selectedCaseId),
  };
}

function readPrescriptionMeta(
  value: unknown,
): PrescriptionDraftSnapshot['prescriptionMeta'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    sourceType: readString(object.sourceType),
    prescribedDate: readString(object.prescribedDate),
    prescriberName: readString(object.prescriberName),
    selectedPrescriberInstitutionId: readString(object.selectedPrescriberInstitutionId),
    prescriberInstitution: readString(object.prescriberInstitution),
    refillRemainingCount: readString(object.refillRemainingCount),
    refillNextDispenseDate: readString(object.refillNextDispenseDate),
    splitDispenseTotal: readString(object.splitDispenseTotal),
    splitDispenseCurrent: readString(object.splitDispenseCurrent),
    splitNextDispenseDate: readString(object.splitNextDispenseDate),
    prescriptionCategory: readPrescriptionCategory(object.prescriptionCategory),
    emergencyCategory: readString(object.emergencyCategory),
  };
}

function readLine(value: unknown): PrescriptionDraftSnapshot['lines'][number] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.line_number !== 'number' || !Number.isFinite(object.line_number)) return null;
  if (typeof object.days !== 'number' || !Number.isFinite(object.days)) return null;

  return {
    line_number: object.line_number,
    drug_name: readString(object.drug_name),
    dose: readString(object.dose),
    frequency: readString(object.frequency),
    days: object.days,
    drug_code: readOptionalString(object.drug_code),
    dosage_form: readOptionalString(object.dosage_form),
    quantity: readOptionalNumber(object.quantity),
    unit: readOptionalString(object.unit),
    is_generic: typeof object.is_generic === 'boolean' ? object.is_generic : false,
    is_generic_name_prescription:
      typeof object.is_generic_name_prescription === 'boolean'
        ? object.is_generic_name_prescription
        : undefined,
    route: readOptionalString(object.route),
    dispensing_method: readOptionalString(object.dispensing_method),
    start_date: readOptionalString(object.start_date),
    end_date: readOptionalString(object.end_date),
    packaging_instructions: readOptionalString(object.packaging_instructions),
    notes: readOptionalString(object.notes),
  };
}

function readLines(value: unknown): PrescriptionDraftSnapshot['lines'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const line = readLine(item);
    return line ? [line] : [];
  });
}

function readInquiry(value: unknown): PrescriptionDraftSnapshot['inquiry'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  return {
    inquiryReason: readString(object.inquiryReason),
    inquiryToPhysician: readString(object.inquiryToPhysician),
    inquiryContent: readString(object.inquiryContent),
    inquiryDueDate: readString(object.inquiryDueDate),
    proposalOrigin: readProposalOrigin(object.proposalOrigin),
    residualAdjustment:
      typeof object.residualAdjustment === 'boolean' ? object.residualAdjustment : false,
  };
}

function readPrescriptionDraftSnapshot(payload: string): PrescriptionDraftSnapshot | null {
  const object = parseJsonObjectOrNull(payload);
  if (!object) return null;

  const patientSelection = readPatientSelection(object.patientSelection);
  const prescriptionMeta = readPrescriptionMeta(object.prescriptionMeta);
  const inquiry = readInquiry(object.inquiry);
  if (!patientSelection || !prescriptionMeta || !inquiry) return null;

  return {
    patientSelection,
    prescriptionMeta,
    lines: readLines(object.lines),
    inquiry,
  };
}

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

    return readPrescriptionDraftSnapshot(decrypted);
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
