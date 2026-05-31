import { decode, encode } from 'next-auth/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
  MissingCollaborationRoomTokenSecretError,
  clearCollaborationRoomTokenSecretCache,
  issueCollaborationRoomToken,
  validateCollaborationRoomToken,
} from './collaboration-room-token';

const TOKEN_SALT = 'ph-os.collaboration-room-token.v1';
const TEST_ROOM_TOKEN_SECRET = 'test-collaboration-room-secret-32';
const DEDICATED_ROOM_TOKEN_SECRET = 'dedicated-collaboration-room-secret';
const FALLBACK_AUTH_SECRET = 'fallback-application-auth-secret-32';
const SECRETS_MANAGER_ROOM_TOKEN_SECRET = 'secrets-manager-room-token-secret';
const DIRECT_PRODUCTION_SECRET = 'direct-production-room-token-secret';

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

describe('collaboration-room-token', () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalCollaborationRoomTokenSecret = process.env.COLLABORATION_ROOM_TOKEN_SECRET;
  const originalCollaborationRoomTokenSecretArn = process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
  const originalAwsExecutionEnv = process.env.AWS_EXECUTION_ENV;

  beforeEach(() => {
    clearCollaborationRoomTokenSecretCache();
    secretsManagerSendMock.mockReset();
    getSecretValueCommandMock.mockClear();
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = TEST_ROOM_TOKEN_SECRET;
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    process.env.NEXTAUTH_SECRET = FALLBACK_AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.AWS_EXECUTION_ENV;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    clearCollaborationRoomTokenSecretCache();
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
  });

  it('issues a short-lived token bound to the exact room and entity', async () => {
    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    const payload = await decode({
      token,
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
    });

    expect(payload).toMatchObject({
      sub: 'user_1',
      purpose: 'collaboration_room',
      org_id: 'org_1',
      user_id: 'user_1',
      entity_type: 'dispense_task',
      entity_id: 'dt_1',
      room: 'org_1:dispense_task:dt_1',
    });
    expect(typeof payload?.exp).toBe('number');
    expect(typeof payload?.iat).toBe('number');
    expect((payload?.exp as number) - (payload?.iat as number)).toBe(
      COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
    );
  });

  it('fails closed when no auth secret is configured in production', async () => {
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET;
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs20.x';

    await expect(
      issueCollaborationRoomToken({
        orgId: 'org_1',
        userId: 'user_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
      }),
    ).rejects.toBeInstanceOf(MissingCollaborationRoomTokenSecretError);
  });

  it('requires Secrets Manager instead of direct secret env in production', async () => {
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = DIRECT_PRODUCTION_SECRET;
    delete process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs20.x';

    await expect(
      issueCollaborationRoomToken({
        orgId: 'org_1',
        userId: 'user_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
      }),
    ).rejects.toBeInstanceOf(MissingCollaborationRoomTokenSecretError);
    expect(secretsManagerSendMock).not.toHaveBeenCalled();
  });

  it('uses the dedicated collaboration room token secret before application auth fallbacks', async () => {
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = DEDICATED_ROOM_TOKEN_SECRET;
    process.env.NEXTAUTH_SECRET = FALLBACK_AUTH_SECRET;

    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    await expect(
      decode({
        token,
        secret: DEDICATED_ROOM_TOKEN_SECRET,
        salt: TOKEN_SALT,
      }),
    ).resolves.toMatchObject({ room: 'org_1:dispense_task:dt_1' });
    await expect(
      decode({
        token,
        secret: FALLBACK_AUTH_SECRET,
        salt: TOKEN_SALT,
      }),
    ).rejects.toThrow();
  });

  it('uses the collaboration room token secret from Secrets Manager when an ARN is configured', async () => {
    process.env.COLLABORATION_ROOM_TOKEN_SECRET = DIRECT_PRODUCTION_SECRET;
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token';
    secretsManagerSendMock.mockResolvedValue({
      SecretString: JSON.stringify({
        COLLABORATION_ROOM_TOKEN_SECRET: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
      }),
    });

    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    await expect(
      decode({
        token,
        secret: SECRETS_MANAGER_ROOM_TOKEN_SECRET,
        salt: TOKEN_SALT,
      }),
    ).resolves.toMatchObject({ room: 'org_1:dispense_task:dt_1' });
    expect(getSecretValueCommandMock).toHaveBeenCalledWith({
      SecretId:
        'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token',
    });
    expect(secretsManagerSendMock).toHaveBeenCalledTimes(1);
  });

  it('rejects the known local fallback secret from Secrets Manager', async () => {
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token';
    secretsManagerSendMock.mockResolvedValue({
      SecretString: JSON.stringify({
        COLLABORATION_ROOM_TOKEN_SECRET: 'ph-os-local-auth-secret',
      }),
    });

    await expect(
      issueCollaborationRoomToken({
        orgId: 'org_1',
        userId: 'user_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
      }),
    ).rejects.toBeInstanceOf(MissingCollaborationRoomTokenSecretError);
  });

  it('rejects malformed or weak Secrets Manager values', async () => {
    process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN =
      'arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:ph-os/prod/collaboration-room-token';

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
      clearCollaborationRoomTokenSecretCache();
      secretsManagerSendMock.mockReset();
      secretsManagerSendMock.mockResolvedValue({ SecretString: secretString });

      await expect(
        issueCollaborationRoomToken({
          orgId: 'org_1',
          userId: 'user_1',
          entityType: 'dispense_task',
          entityId: 'dt_1',
        }),
      ).rejects.toBeInstanceOf(MissingCollaborationRoomTokenSecretError);
    }
  });

  it('validates a signed room token and returns its verified payload', async () => {
    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'visit_record',
      entityId: 'vr_1',
    });

    const result = await validateCollaborationRoomToken(token, {
      org_id: 'org_1',
      user_id: 'user_1',
      entity_type: 'visit_record',
      entity_id: 'vr_1',
      room: 'org_1:visit_record:vr_1',
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'visit_record',
        entity_id: 'vr_1',
        room: 'org_1:visit_record:vr_1',
      },
    });
  });

  it('rejects malformed, wrong-purpose, and wrong-salt tokens', async () => {
    await expect(validateCollaborationRoomToken(null)).resolves.toMatchObject({
      ok: false,
      kind: 'validation',
    });

    await expect(validateCollaborationRoomToken('not-a-jwt')).resolves.toMatchObject({
      ok: false,
      kind: 'not_found',
    });

    const wrongPurposeToken = await encode({
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
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

    await expect(validateCollaborationRoomToken(wrongPurposeToken)).resolves.toMatchObject({
      ok: false,
      kind: 'not_found',
    });

    const wrongSaltToken = await encode({
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: 'ph-os.other-token.v1',
      maxAge: COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
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

    await expect(validateCollaborationRoomToken(wrongSaltToken)).resolves.toMatchObject({
      ok: false,
      kind: 'not_found',
    });
  });

  it('rejects room, entity, org, and user mismatches', async () => {
    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    await expect(
      validateCollaborationRoomToken(token, {
        room: 'org_2:dispense_task:dt_1',
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'not_found' });

    await expect(
      validateCollaborationRoomToken(token, {
        entity_id: 'dt_2',
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'not_found' });

    await expect(
      validateCollaborationRoomToken(token, {
        org_id: 'org_2',
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'not_found' });

    await expect(
      validateCollaborationRoomToken(token, {
        user_id: 'user_2',
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'not_found' });
  });

  it('rejects signed tokens whose room does not match their entity payload', async () => {
    const nonCanonicalRoomToken = await encode({
      secret: TEST_ROOM_TOKEN_SECRET,
      salt: TOKEN_SALT,
      maxAge: COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
      token: {
        sub: 'user_1',
        purpose: 'collaboration_room',
        org_id: 'org_1',
        user_id: 'user_1',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        room: 'org_1:visit_record:vr_2',
      },
    });

    await expect(validateCollaborationRoomToken(nonCanonicalRoomToken)).resolves.toMatchObject({
      ok: false,
      kind: 'not_found',
    });
  });

  it('rejects expired room tokens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));

    const token = await issueCollaborationRoomToken({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });

    vi.setSystemTime(new Date('2026-05-21T00:06:00.000Z'));

    await expect(validateCollaborationRoomToken(token)).resolves.toMatchObject({
      ok: false,
      kind: 'not_found',
    });
  });
});
