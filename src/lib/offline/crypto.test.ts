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
    const plaintextPhi = 'OFFLINE_ENCRYPTION_SENTINEL::SOAP_DRAFT::SYMPTOM_SLEEPINESS';

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

  it('does not initialize encryption without an authenticated user identity', async () => {
    installBrowserCryptoEnvironment();
    const plaintextPhi = 'OFFLINE_ENCRYPTION_SENTINEL::SOAP_DRAFT::SYMPTOM_SLEEPINESS';

    await initOfflineEncryptionKey('');

    await expect(
      encryptOfflinePayloadRequired(plaintextPhi, 'SOAP draft structuredSoap'),
    ).rejects.toMatchObject({
      name: 'OfflineEncryptionUnavailableError',
    });
  });

  it('encrypts and decrypts PHI with the initialized key without repeated IndexedDB key reads', async () => {
    const { localStorageMock } = installBrowserCryptoEnvironment();
    const openSpy = vi.spyOn(indexedDB, 'open');
    const plaintextPhi = 'OFFLINE_ENCRYPTION_SENTINEL::SOAP_DRAFT::SYMPTOM_SLEEPINESS';

    await initOfflineEncryptionKey('user-1');
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
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorageMock.setItem.mock.calls)).not.toContain('user-1');
  });

  it('encrypts and decrypts large offline PHI across base64 chunk boundaries', async () => {
    installBrowserCryptoEnvironment();
    await initOfflineEncryptionKey('user-large-payload');
    const largePrefix = Array.from({ length: 0x8000 * 4 + 257 }, (_, index) =>
      String.fromCharCode(32 + (index % 95)),
    ).join('');
    const plaintextPhi = `${largePrefix}\nOFFLINE_ENCRYPTION_SENTINEL::SOAP_DRAFT::SYMPTOM_SLEEPINESS`;

    const encrypted = await encryptOfflinePayloadRequired(
      plaintextPhi,
      'large SOAP draft structuredSoap',
    );
    const decrypted = await decryptOfflinePayload(encrypted);

    expect(isEncryptedOfflinePayload(encrypted)).toBe(true);
    expect(encrypted).not.toContain('OFFLINE_ENCRYPTION_SENTINEL');
    expect(decrypted).toBe(plaintextPhi);
  });
});
