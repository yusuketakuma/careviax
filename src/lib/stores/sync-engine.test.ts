import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  where: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  decryptOfflinePayload: vi.fn(),
  encryptOfflinePayloadRequired: vi.fn(),
}));

vi.mock('@/lib/offline/crypto', () => ({
  decryptOfflinePayload: cryptoMocks.decryptOfflinePayload,
  encryptOfflinePayloadRequired: cryptoMocks.encryptOfflinePayloadRequired,
}));

vi.mock('./offline-db', () => ({
  offlineDb: {
    syncQueue: {
      add: dbMocks.add,
      update: dbMocks.update,
      delete: dbMocks.delete,
      where: dbMocks.where,
    },
    visitDrafts: {
      where: vi.fn(),
    },
  },
}));

import { enqueueForSync } from './sync-engine';

describe('sync-engine PHI persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cryptoMocks.encryptOfflinePayloadRequired.mockImplementation(
      async (_value: string, context: string) => `encv1:${context}:sealed`,
    );
    dbMocks.add.mockResolvedValue(1);
  });

  it('encrypts sync queue payloads with the fail-closed helper before writing', async () => {
    await enqueueForSync('visit_record', {
      schedule_id: 'schedule-1',
      soap_subjective: '患者名 山田太郎 強い眠気あり',
    });

    expect(cryptoMocks.encryptOfflinePayloadRequired).toHaveBeenCalledWith(
      expect.stringContaining('患者名 山田太郎'),
      'sync queue visit_record payload',
    );
    expect(dbMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'visit_record',
        payload: 'encv1:sync queue visit_record payload:sealed',
        scope_id: 'schedule-1',
      }),
    );
  });

  it('does not write PHI to the sync queue when encryption is unavailable', async () => {
    cryptoMocks.encryptOfflinePayloadRequired.mockRejectedValue(
      Object.assign(new Error('missing offline encryption key'), {
        name: 'OfflineEncryptionUnavailableError',
      }),
    );

    await expect(
      enqueueForSync('residual_medication', {
        patient_id: 'patient-1',
        drug_name: '高血圧薬A',
      }),
    ).rejects.toMatchObject({
      name: 'OfflineEncryptionUnavailableError',
    });

    expect(dbMocks.add).not.toHaveBeenCalled();
  });
});
