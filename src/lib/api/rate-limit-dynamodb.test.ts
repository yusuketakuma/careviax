import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
  EXTERNAL_ACCESS_OTP_LOCKOUT_TTL_SECONDS,
  RATE_LIMIT_DDB_TIMEOUT_MS,
  checkAuthRateLimit,
  checkExternalAccessOtpLockout,
  checkRateLimit,
  recordExternalAccessOtpFailure,
  resetRateLimitStoreForTests,
} from './rate-limit';
import {
  EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST,
  OTHER_EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST,
  resetRateLimitTestState,
} from './rate-limit.test-helpers';

describe('rate-limit DynamoDB store', () => {
  beforeEach(resetRateLimitTestState);

  it('keeps the DynamoDB table/IAM infrastructure contract aligned with the rate limiter', () => {
    const artifact = JSON.parse(
      readFileSync(join(process.cwd(), 'tools', 'infra', 'rate-limit-dynamodb.json'), 'utf8'),
    ) as {
      table: {
        tableName: string;
        billingMode: string;
        attributeDefinitions: Array<{ attributeName: string; attributeType: string }>;
        keySchema: Array<{ attributeName: string; keyType: string }>;
        timeToLiveSpecification: { attributeName: string; enabled: boolean };
        sseSpecification: { enabled: boolean };
      };
      applicationRolePolicy: {
        statements: Array<{ actions: string[]; resources: string[] }>;
      };
      deploymentVerifierPolicy: {
        statements: Array<{ actions: string[]; resources: string[] }>;
      };
      itemSchema: Record<string, string>;
      deploymentNotes: string[];
    };

    expect(artifact.table.tableName).toBe('${RATE_LIMIT_DDB_TABLE_NAME}');
    expect(artifact.table.billingMode).toBe('PAY_PER_REQUEST');
    expect(artifact.table.attributeDefinitions).toContainEqual({
      attributeName: 'pk',
      attributeType: 'S',
    });
    expect(artifact.table.keySchema).toEqual([{ attributeName: 'pk', keyType: 'HASH' }]);
    expect(artifact.table.timeToLiveSpecification).toEqual({
      attributeName: 'expires_at',
      enabled: true,
    });
    expect(artifact.table.sseSpecification.enabled).toBe(true);
    expect(artifact.itemSchema.pk).toContain('durable:external-access-otp:v1:');
    expect(artifact.itemSchema.hit_count).toContain('lifetime external OTP mismatch count');
    expect(artifact.itemSchema.reset_at).toContain('absent from durable lockout items');
    expect(artifact.deploymentNotes.join(' ')).toContain('Never store the raw token, OTP');

    const rateLimitStatement = artifact.applicationRolePolicy.statements[0];
    expect(rateLimitStatement.actions).toEqual(['dynamodb:UpdateItem']);
    expect(rateLimitStatement.resources).toEqual([
      'arn:aws:dynamodb:${AWS_REGION}:${AWS_ACCOUNT_ID}:table/${RATE_LIMIT_DDB_TABLE_NAME}',
    ]);
    expect(
      artifact.deploymentVerifierPolicy.statements.flatMap((statement) => statement.actions),
    ).toEqual(
      expect.arrayContaining([
        'dynamodb:DescribeTable',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
      ]),
    );
  });

  it('uses the DynamoDB store when configured', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:30.000Z'));
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: '61' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await checkRateLimit('user:1', '/api/patients/patient_123', 'POST');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 1710000000000,
      reason: 'quota_exceeded',
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const expectedBucketStart = Date.parse('2026-03-28T00:00:00.000Z');
    const expectedResetAt = Date.parse('2026-03-28T00:01:00.000Z');
    expect(body).toMatchObject({
      TableName: 'ph-os-rate-limit',
      Key: {
        pk: { S: `${expectedBucketStart}:write:user:1:/api/patients/:id` },
      },
      UpdateExpression: expect.stringContaining('ADD hit_count :inc'),
      ReturnValues: 'UPDATED_NEW',
    });
    expect(body.ExpressionAttributeValues).toMatchObject({
      ':inc': { N: '1' },
      ':reset_at': { N: String(expectedResetAt) },
      ':expires_at': { N: String(Math.ceil(expectedResetAt / 1000) + 86_400) },
    });
    expect(body.Key.pk.S).not.toContain('patient_123');
    vi.useRealTimers();
  });

  it('uses atomic UpdateItem operations for the durable external access OTP lockout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Attributes: {
              hit_count: { N: '10' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Attributes: {
              hit_count: { N: '0' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: true,
      attempts: 10,
    });
    await expect(
      checkExternalAccessOtpLockout(OTHER_EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: false,
      attempts: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const incrementBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const inspectBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const expectedExpiresAt =
      Math.floor(Date.parse('2026-03-28T00:00:00.000Z') / 1000) +
      EXTERNAL_ACCESS_OTP_LOCKOUT_TTL_SECONDS;
    expect(incrementBody).toMatchObject({
      TableName: 'ph-os-rate-limit',
      Key: {
        pk: { S: `durable:external-access-otp:v1:${EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST}` },
      },
      UpdateExpression: expect.stringContaining('ADD hit_count :inc'),
      ReturnValues: 'ALL_NEW',
    });
    expect(incrementBody.UpdateExpression).toContain(
      'expires_at = if_not_exists(expires_at, :expires_at)',
    );
    expect(incrementBody.ExpressionAttributeValues).toMatchObject({
      ':inc': { N: '1' },
      ':expires_at': { N: String(expectedExpiresAt) },
      ':counter_kind': { S: 'external_access_otp_lockout_v1' },
    });
    expect(inspectBody).toMatchObject({
      Key: {
        pk: {
          S: `durable:external-access-otp:v1:${OTHER_EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST}`,
        },
      },
      ConditionExpression: 'attribute_not_exists(hit_count) OR hit_count < :threshold',
      ReturnValues: 'ALL_NEW',
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    });
    expect(inspectBody.UpdateExpression).toContain('hit_count = if_not_exists(hit_count, :zero)');
    expect(inspectBody.ExpressionAttributeValues).toMatchObject({
      ':zero': { N: '0' },
      ':threshold': { N: String(EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES) },
      ':expires_at': { N: String(expectedExpiresAt) },
    });
    vi.useRealTimers();
  });

  it('maps an atomic correct-OTP condition failure to a locked grant', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException',
          Item: {
            hit_count: { N: String(EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES) },
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: true,
      attempts: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
    });
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it('fails closed for durable lockout checks when production DynamoDB is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    const rawFailure = 'provider failure token=raw-secret patient=LEAK';
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(rawFailure));

    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_unavailable',
    });
    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_unavailable',
    });
    expect(consoleErrorMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(consoleErrorMock.mock.calls)).not.toContain(rawFailure);
    expect(JSON.stringify(consoleErrorMock.mock.calls)).not.toContain(
      EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST,
    );
  });

  it('fails closed when DynamoDB omits or malforms the durable lockout counter', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Attributes: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Attributes: { hit_count: { N: 'not-a-counter' } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_unavailable',
    });
    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_unavailable',
    });
    expect(consoleErrorMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed for durable lockout checks in the production DenyAll store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_misconfigured',
    });
    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_misconfigured',
    });
    expect(consoleErrorMock).toHaveBeenCalledOnce();
  });

  it('uses container role credentials for DynamoDB rate limiting without static AWS keys', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/rate-limit-role';
    process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = 'container-auth-token';

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            AccessKeyId: 'ASIAROLE',
            SecretAccessKey: 'role-secret-key',
            Token: 'role-session-token',
            Expiration: '2026-03-28T00:10:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Attributes: {
              hit_count: { N: '1' },
              reset_at: { N: '1710000000000' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: true,
      remaining: 59,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://169.254.170.2/v2/credentials/rate-limit-role',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'container-auth-token',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://dynamodb.ap-northeast-1.amazonaws.com/');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'X-Amz-Security-Token': 'role-session-token',
    });
  });

  it('unrefs container credential and DynamoDB request timeout timers', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/rate-limit-role';
    resetRateLimitStoreForTests();
    const unrefMock = vi.fn();
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        void handler;
        void timeout;
        void args;
        return { unref: unrefMock } as unknown as ReturnType<typeof setTimeout>;
      });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            AccessKeyId: 'ASIAROLE',
            SecretAccessKey: 'role-secret-key',
            Token: 'role-session-token',
            Expiration: '2026-03-28T00:10:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Attributes: {
              hit_count: { N: '1' },
              reset_at: { N: '1710000000000' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: true,
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(unrefMock).toHaveBeenCalledTimes(2);
  });

  it('prefers container role credentials over static AWS keys for rate limiting', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_STATIC';
    process.env.AWS_SECRET_ACCESS_KEY = 'static-secret-key';
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/rate-limit-role';

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            AccessKeyId: 'ASIAROLE',
            SecretAccessKey: 'role-secret-key',
            Token: 'role-session-token',
            Expiration: '2026-03-28T00:10:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Attributes: {
              hit_count: { N: '1' },
              reset_at: { N: '1710000000000' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: true,
    });

    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toContain('Credential=ASIAROLE/');
    expect(headers.Authorization).not.toContain('Credential=AKIA_STATIC/');
  });

  it('fails closed in production when container credentials have malformed fields', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/rate-limit-role';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          AccessKeyId: 'ASIAROLE',
          SecretAccessKey: 123,
          Token: 'role-session-token',
          Expiration: '2026-03-28T00:10:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed in production when container credentials have an invalid expiration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/rate-limit-role';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          AccessKeyId: ' ASIAROLE ',
          SecretAccessKey: ' role-secret-key ',
          Token: ' role-session-token ',
          Expiration: 'not-a-date',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed with a controlled cause when container credentials are not valid JSON', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/rate-limit-role';
    resetRateLimitStoreForTests();
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{bad json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[rate-limit] DynamoDB store unavailable; denying request',
      expect.objectContaining({
        error_name: 'Error',
        event: 'rate_limit_dynamodb_store_unavailable',
        operation: 'deny_request',
      }),
    );
  });

  it('fails closed in production when DynamoDB returns malformed counters', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: 'not-a-number' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
  });

  it('fails closed with a controlled cause when DynamoDB returns invalid JSON', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{bad json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[rate-limit] DynamoDB store unavailable; denying request',
      expect.objectContaining({
        error_name: 'Error',
        event: 'rate_limit_dynamodb_store_unavailable',
        operation: 'deny_request',
      }),
    );
  });

  it('does not log raw DynamoDB failure details in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    const rawFailure =
      'ddb failure patient=患者A token=secret signed_url=https://example.invalid/x';
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error(rawFailure));

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });

    const serializedLog = consoleErrorMock.mock.calls
      .flat()
      .map((value) => (value instanceof Error ? value.message : JSON.stringify(value)))
      .join('\n');
    expect(serializedLog).not.toContain(rawFailure);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[rate-limit] DynamoDB store unavailable; denying request',
      expect.objectContaining({
        error_name: 'Error',
        event: 'rate_limit_dynamodb_store_unavailable',
        operation: 'deny_request',
      }),
    );
  });

  it('fails closed in production when DynamoDB returns non-positive counters', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: '-1' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
  });

  it('does not use arbitrary full credential URLs for the DynamoDB rate-limit store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = 'https://example.com/credentials';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_misconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('canonicalizes path variants before writing DynamoDB rate-limit keys', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: '1' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      checkRateLimit('user:1', '/api//patients//patient_123/?tab=overview', 'POST'),
    ).resolves.toMatchObject({
      allowed: true,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.Key.pk.S).toContain('write:user:1:/api/patients/:id');
    expect(body.Key.pk.S).not.toContain('patient_123');
    expect(body.Key.pk.S).not.toContain('tab=overview');
    expect(body.Key.pk.S).not.toContain('//patients//');
  });

  it('canonicalizes unknown API paths before writing DynamoDB rate-limit keys', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: '1' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(checkRateLimit('user:1', '/api/not-real-123?x=1', 'POST')).resolves.toMatchObject({
      allowed: true,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.Key.pk.S).toContain('write:user:1:/api/__unknown__');
    expect(body.Key.pk.S).not.toContain('not-real-123');
    expect(body.Key.pk.S).not.toContain('x=1');
  });

  it('fails closed in production when DynamoDB is configured but unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ddb unavailable'));

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
  });

  it('fails closed in production when the distributed store is not fully configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_misconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when APP_ENV marks production and the distributed store is not configured', async () => {
    vi.stubEnv('APP_ENV', 'production');
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_misconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed in production when RATE_LIMIT_STORE is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
    delete process.env.RATE_LIMIT_DDB_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await expect(
      checkAuthRateLimit('ip:203.0.113.10', '/api/auth/callback/credentials'),
    ).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_misconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts slow DynamoDB requests and fails closed in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.RATE_LIMIT_DDB_TIMEOUT_MS = '1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'store_unavailable',
    });
  });

  it('uses the default DynamoDB timeout when the configured timeout is malformed', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'ph-os-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.RATE_LIMIT_DDB_TIMEOUT_MS = '123abc';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';
    resetRateLimitStoreForTests();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: '1' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(checkRateLimit('user:1', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: true,
    });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), RATE_LIMIT_DDB_TIMEOUT_MS);
  });
});
