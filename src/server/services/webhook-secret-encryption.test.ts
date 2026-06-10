import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptWebhookSecret, readWebhookSigningSecret } from './webhook-secret-encryption';

describe('webhook secret encryption', () => {
  let originalEncryptionKey: string | undefined;
  let originalWebhookEncryptionKey: string | undefined;

  beforeEach(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    originalWebhookEncryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'webhook-secret-encryption-test-key';
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
    if (originalWebhookEncryptionKey === undefined) {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalWebhookEncryptionKey;
    }
  });

  it('encrypts webhook secrets without storing plaintext in encrypted fields', async () => {
    const encrypted = await encryptWebhookSecret('webhook-signing-secret');

    expect(encrypted.secret_ciphertext).not.toContain('webhook-signing-secret');
    await expect(
      readWebhookSigningSecret({
        secret: null,
        ...encrypted,
      }),
    ).resolves.toBe('webhook-signing-secret');
  });

  it('keeps legacy plaintext secrets readable during migration', async () => {
    await expect(readWebhookSigningSecret({ secret: 'legacy-secret' })).resolves.toBe(
      'legacy-secret',
    );
  });

  it('fails closed when no encryption key is configured for new encrypted secrets', async () => {
    delete process.env.ENCRYPTION_KEY;

    await expect(encryptWebhookSecret('webhook-signing-secret')).rejects.toThrow(
      'Webhook secret encryption key is not configured',
    );
  });
});
