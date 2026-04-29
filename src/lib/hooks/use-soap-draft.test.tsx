// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredSoap } from '@/types/structured-soap';

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
    visitDrafts: {
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

import { useSoapDraft } from './use-soap-draft';

const plaintextPhi = {
  subjective: '患者名 山田太郎: 強い眠気あり',
  objective: '血圧 160/92、残薬が多い',
  assessment: '降圧薬の副作用疑い',
  plan: '医師へ減量相談',
};

function makeStructuredSoap(): StructuredSoap {
  return {
    subjective: {
      symptom_checks: ['drowsiness'],
      free_text: plaintextPhi.subjective,
    },
    objective: {
      medication_status: 'partial_compliance',
      adherence_score: 2,
      side_effect_checks: ['drowsiness'],
      free_text: plaintextPhi.objective,
    },
    assessment: {
      problem_checks: ['adverse_event'],
      free_text: plaintextPhi.assessment,
    },
    plan: {
      intervention_checks: ['physician_consult'],
      free_text: plaintextPhi.plan,
    },
  };
}

function prepareVisitDraftQuery() {
  dbMocks.where.mockReturnValue({ equals: dbMocks.equals });
  dbMocks.equals.mockReturnValue({
    first: dbMocks.first,
    delete: dbMocks.deleteWhere,
  });
}

describe('useSoapDraft PHI persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareVisitDraftQuery();
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

  it('stores encrypted structured SOAP without plaintext duplicate S/O/A/P fields', async () => {
    const soap = makeStructuredSoap();
    const { result } = renderHook(() => useSoapDraft('schedule-1', 'patient-1'));

    await result.current.saveDraft(soap, 3, {
      residualMedications: [
        {
          drug_name: '高血圧薬A',
          remaining_quantity: 14,
          is_prohibited_reduction: false,
        },
      ],
    });

    expect(dbMocks.add).toHaveBeenCalledTimes(1);
    const stored = dbMocks.add.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(stored.structuredSoap).toBe('encv1:SOAP draft structuredSoap:sealed');
    expect(stored.residualMedications).toBe('encv1:SOAP draft residualMedications:sealed');
    expect(stored).not.toHaveProperty('soapSubjective');
    expect(stored).not.toHaveProperty('soapObjective');
    expect(stored).not.toHaveProperty('soapAssessment');
    expect(stored).not.toHaveProperty('soapPlan');

    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(plaintextPhi.subjective);
    expect(serialized).not.toContain(plaintextPhi.objective);
    expect(serialized).not.toContain(plaintextPhi.assessment);
    expect(serialized).not.toContain(plaintextPhi.plan);
  });

  it('purges legacy plaintext duplicate S/O/A/P fields when updating an existing draft', async () => {
    const soap = makeStructuredSoap();
    const existingDraft = {
      id: 7,
      scheduleId: 'schedule-1',
      patientId: 'patient-1',
      pharmacistId: '',
      structuredSoap: 'encv1:old',
      soapSubjective: plaintextPhi.subjective,
      soapObjective: plaintextPhi.objective,
      soapAssessment: plaintextPhi.assessment,
      soapPlan: plaintextPhi.plan,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      synced: false,
    };
    dbMocks.first.mockResolvedValue(existingDraft);
    dbMocks.update.mockImplementation(
      async (_id: number, updater: (draft: typeof existingDraft) => void) => {
        updater(existingDraft);
        return 1;
      },
    );
    const { result } = renderHook(() => useSoapDraft('schedule-1', 'patient-1'));

    await result.current.saveDraft(soap, 1);

    expect(dbMocks.update).toHaveBeenCalledWith(7, expect.any(Function));
    expect(existingDraft.structuredSoap).toBe('encv1:SOAP draft structuredSoap:sealed');
    expect(existingDraft).not.toHaveProperty('soapSubjective');
    expect(existingDraft).not.toHaveProperty('soapObjective');
    expect(existingDraft).not.toHaveProperty('soapAssessment');
    expect(existingDraft).not.toHaveProperty('soapPlan');
  });

  it('does not write a draft when required SOAP encryption is unavailable', async () => {
    const soap = makeStructuredSoap();
    cryptoMocks.encryptOfflinePayloadRequired.mockRejectedValue(
      Object.assign(new Error('missing offline encryption key'), {
        name: 'OfflineEncryptionUnavailableError',
      }),
    );
    const { result } = renderHook(() => useSoapDraft('schedule-1', 'patient-1'));

    await expect(result.current.saveDraft(soap, 0)).rejects.toMatchObject({
      name: 'OfflineEncryptionUnavailableError',
    });

    expect(dbMocks.add).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('restores display fields from decrypted encrypted structured SOAP', async () => {
    const soap = makeStructuredSoap();
    dbMocks.first.mockResolvedValue({
      id: 11,
      scheduleId: 'schedule-1',
      patientId: 'patient-1',
      pharmacistId: '',
      structuredSoap: 'encv1:structured-soap',
      residualMedications: 'encv1:residual-medications',
      currentStep: 4,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      synced: false,
    });
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:structured-soap') return JSON.stringify(soap);
        if (value === 'encv1:residual-medications') return JSON.stringify([]);
        return null;
      },
    );
    const { result } = renderHook(() => useSoapDraft('schedule-1', 'patient-1'));

    const draft = await result.current.loadDraft();

    expect(draft?.currentStep).toBe(4);
    expect(draft?.structuredSoap.subjective.free_text).toBe(plaintextPhi.subjective);
    expect(draft?.structuredSoap.objective.free_text).toBe(plaintextPhi.objective);
    expect(draft?.structuredSoap.assessment.free_text).toBe(plaintextPhi.assessment);
    expect(draft?.structuredSoap.plan.free_text).toBe(plaintextPhi.plan);
  });
});
