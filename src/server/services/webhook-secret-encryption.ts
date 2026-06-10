import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getSecret } from '@/lib/config/secrets';

const WEBHOOK_SECRET_ALGORITHM = 'aes-256-gcm';
const WEBHOOK_SECRET_IV_BYTES = 12;
const WEBHOOK_SECRET_AUTH_TAG_BYTES = 16;
const DEFAULT_KEY_ID = 'app:ENCRYPTION_KEY:v1';

export type EncryptedWebhookSecretFields = {
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  secret_key_id: string;
  secret_algorithm: typeof WEBHOOK_SECRET_ALGORITHM;
};

export type WebhookSecretRecord = {
  secret?: string | null;
  secret_ciphertext?: string | null;
  secret_iv?: string | null;
  secret_tag?: string | null;
  secret_key_id?: string | null;
  secret_algorithm?: string | null;
};

function deriveAesKey(rawKey: string) {
  return createHash('sha256').update(rawKey, 'utf8').digest();
}

async function readWebhookSecretEncryptionKey() {
  const rawKey =
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim() ||
    process.env.ENCRYPTION_KEY?.trim() ||
    (await getSecret('ENCRYPTION_KEY')).trim();
  if (!rawKey) {
    throw new Error('Webhook secret encryption key is not configured');
  }
  return {
    key: deriveAesKey(rawKey),
    keyId: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY_ID?.trim() || DEFAULT_KEY_ID,
  };
}

export async function encryptWebhookSecret(secret: string): Promise<EncryptedWebhookSecretFields> {
  const normalized = secret.trim();
  if (!normalized) throw new Error('Webhook secret cannot be empty');

  const { key, keyId } = await readWebhookSecretEncryptionKey();
  const iv = randomBytes(WEBHOOK_SECRET_IV_BYTES);
  const cipher = createCipheriv(WEBHOOK_SECRET_ALGORITHM, key, iv, {
    authTagLength: WEBHOOK_SECRET_AUTH_TAG_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    secret_ciphertext: ciphertext.toString('base64'),
    secret_iv: iv.toString('base64'),
    secret_tag: tag.toString('base64'),
    secret_key_id: keyId,
    secret_algorithm: WEBHOOK_SECRET_ALGORITHM,
  };
}

export async function readWebhookSigningSecret(record: WebhookSecretRecord) {
  const ciphertext = record.secret_ciphertext;
  const iv = record.secret_iv;
  const tag = record.secret_tag;
  const algorithm = record.secret_algorithm;
  const hasEncryptedSecret = ciphertext && iv && tag && algorithm;

  if (!hasEncryptedSecret) {
    const legacySecret = record.secret?.trim();
    if (!legacySecret) throw new Error('Webhook signing secret is missing');
    return legacySecret;
  }

  if (algorithm !== WEBHOOK_SECRET_ALGORITHM) {
    throw new Error(`Unsupported webhook secret algorithm: ${algorithm}`);
  }

  const { key } = await readWebhookSecretEncryptionKey();
  const decipher = createDecipheriv(WEBHOOK_SECRET_ALGORITHM, key, Buffer.from(iv, 'base64'), {
    authTagLength: WEBHOOK_SECRET_AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  if (!plaintext) throw new Error('Webhook signing secret decrypted to an empty value');
  return plaintext;
}
