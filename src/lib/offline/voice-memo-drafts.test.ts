import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  add: vi.fn(),
  deleteWhere: vi.fn(),
  equals: vi.fn(),
  toArray: vi.fn(),
  transaction: vi.fn(),
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

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    transaction: dbMocks.transaction,
    voiceMemoDrafts: {
      add: dbMocks.add,
      where: dbMocks.where,
    },
  },
}));

import { loadLatestVoiceMemoDraft, saveVoiceMemoDraft } from './voice-memo-drafts';

function prepareVoiceMemoQuery() {
  dbMocks.where.mockReturnValue({ equals: dbMocks.equals });
  dbMocks.equals.mockReturnValue({
    delete: dbMocks.deleteWhere,
    toArray: dbMocks.toArray,
  });
}

describe('voice memo offline drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareVoiceMemoQuery();
    dbMocks.add.mockResolvedValue(1);
    dbMocks.deleteWhere.mockResolvedValue(1);
    dbMocks.toArray.mockResolvedValue([]);
    dbMocks.transaction.mockImplementation(
      async (_mode: string, _table: unknown, callback: () => Promise<unknown>) => callback(),
    );
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => value ?? null,
    );
    cryptoMocks.encryptOfflinePayloadRequired.mockImplementation(
      async (_value: string, context: string) => `encv1:${context}:sealed`,
    );
  });

  it('stores voice memo drafts only through the fail-closed encryption helper', async () => {
    await saveVoiceMemoDraft({
      visitId: 'visit-1',
      fileName: 'memo.webm',
      mimeType: 'audio/webm',
      sizeBytes: 1024,
      dataUrl: 'data:audio/webm;base64,PHI_AUDIO',
      durationSeconds: 12,
      recordedAt: new Date('2026-06-18T10:00:00.000Z'),
    });

    expect(cryptoMocks.encryptOfflinePayloadRequired).toHaveBeenCalledWith(
      'data:audio/webm;base64,PHI_AUDIO',
      'voice memo draft payload',
    );
    expect(dbMocks.transaction).toHaveBeenCalledWith(
      'rw',
      expect.objectContaining({
        add: dbMocks.add,
        where: dbMocks.where,
      }),
      expect.any(Function),
    );
    expect(dbMocks.deleteWhere).toHaveBeenCalledTimes(1);
    expect(dbMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: 'visit-1',
        fileName: 'memo.webm',
        mimeType: 'audio/webm',
        payload: 'encv1:voice memo draft payload:sealed',
        transcriptStatus: 'pending',
      }),
    );
    expect(JSON.stringify(dbMocks.add.mock.calls[0]?.[0])).not.toContain('PHI_AUDIO');
  });

  it('does not replace an existing voice memo draft when encryption is unavailable', async () => {
    cryptoMocks.encryptOfflinePayloadRequired.mockRejectedValue(
      Object.assign(new Error('missing offline encryption key'), {
        name: 'OfflineEncryptionUnavailableError',
      }),
    );

    await expect(
      saveVoiceMemoDraft({
        visitId: 'visit-1',
        fileName: 'memo.webm',
        mimeType: 'audio/webm',
        sizeBytes: 1024,
        dataUrl: 'data:audio/webm;base64,PHI_AUDIO',
        durationSeconds: 12,
        recordedAt: new Date('2026-06-18T10:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ name: 'OfflineEncryptionUnavailableError' });

    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(dbMocks.deleteWhere).not.toHaveBeenCalled();
    expect(dbMocks.add).not.toHaveBeenCalled();
  });

  it('loads the latest decrypted voice memo draft as a playback snapshot', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 1,
        visitId: 'visit-1',
        fileName: 'old.webm',
        mimeType: 'audio/webm',
        sizeBytes: 512,
        payload: 'encv1:old',
        durationSeconds: 5,
        recordedAt: new Date('2026-06-18T09:00:00.000Z'),
        createdAt: new Date('2026-06-18T09:00:00.000Z'),
        transcriptStatus: 'pending',
      },
      {
        id: 2,
        visitId: 'visit-1',
        fileName: 'new.webm',
        mimeType: 'audio/webm',
        sizeBytes: 1024,
        payload: 'encv1:new',
        durationSeconds: 12,
        recordedAt: new Date('2026-06-18T10:00:00.000Z'),
        createdAt: new Date('2026-06-18T10:00:00.000Z'),
        transcriptStatus: 'pending',
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:new') return 'data:audio/webm;base64,NEW_AUDIO';
        if (value === 'encv1:old') return 'data:audio/webm;base64,OLD_AUDIO';
        return null;
      },
    );

    await expect(loadLatestVoiceMemoDraft('visit-1')).resolves.toEqual({
      dataUrl: 'data:audio/webm;base64,NEW_AUDIO',
      fileName: 'new.webm',
      mimeType: 'audio/webm',
      durationSeconds: 12,
      recordedAt: '2026-06-18T10:00:00.000Z',
    });
  });

  it('returns null when the latest voice memo payload cannot be decrypted', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 2,
        visitId: 'visit-1',
        fileName: 'new.webm',
        mimeType: 'audio/webm',
        sizeBytes: 1024,
        payload: 'encv1:new',
        durationSeconds: 12,
        recordedAt: new Date('2026-06-18T10:00:00.000Z'),
        createdAt: new Date('2026-06-18T10:00:00.000Z'),
        transcriptStatus: 'pending',
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockResolvedValue(null);

    await expect(loadLatestVoiceMemoDraft('visit-1')).resolves.toBeNull();
  });
});
