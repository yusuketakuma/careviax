// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrescriptionDraftSnapshot } from './use-prescription-draft';

const dbMocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  first: vi.fn(),
  deleteWhere: vi.fn(),
  equals: vi.fn(),
  where: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  decryptOfflinePayload: vi.fn(),
  encryptOfflinePayloadRequired: vi.fn(),
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    prescriptionDrafts: {
      add: dbMocks.add,
      update: dbMocks.update,
      where: dbMocks.where,
    },
  },
}));

vi.mock('@/lib/offline/crypto', () => ({
  decryptOfflinePayload: cryptoMocks.decryptOfflinePayload,
  encryptOfflinePayloadRequired: cryptoMocks.encryptOfflinePayloadRequired,
}));

import { usePrescriptionDraft } from './use-prescription-draft';

function makeSnapshot(): PrescriptionDraftSnapshot {
  return {
    patientSelection: {
      patientSearch: '山田',
      selectedPatientId: 'patient-1',
      selectedPatientName: '患者 山田太郎',
      selectedCaseId: 'case-1',
    },
    prescriptionMeta: {
      sourceType: 'paper',
      prescribedDate: '2026-04-28',
      prescriberName: '医師 花子',
      selectedPrescriberInstitutionId: 'institution-1',
      prescriberInstitution: '在宅クリニック',
      refillRemainingCount: '',
      refillNextDispenseDate: '',
      splitDispenseTotal: '',
      splitDispenseCurrent: '',
      splitNextDispenseDate: '',
      prescriptionCategory: 'regular',
      emergencyCategory: '',
    },
    lines: [
      {
        line_number: 1,
        drug_name: '高血圧薬A',
        dose: '1錠',
        frequency: '朝食後',
        days: 14,
        is_generic: false,
      },
    ],
    inquiry: {
      inquiryReason: '',
      inquiryToPhysician: '',
      inquiryContent: '',
      inquiryDueDate: '',
      proposalOrigin: 'post_inquiry',
      residualAdjustment: false,
    },
  };
}

function preparePrescriptionDraftQuery() {
  dbMocks.where.mockReturnValue({ equals: dbMocks.equals });
  dbMocks.equals.mockReturnValue({
    first: dbMocks.first,
    delete: dbMocks.deleteWhere,
  });
}

describe('usePrescriptionDraft PHI persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preparePrescriptionDraftQuery();
    dbMocks.add.mockResolvedValue(1);
    dbMocks.update.mockResolvedValue(1);
    dbMocks.deleteWhere.mockResolvedValue(1);
    dbMocks.first.mockResolvedValue(undefined);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => value ?? null,
    );
    cryptoMocks.encryptOfflinePayloadRequired.mockImplementation(
      async (_value: string, context: string) => `encv1:${context}:sealed`,
    );
  });

  it('stores prescription drafts only through the fail-closed encryption helper', async () => {
    const snapshot = makeSnapshot();
    const { result } = renderHook(() => usePrescriptionDraft('org-1'));

    await result.current.saveDraft(snapshot);

    expect(cryptoMocks.encryptOfflinePayloadRequired).toHaveBeenCalledWith(
      expect.stringContaining('患者 山田太郎'),
      'prescription draft payload',
    );
    expect(dbMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        payload: 'encv1:prescription draft payload:sealed',
      }),
    );
  });

  it('does not write prescription drafts when encryption is unavailable', async () => {
    cryptoMocks.encryptOfflinePayloadRequired.mockRejectedValue(
      Object.assign(new Error('missing offline encryption key'), {
        name: 'OfflineEncryptionUnavailableError',
      }),
    );
    const { result } = renderHook(() => usePrescriptionDraft('org-1'));

    await expect(result.current.saveDraft(makeSnapshot())).rejects.toMatchObject({
      name: 'OfflineEncryptionUnavailableError',
    });

    expect(dbMocks.add).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });
});
