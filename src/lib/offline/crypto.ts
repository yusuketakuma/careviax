import { base64ToBytes, bytesToBase64 } from '@/lib/utils/base64';

const OFFLINE_ENCRYPTION_PREFIX = 'encv1:';
const AES_GCM_IV_LENGTH = 12;

// IndexedDB settings for key storage
const IDB_DB_NAME = 'ph-os-offline-keys';
const IDB_DB_VERSION = 1;
const IDB_STORE_NAME = 'crypto-keys';
const LEGACY_IDB_KEY_RECORD_ID = 'offline-enc-key-v2';
const IDB_KEY_RECORD_PREFIX = 'offline-enc-key-v3:';
let cachedOfflineEncryptionKey: CryptoKey | null = null;
let cachedOfflineEncryptionKeyUserId: string | null = null;

export class OfflineEncryptionUnavailableError extends Error {
  constructor(context: string) {
    super(`${context} could not be encrypted for offline storage`);
    this.name = 'OfflineEncryptionUnavailableError';
  }
}

export function isEncryptedOfflinePayload(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith(OFFLINE_ENCRYPTION_PREFIX));
}

export function isOfflineEncryptionUnavailableError(
  error: unknown,
): error is OfflineEncryptionUnavailableError {
  return (
    error instanceof OfflineEncryptionUnavailableError ||
    (error instanceof Error && error.name === 'OfflineEncryptionUnavailableError')
  );
}

function getOfflineCryptoApi() {
  if (typeof window === 'undefined') return null;
  return window.crypto?.subtle ? window.crypto : null;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyRecordId(userId: string): string {
  return `${IDB_KEY_RECORD_PREFIX}${userId}`;
}

async function putKeyInIndexedDB(userId: string, key: CryptoKey): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(key, keyRecordId(userId));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getKeyFromIndexedDB(userId: string): Promise<CryptoKey | null> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).get(keyRecordId(userId));
    req.onsuccess = () => {
      db.close();
      resolve((req.result as CryptoKey | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function deleteKeyFromIndexedDB(): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    store.delete(LEGACY_IDB_KEY_RECORD_ID);
    store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function generateOfflineEncryptionKey(cryptoApi: Crypto): Promise<CryptoKey> {
  return cryptoApi.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Initialize the offline encryption key for the authenticated user.
 * Must be called after login before any offline PHI can be encrypted/decrypted.
 * The CryptoKey is generated in-browser and stored in IndexedDB with extractable:false.
 *
 * @param userId - Cognito user ID (required)
 */
export async function initOfflineEncryptionKey(userId: string): Promise<void> {
  const cryptoApi = getOfflineCryptoApi();
  if (!cryptoApi || typeof window === 'undefined') return;
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    await clearOfflineEncryptionKey();
    return;
  }
  try {
    const existingKey = await getKeyFromIndexedDB(normalizedUserId);
    const key = existingKey ?? (await generateOfflineEncryptionKey(cryptoApi));
    if (!existingKey) await putKeyInIndexedDB(normalizedUserId, key);
    cachedOfflineEncryptionKey = key;
    cachedOfflineEncryptionKeyUserId = normalizedUserId;
  } catch {
    // Non-fatal: offline encryption degrades gracefully if init fails
  }
}

/**
 * Remove the offline encryption key from IndexedDB.
 * Must be called on logout to ensure PHI cannot be decrypted without re-authentication.
 */
export async function clearOfflineEncryptionKey(): Promise<void> {
  cachedOfflineEncryptionKey = null;
  cachedOfflineEncryptionKeyUserId = null;
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    await deleteKeyFromIndexedDB();
  } catch {
    // best effort
  }
}

async function getOfflineEncryptionKey(): Promise<CryptoKey | null> {
  const cryptoApi = getOfflineCryptoApi();
  if (!cryptoApi || typeof window === 'undefined') return null;
  if (cachedOfflineEncryptionKey) return cachedOfflineEncryptionKey;
  try {
    if (!cachedOfflineEncryptionKeyUserId) return null;
    cachedOfflineEncryptionKey = await getKeyFromIndexedDB(cachedOfflineEncryptionKeyUserId);
    return cachedOfflineEncryptionKey;
  } catch {
    return null;
  }
}

export async function encryptOfflinePayload(value: string) {
  if (!value || value.startsWith(OFFLINE_ENCRYPTION_PREFIX)) return value;

  const cryptoApi = getOfflineCryptoApi();
  const key = await getOfflineEncryptionKey();
  if (!cryptoApi || !key) return value;

  const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  const encoded = new TextEncoder().encode(value);
  const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return `${OFFLINE_ENCRYPTION_PREFIX}${bytesToBase64(combined)}`;
}

export async function encryptOfflinePayloadRequired(value: string, context: string) {
  const encrypted = await encryptOfflinePayload(value);
  if (!encrypted || isEncryptedOfflinePayload(encrypted)) return encrypted;
  throw new OfflineEncryptionUnavailableError(context);
}

export async function decryptOfflinePayload(value: string | null | undefined) {
  if (!value || !value.startsWith(OFFLINE_ENCRYPTION_PREFIX)) return value;

  const cryptoApi = getOfflineCryptoApi();
  const key = await getOfflineEncryptionKey();
  if (!cryptoApi || !key) return null;

  try {
    const bytes = base64ToBytes(value.slice(OFFLINE_ENCRYPTION_PREFIX.length));
    const iv = bytes.slice(0, AES_GCM_IV_LENGTH);
    const ciphertext = bytes.slice(AES_GCM_IV_LENGTH);
    const plaintext = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
