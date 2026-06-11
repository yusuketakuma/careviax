import { encode } from 'next-auth/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueCollaborationRoomToken } from '@/server/services/collaboration-room-token';
import { clearRoomTokenSecretCache } from '../shared/room-token';
import { handler } from './handler';

const METHOD_ARN = 'arn:aws:execute-api:ap-northeast-1:123456789012:api-id/prod/$connect';
const TOKEN_SALT = 'ph-os.collaboration-room-token.v1';
const TEST_ROOM_TOKEN_SECRET = 'test-collaboration-room-secret-32';
const SECRETS_MANAGER_ROOM_TOKEN_SECRET = 'secrets-manager-room-token-secret';

const { secretsManagerSendMock, getSecretValueCommandMock } = vi.hoisted(() => ({
  secretsManagerSendMock: vi.fn(),
  getSecretValueCommandMock: vi.fn(function MockGetSecretValueCommand(
    this: { input?: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
}));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(function MockSecretsManagerClient() {
    return {
      send: secretsManagerSendMock,
    };
  }),
  GetSecretValueCommand: getSecretValueCommandMock,
}));

function connectEvent(token?: string) {
  return {
    methodArn: METHOD_ARN,
    queryStringParameters: token ? { token } : {},
  };
}

function denyPolicy() {
  return {
    principalId: 'unauthorized',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: METHOD_ARN,
        },
      ],
    },
    context: {},
  };
}

describe('websocket authorizer handler', () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalCollaborationRoomTokenSecret = process.env.COLLABORATION_ROOM_TOKEN_SECRET;
  const originalCollaborationRoomTokenSecretArn = process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
  const originalAwsExecutionEnv = process.env.AWS_EXECUTION_ENV;

  beforeEach(() => {
    clearRoomTokenSecretCache();
    secretsManagerSendMock.mockReset();
    getSecretValueCommandMock.mockClear();
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = TEST_ROOM_TOKEN_SECRET;
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    clearRoomTokenSecretCache();
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
    if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalAuthSecret;
    if (originalAwsExecutionEnv === undefined) delete process.env.AWS_EXECUTION_ENV;
    else process.env.AWS_EXECUTION_ENV = originalAwsExecutionEnv;
  });

  it('allows a valid collaboration room token and exposes only verified context', async () => {
    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    await expect(handler(connectEvent(token))).resolves.toEqual({
      principalId: 'user_1',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: METHOD_ARN,
          },
        ],
      },
      context: {
        userId: 'user_1',
        orgId: 'org_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
        tokenExpiresAt: expect.any(String),
      },
    });
  });

  it('denies missing, malformed, wrong-purpose, and wrong-salt tokens', async () => {
    await expect(handler(connectEvent())).resolves.toEqual(denyPolicy());

    await expect(handler(connectEvent('not-a-jwt'))).resolves.toEqual(denyPolicy());

    const wrongPurposeToken = await encode({
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

    await expect(handler(connectEvent(wrongPurposeToken))).resolves.toEqual(denyPolicy());

    const wrongSaltToken = await encode({
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

    await expect(handler(connectEvent(wrongSaltToken))).resolves.toEqual(denyPolicy());
  });

  it('ignores client-supplied room query values and exposes no unverified context', async () => {
    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    await expect(
      handler({
        methodArn: METHOD_ARN,
        queryStringParameters: {
          token,
          room: 'org_2:dispense_task:dt_9',
        },
      }),
    ).resolves.toEqual({
      principalId: 'user_1',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: METHOD_ARN,
          },
        ],
      },
      context: {
        userId: 'user_1',
        orgId: 'org_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
        room: 'org_1:dispense_task:dt_1',
        tokenExpiresAt: expect.any(String),
      },
    });
  });

  it('denies expired collaboration room tokens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));

    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'visit_record',
      entityId: 'vr_1',
    });

    vi.setSystemTime(new Date('2026-05-21T00:06:00.000Z'));

    await expect(handler(connectEvent(token))).resolves.toEqual(denyPolicy());
  });

  it('fails closed when the room-token signing secret is unavailable', async () => {
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;

    await expect(handler(connectEvent('anything'))).resolves.toEqual(denyPolicy());
  });

  it('allows tokens signed with the Secrets Manager resolved room-token secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
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

    await expect(handler(connectEvent(token))).resolves.toMatchObject({
      principalId: 'user_1',
      policyDocument: {
        Statement: [
          {
            Effect: 'Allow',
          },
        ],
      },
      context: {
        userId: 'user_1',
        room: 'org_1:dispense_task:dt_1',
      },
    });
    expect(getSecretValueCommandMock).toHaveBeenCalledWith({
      SecretId:
        'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token',
    });
  });

  it('does not fall back to the local application auth secret in Lambda-like environments', async () => {
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
    process.env.AUTH_SECRET = 'ph-os-local-auth-secret';
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';

    const forgedToken = await encode({
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

    await expect(handler(connectEvent(forgedToken))).resolves.toEqual(denyPolicy());
  });
});
