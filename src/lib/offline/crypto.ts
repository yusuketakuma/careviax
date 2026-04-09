const OFFLINE_ENCRYPTION_PREFIX = 'encv1:';
const AES_GCM_IV_LENGTH = 12;

// IndexedDB settings for key storage
const IDB_DB_NAME = 'careviax-offline-keys';
const IDB_DB_VERSION = 1;
const IDB_STORE_NAME = 'crypto-keys';
const IDB_KEY_RECORD_ID = 'offline-enc-key-v2';

// Salt stored in localStorage (salt is not secret; only raw key bytes must be protected)
const OFFLINE_SALT_STORAGE_KEY = 'careviax.offline.salt.v2';

// OWASP recommends 600,000 iterations for PBKDF2-SHA-256 (2023 guidance).
// 100,000 is chosen here as a practical balance for browser performance on
// low-end mobile devices used in home-visit scenarios.
const PBKDF2_ITERATIONS = 100_000;

function getOfflineCryptoApi() {
  if (typeof window === 'undefined') return null;
  return window.crypto?.subtle ? window.crypto : null;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

async function putKeyInIndexedDB(key: CryptoKey): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(key, IDB_KEY_RECORD_ID);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getKeyFromIndexedDB(): Promise<CryptoKey | null> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).get(IDB_KEY_RECORD_ID);
    req.onsuccess = () => { db.close(); resolve((req.result as CryptoKey | undefined) ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function deleteKeyFromIndexedDB(): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).delete(IDB_KEY_RECORD_ID);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function getOrCreateSalt(cryptoApi: Crypto): Uint8Array {
  const stored = localStorage.getItem(OFFLINE_SALT_STORAGE_KEY);
  if (stored) return base64ToBytes(stored);
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  localStorage.setItem(OFFLINE_SALT_STORAGE_KEY, bytesToBase64(salt));
  return salt;
}

async function deriveKeyFromUserId(userId: string, salt: Uint8Array, cryptoApi: Crypto, sessionSecret?: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const normalizedSalt = Uint8Array.from(salt);
  // If a server-issued sessionSecret is provided, combine it with userId for
  // higher entropy key material. Falls back to userId alone for backward compat.
  const keyInput = sessionSecret ? `${userId}:${sessionSecret}` : userId;
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    enc.encode(keyInput),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return cryptoApi.subtle.deriveKey(
    { name: 'PBKDF2', salt: normalizedSalt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false — raw key bytes cannot be exported via JS
    ['encrypt', 'decrypt']
  );
}

/**
 * Initialize the offline encryption key from the user's identity.
 * Must be called after login before any offline PHI can be encrypted/decrypted.
 * The derived CryptoKey is stored in IndexedDB with extractable:false.
 *
 * @param userId - Cognito user ID (required)
 * @param sessionSecret - Optional server-issued secret to increase key entropy
 */
export async function initOfflineEncryptionKey(userId: string, sessionSecret?: string): Promise<void> {
  const cryptoApi = getOfflineCryptoApi();
  if (!cryptoApi || typeof window === 'undefined') return;
  try {
    const salt = getOrCreateSalt(cryptoApi);
    const key = await deriveKeyFromUserId(userId, salt, cryptoApi, sessionSecret);
    await putKeyInIndexedDB(key);
  } catch {
    // Non-fatal: offline encryption degrades gracefully if init fails
  }
}

/**
 * Remove the offline encryption key from IndexedDB.
 * Must be called on logout to ensure PHI cannot be decrypted without re-authentication.
 */
export async function clearOfflineEncryptionKey(): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    await deleteKeyFromIndexedDB();
    localStorage.removeItem(OFFLINE_SALT_STORAGE_KEY);
  } catch {
    // best effort
  }
}

async function getOfflineEncryptionKey(): Promise<CryptoKey | null> {
  const cryptoApi = getOfflineCryptoApi();
  if (!cryptoApi || typeof window === 'undefined') return null;
  try {
    return await getKeyFromIndexedDB();
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

export async function decryptOfflinePayload(value: string | null | undefined) {
  if (!value || !value.startsWith(OFFLINE_ENCRYPTION_PREFIX)) return value;

  const cryptoApi = getOfflineCryptoApi();
  const key = await getOfflineEncryptionKey();
  if (!cryptoApi || !key) return null;

  try {
    const bytes = base64ToBytes(value.slice(OFFLINE_ENCRYPTION_PREFIX.length));
    const iv = bytes.slice(0, AES_GCM_IV_LENGTH);
    const ciphertext = bytes.slice(AES_GCM_IV_LENGTH);
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
