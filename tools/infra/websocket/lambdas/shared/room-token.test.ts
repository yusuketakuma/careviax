import { encode } from 'next-auth/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRoomTokenSecretCache, validateRoomToken } from './room-token';

const TOKEN_SALT = 'ph-os.collaboration-room-token.v1';
const TEST_ROOM_TOKEN_SECRET = 'test-collaboration-room-secret-32';
const SECRETS_MANAGER_ROOM_TOKEN_SECRET = 'secrets-manager-room-token-secret';
const DIRECT_PRODUCTION_SECRET = 'direct-production-room-token-secret';

async function issueTestCollaborationRoomToken({
  orgId,
  userId,
  entityType,
  entityId,
}: {
  orgId: string;
  userId: string;
  entityType: string;
  entityId: string;
}) {
  const room = `${orgId}:${entityType}:${entityId}`;

  return encode({
    secret: TEST_ROOM_TOKEN_SECRET,
    salt: TOKEN_SALT,
    maxAge: 300,
    token: {
      sub: userId,
      purpose: 'collaboration_room',
      org_id: orgId,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      room,
    },
  });
}

const { secretsManagerClientMock, secretsManagerSendMock, getSecretValueCommandMock } = vi.hoisted(
  () => ({
    secretsManagerClientMock: vi.fn(),
    secretsManagerSendMock: vi.fn(),
    getSecretValueCommandMock: vi.fn(function MockGetSecretValueCommand(
      this: { input?: unknown },
      input: unknown,
    ) {
      this.input = input;
    }),
  }),
);

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: secretsManagerClientMock.mockImplementation(
    function MockSecretsManagerClient() {
      return {
        send: secretsManagerSendMock,
      };
    },
  ),
  GetSecretValueCommand: getSecretValueCommandMock,
}));

