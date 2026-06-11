import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateWithPassword,
  LOCAL_DEMO_LOGIN_EMAIL,
  LOCAL_DEMO_LOGIN_PASSWORD,
  parseCognitoIdTokenPayload,
} from './cognito-auth';

const { cognitoClientMock, cognitoSendMock, initiateAuthCommandMock } = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  cognitoClientMock: vi.fn(function MockCognitoIdentityProviderClient() {
    return {
      send: cognitoSendMock,
    };
  }),
  initiateAuthCommandMock: vi.fn(function MockInitiateAuthCommand(
    this: { input?: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@aws-sdk/client-cognito-identity-provider')>();
  return {
    ...original,
    CognitoIdentityProviderClient: cognitoClientMock,
    InitiateAuthCommand: initiateAuthCommandMock,
  };
});

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
    awsRegion: process.env.AWS_REGION,
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
    if (originalEnv.awsRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalEnv.awsRegion;
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

  it('wraps Cognito password auth sends with bounded AWS client options', async () => {
    delete process.env.PLAYWRIGHT;
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client_1';
    process.env.AWS_REGION = 'us-west-2';
    cognitoClientMock.mockClear();
    cognitoSendMock.mockReset();
    initiateAuthCommandMock.mockClear();
    cognitoSendMock.mockResolvedValue({
      AuthenticationResult: {
        IdToken: makeJwt({
          sub: 'cognito-sub-1',
          email: 'user@example.jp',
          name: '利用者 太郎',
        }),
        AccessToken: 'access-token',
        RefreshToken: 'refresh-token',
      },
    });

    await expect(
      authenticateWithPassword({
        email: 'USER@example.jp',
        password: 'password-1',
      }),
    ).resolves.toMatchObject({
      email: 'user@example.jp',
      accessToken: 'access-token',
    });

    expect(cognitoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'us-west-2',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cognitoSendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(initiateAuthCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ClientId: 'client_1',
        AuthParameters: expect.objectContaining({ USERNAME: 'user@example.jp' }),
      }),
    );
  });

  it('creates a separate Cognito auth client when AWS_REGION changes', async () => {
    delete process.env.PLAYWRIGHT;
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client_1';
    cognitoClientMock.mockClear();
    cognitoSendMock.mockReset();
    initiateAuthCommandMock.mockClear();
    cognitoSendMock.mockResolvedValue({
      AuthenticationResult: {
        IdToken: makeJwt({
          sub: 'cognito-sub-1',
          email: 'user@example.jp',
          name: '利用者 太郎',
        }),
        AccessToken: 'access-token',
      },
    });

    process.env.AWS_REGION = 'eu-central-1';
    await authenticateWithPassword({ email: 'user@example.jp', password: 'password-1' });
    process.env.AWS_REGION = 'ca-central-1';
    await authenticateWithPassword({ email: 'user@example.jp', password: 'password-1' });

    expect(cognitoClientMock).toHaveBeenCalledTimes(2);
    expect(cognitoClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cognitoClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });
});
