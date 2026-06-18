import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('voice memo offline drafts Dexie transaction', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/offline/crypto', () => ({
      decryptOfflinePayload: vi.fn(async (value: string | null | undefined) => value ?? null),
      encryptOfflinePayloadRequired: vi.fn(async (value: string) => `encv1:${value}`),
    }));
    await indexedDB.deleteDatabase('PH-OSOffline');
  });

  afterEach(async () => {
    const { offlineDb } = await import('@/lib/stores/offline-db');
    offlineDb.close();
    vi.doUnmock('@/lib/offline/crypto');
    await indexedDB.deleteDatabase('PH-OSOffline');
  });

  it('keeps the previous voice memo when replacement add fails inside the transaction', async () => {
    const { offlineDb } = await import('@/lib/stores/offline-db');
    const { saveVoiceMemoDraft } = await import('./voice-memo-drafts');
    await offlineDb.open();
    await offlineDb.voiceMemoDrafts.add({
      visitId: 'visit-1',
      fileName: 'old.webm',
      mimeType: 'audio/webm',
      sizeBytes: 512,
      payload: 'encv1:old-audio',
      durationSeconds: 5,
      recordedAt: new Date('2026-06-18T09:00:00.000Z'),
      createdAt: new Date('2026-06-18T09:00:00.000Z'),
      transcriptStatus: 'pending',
    });
    vi.spyOn(offlineDb.voiceMemoDrafts, 'add').mockRejectedValueOnce(new Error('add failed'));

    await expect(
      saveVoiceMemoDraft({
        visitId: 'visit-1',
        fileName: 'new.webm',
        mimeType: 'audio/webm',
        sizeBytes: 1024,
        dataUrl: 'data:audio/webm;base64,NEW_AUDIO',
        durationSeconds: 12,
        recordedAt: new Date('2026-06-18T10:00:00.000Z'),
      }),
    ).rejects.toThrow('add failed');

    await expect(
      offlineDb.voiceMemoDrafts.where('visitId').equals('visit-1').toArray(),
    ).resolves.toEqual([
      expect.objectContaining({
        visitId: 'visit-1',
        fileName: 'old.webm',
        payload: 'encv1:old-audio',
      }),
    ]);
  });
});
