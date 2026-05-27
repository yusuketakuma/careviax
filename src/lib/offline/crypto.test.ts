import 'fake-indexeddb/auto';

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOfflineEncryptionKey,
  decryptOfflinePayload,
  encryptOfflinePayloadRequired,
  initOfflineEncryptionKey,
  isEncryptedOfflinePayload,
  isOfflineEncryptionUnavailableError,
} from './crypto';

function installBrowserCryptoEnvironment() {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: webcrypto,
      indexedDB,
    },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });

  return { localStorageMock };
}

describe('offline PHI encryption guard', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await indexedDB.deleteDatabase('ph-os-offline-keys');
  });

  afterEach(async () => {
    await clearOfflineEncryptionKey();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('fails closed instead of returning plaintext when encryption is unavailable', async () => {
    const plaintextPhi = '患者名 山田太郎 SOAP S: 強い眠気あり';

    await expect(
      encryptOfflinePayloadRequired(plaintextPhi, 'SOAP draft structuredSoap'),
    ).rejects.toMatchObject({
      name: 'OfflineEncryptionUnavailableError',
    });

    try {
      await encryptOfflinePayloadRequired(plaintextPhi, 'SOAP draft structuredSoap');
    } catch (error) {
      expect(isOfflineEncryptionUnavailableError(error)).toBe(true);
    }
  });

  it('encrypts and decrypts PHI with the initialized key without repeated IndexedDB key reads', async () => {
    installBrowserCryptoEnvironment();
    const openSpy = vi.spyOn(indexedDB, 'open');
    const plaintextPhi = '患者名 山田太郎 SOAP S: 強い眠気あり';

    await initOfflineEncryptionKey('user-1', 'session-secret');
    const openCallsAfterInit = openSpy.mock.calls.length;

    const encrypted = await encryptOfflinePayloadRequired(
      plaintextPhi,
      'SOAP draft structuredSoap',
    );
    const decrypted = await decryptOfflinePayload(encrypted);

    expect(isEncryptedOfflinePayload(encrypted)).toBe(true);
    expect(encrypted).not.toContain(plaintextPhi);
    expect(decrypted).toBe(plaintextPhi);
    expect(openSpy.mock.calls.length).toBe(openCallsAfterInit);
  });
});
