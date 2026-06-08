import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateWithPassword,
  LOCAL_DEMO_LOGIN_EMAIL,
  LOCAL_DEMO_LOGIN_PASSWORD,
  parseCognitoIdTokenPayload,
} from './cognito-auth';

function makeJwt(payload: unknown) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('cognito-auth token parsing', () => {
  it('extracts supported string claims from the ID token payload', () => {
    expect(
      parseCognitoIdTokenPayload(
        makeJwt({
          sub: 'cognito-sub-1',
          email: 'USER@example.jp',
          name: '利用者 太郎',
          ignored: true,
        }),
      ),
    ).toEqual({
      sub: 'cognito-sub-1',
      email: 'USER@example.jp',
      name: '利用者 太郎',
    });
  });

  it('ignores malformed optional claim values', () => {
    expect(
      parseCognitoIdTokenPayload(
        makeJwt({
          sub: 123,
          email: ['user@example.jp'],
          name: null,
        }),
      ),
    ).toEqual({
      sub: undefined,
      email: undefined,
      name: undefined,
    });
  });

  it('rejects malformed, missing, and non-object payloads with the auth error code', () => {
    expect(() => parseCognitoIdTokenPayload('missing-payload')).toThrow('COGNITO_ID_TOKEN_INVALID');
    expect(() => parseCognitoIdTokenPayload('header.not-json.signature')).toThrow(
      'COGNITO_ID_TOKEN_INVALID',
    );
    expect(() => parseCognitoIdTokenPayload(makeJwt([]))).toThrow('COGNITO_ID_TOKEN_INVALID');
    expect(() => parseCognitoIdTokenPayload(makeJwt(null))).toThrow('COGNITO_ID_TOKEN_INVALID');
    expect(() => parseCognitoIdTokenPayload(makeJwt('payload'))).toThrow(
      'COGNITO_ID_TOKEN_INVALID',
    );
  });
});

describe('authenticateWithPassword local demo login', () => {
  const originalEnv = {
    playwright: process.env.PLAYWRIGHT,
    allowLocalDemoPasswordLogin: process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN,
    localDemoPassword: process.env.LOCAL_DEMO_PASSWORD,
    cognitoClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  };

  beforeEach(() => {
    process.env.PLAYWRIGHT = '1';
    delete process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN;
    delete process.env.LOCAL_DEMO_PASSWORD;
    delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  });

  afterEach(() => {
    if (originalEnv.playwright === undefined) delete process.env.PLAYWRIGHT;
    else process.env.PLAYWRIGHT = originalEnv.playwright;
    if (originalEnv.allowLocalDemoPasswordLogin === undefined) {
      delete process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN;
    } else {
      process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN = originalEnv.allowLocalDemoPasswordLogin;
    }
    if (originalEnv.localDemoPassword === undefined) delete process.env.LOCAL_DEMO_PASSWORD;
    else process.env.LOCAL_DEMO_PASSWORD = originalEnv.localDemoPassword;
    if (originalEnv.cognitoClientId === undefined) delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
    else process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = originalEnv.cognitoClientId;
  });

  it('accepts the seeded demo user password only in the local Playwright runtime', async () => {
    await expect(
      authenticateWithPassword({
        email: LOCAL_DEMO_LOGIN_EMAIL,
        password: LOCAL_DEMO_LOGIN_PASSWORD,
      }),
    ).resolves.toMatchObject({
      email: LOCAL_DEMO_LOGIN_EMAIL,
      name: '山田 太郎',
      cognitoSub: 'demo-cognito-sub-001',
    });
  });

  it('supports overriding the local demo password through LOCAL_DEMO_PASSWORD', async () => {
    process.env.LOCAL_DEMO_PASSWORD = 'custom-local-password';

    await expect(
      authenticateWithPassword({
        email: LOCAL_DEMO_LOGIN_EMAIL,
        password: 'custom-local-password',
      }),
    ).resolves.toMatchObject({
      email: LOCAL_DEMO_LOGIN_EMAIL,
      cognitoSub: 'demo-cognito-sub-001',
    });
  });

  it('does not enable the demo password outside the explicit local runtime guard', async () => {
    delete process.env.PLAYWRIGHT;
    delete process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN;

    await expect(
      authenticateWithPassword({
        email: LOCAL_DEMO_LOGIN_EMAIL,
        password: LOCAL_DEMO_LOGIN_PASSWORD,
      }),
    ).rejects.toThrow('COGNITO_NOT_CONFIGURED');
  });
});
