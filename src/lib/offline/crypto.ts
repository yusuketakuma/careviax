const OFFLINE_ENCRYPTION_PREFIX = 'encv1:';
const OFFLINE_KEY_STORAGE_KEY = 'careviax.offline.key.v1';
const AES_GCM_IV_LENGTH = 12;

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

async function getOfflineEncryptionKey() {
  const cryptoApi = getOfflineCryptoApi();
  if (!cryptoApi || typeof window === 'undefined') return null;

  const stored = window.localStorage.getItem(OFFLINE_KEY_STORAGE_KEY);
  const keyBytes = stored
    ? base64ToBytes(stored)
    : (() => {
        const generated = cryptoApi.getRandomValues(new Uint8Array(32));
        window.localStorage.setItem(OFFLINE_KEY_STORAGE_KEY, bytesToBase64(generated));
        return generated;
      })();

  return cryptoApi.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
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
