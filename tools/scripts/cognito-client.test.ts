import { afterEach, describe, expect, it, vi } from 'vitest';

const { cognitoClientMock, sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  cognitoClientMock: vi.fn(function MockCognitoIdentityProviderClient() {
    return {
      send: sendMock,
    };
  }),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-cognito-identity-provider')>();
  return {
    ...actual,
    CognitoIdentityProviderClient: cognitoClientMock,
  };
});

describe('tools script Cognito client', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
  });

  it('reuses Cognito clients within a region', async () => {
    const { getScriptCognitoClient } = await import('./cognito-client');

    expect(getScriptCognitoClient('ap-northeast-1')).toBe(getScriptCognitoClient('ap-northeast-1'));

    expect(cognitoClientMock).toHaveBeenCalledOnce();
    expect(cognitoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('creates separate Cognito clients when the runtime region changes', async () => {
    const { getScriptCognitoClient } = await import('./cognito-client');

    getScriptCognitoClient('eu-central-1');
    getScriptCognitoClient('ca-central-1');

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

  it('uses bounded retry config', async () => {
    process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = '99';
    const { getScriptCognitoClient } = await import('./cognito-client');

    getScriptCognitoClient('ap-northeast-1');

    expect(cognitoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 5,
        requestHandler: expect.anything(),
      }),
    );
  });
});
