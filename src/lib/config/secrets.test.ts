import { describe, expect, it } from 'vitest';

import { parseAppSecrets } from './secrets';

const validSecrets = {
  DATABASE_URL: 'postgresql://careviax.example/db',
  NEXTAUTH_SECRET: 'nextauth-secret',
  ENCRYPTION_KEY: 'encryption-key',
  JWT_SIGNING_SECRET: 'jwt-signing-secret',
  JOB_API_KEY: 'job-api-key',
};

describe('parseAppSecrets', () => {
  it('reads required string secrets and ignores extra keys', () => {
    expect(
      parseAppSecrets(
        JSON.stringify({
          ...validSecrets,
          UNUSED_SECRET: 'ignored',
        }),
        'test secret',
      ),
    ).toEqual(validSecrets);
  });

  it('rejects malformed JSON and non-object payloads', () => {
    expect(() => parseAppSecrets('not-json', 'test secret')).toThrow(
      'test secret is not valid JSON',
    );
    expect(() => parseAppSecrets(JSON.stringify(['unexpected']), 'test secret')).toThrow(
      'test secret must be a JSON object',
    );
    expect(() => parseAppSecrets(JSON.stringify('unexpected'), 'test secret')).toThrow(
      'test secret must be a JSON object',
    );
  });

  it('rejects missing, blank, and non-string required secret values', () => {
    expect(() =>
      parseAppSecrets(
        JSON.stringify({
          ...validSecrets,
          DATABASE_URL: '',
          NEXTAUTH_SECRET: '   ',
          ENCRYPTION_KEY: 123,
          JOB_API_KEY: null,
          JWT_SIGNING_SECRET: 'jwt-signing-secret',
        }),
        'test secret',
      ),
    ).toThrow(
      'test secret is missing required string keys: DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, JOB_API_KEY',
    );

    expect(() =>
      parseAppSecrets(
        JSON.stringify({
          DATABASE_URL: validSecrets.DATABASE_URL,
          NEXTAUTH_SECRET: validSecrets.NEXTAUTH_SECRET,
        }),
        'test secret',
      ),
    ).toThrow(
      'test secret is missing required string keys: ENCRYPTION_KEY, JWT_SIGNING_SECRET, JOB_API_KEY',
    );
  });
});
