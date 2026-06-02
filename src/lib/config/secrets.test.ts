import { describe, expect, it } from 'vitest';

import { parseAppSecrets } from './secrets';

const validSecrets = {
  DATABASE_URL: 'postgresql://user:pass@example.test/db',
  NEXTAUTH_SECRET: 'nextauth-secret',
  ENCRYPTION_KEY: 'encryption-key',
  JWT_SIGNING_SECRET: 'jwt-signing-secret',
  JOB_API_KEY: 'job-api-key',
};

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
