import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAppSecrets } from './secrets';

const validSecrets = {
  DATABASE_URL: 'postgresql://user:pass@example.test/db',
  NEXTAUTH_SECRET: 'nextauth-secret',
  ENCRYPTION_KEY: 'encryption-key',
  JWT_SIGNING_SECRET: 'jwt-signing-secret',
  JOB_API_KEY: 'job-api-key',
};

function secretPayload(overrides: Partial<typeof validSecrets> = {}) {
  return JSON.stringify({
    ...validSecrets,
    ...overrides,
  });
}

afterEach(() => {
  vi.doUnmock('@aws-sdk/client-secrets-manager');
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('parseAppSecrets', () => {
  it('parses a valid Secrets Manager JSON object', () => {
    expect(parseAppSecrets(JSON.stringify(validSecrets), 'Test secret')).toEqual(validSecrets);
  });

  it('rejects malformed JSON and non-object JSON roots', () => {
    expect(() => parseAppSecrets('{not-json', 'Test secret')).toThrow(
      'Test secret is not valid JSON',
    );
    expect(() => parseAppSecrets(JSON.stringify(['not-an-object']), 'Test secret')).toThrow(
      'Test secret must be a JSON object',
    );
  });

  it('reports all missing or blank required string keys before returning values', () => {
    expect(() =>
      parseAppSecrets(
        JSON.stringify({
          ...validSecrets,
          DATABASE_URL: '',
          JOB_API_KEY: 123,
        }),
        'Test secret',
      ),
    ).toThrow('Test secret is missing required string keys: DATABASE_URL, JOB_API_KEY');
  });
});

describe('getSecrets', () => {
  it('falls back to env values without logging raw Secrets Manager failure details', async () => {
    vi.resetModules();
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('AWS_REGION', 'ap-northeast-1');
    vi.stubEnv('SECRETS_MANAGER_SECRET_ID', 'ph-os/staging/app-secrets/token-secret-id');
    vi.stubEnv('DATABASE_URL', 'postgresql://env-secret/db');
    vi.stubEnv('NEXTAUTH_SECRET', 'env-nextauth-secret');
    vi.stubEnv('ENCRYPTION_KEY', 'env-encryption-key');
    vi.stubEnv('JWT_SIGNING_SECRET', 'env-jwt-signing-secret');
    vi.stubEnv('JOB_API_KEY', 'env-job-api-key');

    const sendMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'AccessDeniedException for ph-os/staging/app-secrets/token-secret-id token=secret-provider-token patient=山田',
        ),
      );
    const secretsManagerClientMock = vi.fn(function MockSecretsManagerClient() {
      return {
        send: sendMock,
      };
    });
    const getSecretValueCommandMock = vi.fn(function MockGetSecretValueCommand(
      this: { input?: unknown },
      input: unknown,
    ) {
      this.input = input;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.doMock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: secretsManagerClientMock,
      GetSecretValueCommand: getSecretValueCommandMock,
    }));

    const { getSecrets } = await import('./secrets');

    await expect(getSecrets()).resolves.toMatchObject({
      DATABASE_URL: 'postgresql://env-secret/db',
      NEXTAUTH_SECRET: 'env-nextauth-secret',
    });

    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain('secrets_manager_fetch_failed');
    expect(logged).not.toContain('AccessDeniedException');
    expect(logged).not.toContain('token-secret-id');
    expect(logged).not.toContain('secret-provider-token');
    expect(logged).not.toContain('山田');

    warnSpy.mockRestore();
  });

  it('reuses the Secrets Manager client across explicit secret cache clears', async () => {
    vi.resetModules();
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('AWS_REGION', 'ap-northeast-1');

    const sendMock = vi
      .fn()
      .mockResolvedValueOnce({
        SecretString: secretPayload({ DATABASE_URL: 'postgresql://first-secret/db' }),
      })
      .mockResolvedValueOnce({
        SecretString: secretPayload({ DATABASE_URL: 'postgresql://rotated-secret/db' }),
      });
    const secretsManagerClientMock = vi.fn(function MockSecretsManagerClient() {
      return {
        send: sendMock,
      };
    });
    const getSecretValueCommandMock = vi.fn(function MockGetSecretValueCommand(
      this: { input?: unknown },
      input: unknown,
    ) {
      this.input = input;
    });

    vi.doMock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: secretsManagerClientMock,
      GetSecretValueCommand: getSecretValueCommandMock,
    }));

    const { clearSecretsCache, getSecrets } = await import('./secrets');

    await expect(getSecrets()).resolves.toMatchObject({
      DATABASE_URL: 'postgresql://first-secret/db',
    });
    clearSecretsCache();
    await expect(getSecrets()).resolves.toMatchObject({
      DATABASE_URL: 'postgresql://rotated-secret/db',
    });

    expect(secretsManagerClientMock).toHaveBeenCalledOnce();
    expect(secretsManagerClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
      }),
    );
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(getSecretValueCommandMock).toHaveBeenCalledTimes(2);
    expect(getSecretValueCommandMock).toHaveBeenCalledWith({
      SecretId: 'ph-os/staging/app-secrets',
    });
  });

  it('refetches app secrets within the TTL when AWS_REGION changes', async () => {
    vi.resetModules();
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('AWS_REGION', 'eu-central-1');

    const sendMock = vi
      .fn()
      .mockResolvedValueOnce({
        SecretString: secretPayload({ DATABASE_URL: 'postgresql://eu-secret/db' }),
      })
      .mockResolvedValueOnce({
        SecretString: secretPayload({ DATABASE_URL: 'postgresql://ca-secret/db' }),
      });
    const secretsManagerClientMock = vi.fn(function MockSecretsManagerClient() {
      return {
        send: sendMock,
      };
    });
    const getSecretValueCommandMock = vi.fn(function MockGetSecretValueCommand(
      this: { input?: unknown },
      input: unknown,
    ) {
      this.input = input;
    });

    vi.doMock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: secretsManagerClientMock,
      GetSecretValueCommand: getSecretValueCommandMock,
    }));

    const { getSecrets } = await import('./secrets');

    await expect(getSecrets()).resolves.toMatchObject({
      DATABASE_URL: 'postgresql://eu-secret/db',
    });
    vi.stubEnv('AWS_REGION', 'ca-central-1');
    await expect(getSecrets()).resolves.toMatchObject({
      DATABASE_URL: 'postgresql://ca-secret/db',
    });

    expect(secretsManagerClientMock).toHaveBeenCalledTimes(2);
    expect(secretsManagerClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
      }),
    );
    expect(secretsManagerClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
      }),
    );
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(getSecretValueCommandMock).toHaveBeenCalledTimes(2);
  });
});
