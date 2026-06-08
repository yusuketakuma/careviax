import 'fake-indexeddb/auto';

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionCode } from '@/phos/contracts/phos_contracts';
import {
  clearOfflineEncryptionKey,
  decryptOfflinePayload,
  initOfflineEncryptionKey,
  isEncryptedOfflinePayload,
} from '@/lib/offline/crypto';
import { enqueuePhosOfflineCardAction, phosOfflineActionDb } from './offlineActionQueue';

function installBrowserCryptoEnvironment() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: webcrypto,
      indexedDB,
    },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    },
  });
}

describe('PH-OS offline action queue', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    installBrowserCryptoEnvironment();
    await indexedDB.deleteDatabase('ph-os-offline-keys');
    await indexedDB.deleteDatabase('PH-OSActionOfflineQueue');
    await initOfflineEncryptionKey('user-1', 'session-secret');
    await phosOfflineActionDb.open();
  });

  afterEach(async () => {
    await clearOfflineEncryptionKey();
    phosOfflineActionDb.close();
    await indexedDB.deleteDatabase('PH-OSActionOfflineQueue');
    await indexedDB.deleteDatabase('ph-os-offline-keys');
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('stores card action payloads encrypted for later PH-OS API Gateway sync', async () => {
    const request = {
      action_code: ActionCode.CANCEL_CARD,
      idempotency_key: 'idem_cancel_1',
      client_version: 4,
      reason_code: 'PATIENT_REQUEST',
      reason_note: '患者 山田太郎からの中止依頼',
    };

    const queued = await enqueuePhosOfflineCardAction({
      card_id: 'card_1',
      request,
      offline_op_class: 'BLOCKING',
    });

    const record = await phosOfflineActionDb.offlineActions.get(Number(queued.queue_id));
    expect(record).toMatchObject({
      operation: 'CARD_ACTION',
      card_id: 'card_1',
      action_code: ActionCode.CANCEL_CARD,
      idempotency_key: 'idem_cancel_1',
      offline_op_class: 'BLOCKING',
      retry_count: 0,
    });
    expect(isEncryptedOfflinePayload(record?.payload)).toBe(true);
    expect(record?.payload).not.toContain('山田太郎');
    expect(await decryptOfflinePayload(record?.payload)).toBe(
      JSON.stringify({ card_id: 'card_1', request }),
    );
  });

  it('reuses the queued item for duplicate idempotency keys', async () => {
    const input = {
      card_id: 'card_1',
      request: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_same',
        client_version: 1,
      },
      offline_op_class: 'NON_BLOCKING' as const,
    };

    const first = await enqueuePhosOfflineCardAction(input);
    const second = await enqueuePhosOfflineCardAction(input);

    expect(second.queue_id).toBe(first.queue_id);
    expect(await phosOfflineActionDb.offlineActions.count()).toBe(1);
  });
});