describe('lambda room-token verifier', () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalCollaborationRoomTokenSecret = process.env.COLLABORATION_ROOM_TOKEN_SECRET;
  const originalCollaborationRoomTokenSecretArn = process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
  const originalAwsExecutionEnv = process.env.AWS_EXECUTION_ENV;
  const originalAwsClientMaxAttempts = process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;

  beforeEach(() => {
    clearRoomTokenSecretCache();
    secretsManagerSendMock.mockReset();
    secretsManagerClientMock.mockClear();
    getSecretValueCommandMock.mockClear();
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = TEST_ROOM_TOKEN_SECRET;
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AWS_EXECUTION_ENV;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    clearRoomTokenSecretCache();
    if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalAuthSecret;
    if (originalCollaborationRoomTokenSecret === undefined) {
      delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
    } else {
      process.env.COLLABORATION_ROOM_TOKEN_SECRET = originalCollaborationRoomTokenSecret;
    }
    if (originalCollaborationRoomTokenSecretArn === undefined) {
      delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    } else {
      process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN = originalCollaborationRoomTokenSecretArn;
    }
    if (originalAwsExecutionEnv === undefined) delete process.env.AWS_EXECUTION_ENV;
    else process.env.AWS_EXECUTION_ENV = originalAwsExecutionEnv;
    if (originalAwsClientMaxAttempts === undefined) delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
    else process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = originalAwsClientMaxAttempts;
  });

  it('accepts tokens issued by the application service', async () => {
    const token = await issueTestCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    await expect(validateRoomToken(token)).resolves.toMatchObject({
      ok: true,
      payload: {
        user_id: 'user_1',
        org_id: 'org_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });
  });

  it('rejects wrong purpose, wrong salt, and non-canonical room payloads', async () => {
    const wrongPurpose = await encode({
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'session',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });
    await expect(validateRoomToken(wrongPurpose)).resolves.toEqual({ ok: false });

    const wrongSalt = await encode({
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: 'ph-os.other-token.v1',
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });
    await expect(validateRoomToken(wrongSalt)).resolves.toEqual({ ok: false });

    const nonCanonicalRoom = await encode({
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:visit_record:vr_1',
      },
    });
    await expect(validateRoomToken(nonCanonicalRoom)).resolves.toEqual({ ok: false });
  });

  it('fails closed when the signing secret is unavailable', async () => {
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    await expect(validateRoomToken('token')).resolves.toEqual({ ok: false });
  });

  it('does not accept tokens signed only with the application auth fallback secret', async () => {
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
    process.env.AUTH_SECRET = 'ph-os-local-auth-secret';

    const token = await encode({
      secret: 'ph-os-local-auth-secret',
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });

    await expect(validateRoomToken(token)).resolves.toEqual({ ok: false });
  });

  it('uses the room token secret from Secrets Manager when an ARN is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = DIRECT_PRODUCTION_SECRET;
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token';
    secretsManagerSendMock.mockResolvedValue({
      SecretString: JSON.stringify({
        COLLABORATION_ROOM_TOKEN_SECRET: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
      }),
    });
    const token = await encode({
      secret: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });

    await expect(validateRoomToken(token)).resolves.toMatchObject({
      ok: true,
      payload: {
        user_id: 'user_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });
    expect(getSecretValueCommandMock).toHaveBeenCalledWith({
      SecretId:
        'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token',
    });
    expect(secretsManagerClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
      }),
    );
    expect(secretsManagerSendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('refetches the room token secret within the TTL when the Secrets Manager ARN changes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/room-token-a';
    secretsManagerSendMock
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({
          COLLABORATION_ROOM_TOKEN_SECRET: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
        }),
      })
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({
          COLLABORATION_ROOM_TOKEN_SECRET: `${SECRETS_MANAGER_ROOM_TOKEN_SECRET}-rotated`,
        }),
      });
    const firstToken = await encode({
      secret: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });
    const rotatedToken = await encode({
      secret: `${SECRETS_MANAGER_ROOM_TOKEN_SECRET}-rotated`,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });

    await expect(validateRoomToken(firstToken)).resolves.toMatchObject({ ok: true });

    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/room-token-b';

    await expect(validateRoomToken(rotatedToken)).resolves.toMatchObject({ ok: true });
    expect(secretsManagerSendMock).toHaveBeenCalledTimes(2);
    expect(getSecretValueCommandMock).toHaveBeenNthCalledWith(1, {
      SecretId: 'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/room-token-a',
    });
    expect(getSecretValueCommandMock).toHaveBeenNthCalledWith(2, {
      SecretId: 'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/room-token-b',
    });
  });

  it('fails closed when Secrets Manager cannot resolve the signing secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token';
    secretsManagerSendMock.mockRejectedValue(new Error('secrets manager unavailable'));
    const token = await encode({
      secret: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });

    await expect(validateRoomToken(token)).resolves.toEqual({ ok: false });
  });

  it('fails closed for malformed or weak Secrets Manager values', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token';
    const token = await encode({
      secret: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });

    for (const secretString of [
      JSON.stringify({ NEXTAUTH_SECRET: SECRETS_MANAGER_ROOM_TOKEN_SECRET }),
      JSON.stringify({ COLLABORATION_ROOM_TOKEN_SECRET: 123 }),
      JSON.stringify({ COLLABORATION_ROOM_TOKEN_SECRET: 'short-secret' }),
      JSON.stringify(['not-a-room-token-secret']),
      JSON.stringify(null),
      JSON.stringify(123456789012345678901234567890123),
      JSON.stringify(true),
      '{not-json',
    ]) {
      clearRoomTokenSecretCache();
      secretsManagerSendMock.mockReset();
      secretsManagerSendMock.mockResolvedValue({ SecretString: secretString });

      await expect(validateRoomToken(token)).resolves.toEqual({ ok: false });
    }
  });

  it('does not use direct secret env values in Lambda-like environments', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = DIRECT_PRODUCTION_SECRET;
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    const token = await encode({
      secret: DIRECT_PRODUCTION_SECRET,
      salt: TOKEN_SALT,
      maxAge: 300,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });

    await expect(validateRoomToken(token)).resolves.toEqual({ ok: false });
    expect(secretsManagerSendMock).not.toHaveBeenCalled();
  });
});
