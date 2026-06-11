import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cognitoClientMock, cognitoSendMock, adminCreateUserCommandMock } = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  cognitoClientMock: vi.fn(function MockCognitoIdentityProviderClient() {
    return {
      send: cognitoSendMock,
    };
  }),
  adminCreateUserCommandMock: vi.fn(function MockAdminCreateUserCommand(
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
    AdminCreateUserCommand: adminCreateUserCommandMock,
  };
});

import { buildCognitoUserAttributes, inviteCognitoUser } from './cognito-admin';

describe('buildCognitoUserAttributes', () => {
  const originalUserPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const originalAwsRegion = process.env.AWS_REGION;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'pool_1';
    process.env.AWS_REGION = 'ap-northeast-1';
  });

  afterEach(() => {
    if (originalUserPoolId === undefined) delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    else process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = originalUserPoolId;
    if (originalAwsRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalAwsRegion;
  });

  it('adds PH-OS custom tenant and role attributes for access-token customization', () => {
    expect(
      buildCognitoUserAttributes({
        email: 'Pharmacist@example.com',
        name: 'PH-OS Pharmacist',
        phone: '+819012345678',
        phosTenantId: 'tenant_abc123',
        phosRole: 'pharmacist',
      }),
    ).toEqual([
      { Name: 'email', Value: 'Pharmacist@example.com' },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: 'PH-OS Pharmacist' },
      { Name: 'phone_number', Value: '+819012345678' },
      { Name: 'custom:tenant_id', Value: 'tenant_abc123' },
      { Name: 'custom:role', Value: 'PHARMACIST' },
    ]);
  });

  it('leaves PH-OS custom attributes untouched when not supplied', () => {
    expect(
      buildCognitoUserAttributes({
        email: 'user@example.com',
        name: 'PH-OS User',
      }),
    ).toEqual([
      { Name: 'email', Value: 'user@example.com' },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: 'PH-OS User' },
    ]);
  });

  it('rejects unsafe tenant ids and invalid PH-OS roles', () => {
    expect(() =>
      buildCognitoUserAttributes({
        email: 'user@example.com',
        name: 'PH-OS User',
        phosTenantId: '../tenant',
      }),
    ).toThrow('COGNITO_PHOS_TENANT_ID_INVALID');

    expect(() =>
      buildCognitoUserAttributes({
        email: 'user@example.com',
        name: 'PH-OS User',
        phosRole: 'owner',
      }),
    ).toThrow('COGNITO_PHOS_ROLE_INVALID');
  });

  it('wraps Cognito admin sends with bounded AWS client options', async () => {
    cognitoSendMock.mockResolvedValue({
      User: {
        Attributes: [{ Name: 'sub', Value: 'cognito-sub-1' }],
      },
    });

    await expect(
      inviteCognitoUser({
        email: 'PHARMACIST@example.com',
        name: 'PH-OS Pharmacist',
        phosTenantId: 'tenant_1',
        phosRole: 'pharmacist',
      }),
    ).resolves.toEqual({
      username: 'pharmacist@example.com',
      sub: 'cognito-sub-1',
    });

    expect(cognitoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cognitoSendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(adminCreateUserCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        UserPoolId: 'pool_1',
        Username: 'pharmacist@example.com',
      }),
    );
  });

  it('creates a separate Cognito admin client when AWS_REGION changes', async () => {
    cognitoClientMock.mockClear();
    cognitoSendMock.mockReset();
    adminCreateUserCommandMock.mockClear();
    cognitoSendMock.mockResolvedValue({
      User: {
        Attributes: [{ Name: 'sub', Value: 'cognito-sub-1' }],
      },
    });

    process.env.AWS_REGION = 'eu-central-1';
    await inviteCognitoUser({
      email: 'first@example.com',
      name: 'First User',
      phosTenantId: 'tenant_1',
      phosRole: 'pharmacist',
    });
    process.env.AWS_REGION = 'ca-central-1';
    await inviteCognitoUser({
      email: 'second@example.com',
      name: 'Second User',
      phosTenantId: 'tenant_1',
      phosRole: 'pharmacist',
    });

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
