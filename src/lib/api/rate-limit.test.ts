import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  API_ROUTE_TEMPLATES,
  RATE_LIMIT_DDB_TIMEOUT_MS,
  SSE_MAX_CONNECTIONS,
  acquireSseConnection,
  canonicalizeRateLimitPath,
  checkAuthRateLimit,
  checkRateLimit,
  createRateLimiter,
  releaseSseConnection,
  resetRateLimitStoreForTests,
} from './rate-limit';

function collectRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return collectRouteFiles(fullPath);
    return entry === 'route.ts' ? [fullPath] : [];
  });
}

function routeFileToTemplate(filePath: string) {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  const routePath = relative(apiDir, filePath)
    .split(sep)
    .slice(0, -1)
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return ':path*';
      if (segment === '[token]') return ':token';
      if (segment === '[jobType]') return ':jobType';
      if (/^\[[^\]]+\]$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
  return `/api/${routePath}`;
}

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
    delete process.env.RATE_LIMIT_DDB_REGION;
    delete process.env.APP_ENV;
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    delete process.env.AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    delete process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    delete process.env.RATE_LIMIT_DDB_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  it('blocks requests after the configured max count', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('caps active SSE connections per identifier and releases capacity', () => {
    for (let index = 1; index <= SSE_MAX_CONNECTIONS; index += 1) {
      expect(acquireSseConnection('user:1')).toEqual({ allowed: true, count: index });
    }

    expect(acquireSseConnection('user:1')).toEqual({
      allowed: false,
      count: SSE_MAX_CONNECTIONS,
    });
    expect(acquireSseConnection('user:2')).toEqual({ allowed: true, count: 1 });

    releaseSseConnection('user:1');
    expect(acquireSseConnection('user:1')).toEqual({
      allowed: true,
      count: SSE_MAX_CONNECTIONS,
    });

    for (let index = 0; index <= SSE_MAX_CONNECTIONS + 1; index += 1) {
      releaseSseConnection('user:1');
    }
    expect(acquireSseConnection('user:1')).toEqual({ allowed: true, count: 1 });
  });

  it('keeps the rate-limit route template catalog in sync with App Router API files', () => {
    const apiDir = join(process.cwd(), 'src', 'app', 'api');
    const routeTemplates = collectRouteFiles(apiDir).map(routeFileToTemplate).sort();

    expect([...API_ROUTE_TEMPLATES].sort()).toEqual(routeTemplates);
  });

  it('keeps the rate-limit route template catalog unique', () => {
    expect(new Set(API_ROUTE_TEMPLATES).size).toBe(API_ROUTE_TEMPLATES.length);
  });

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

  it('scopes the default limiter by canonical route as well as identifier', async () => {
    // Use POST (write budget = 60) so the limit is reached within the loop.
    for (let index = 0; index < 60; index += 1) {
      await expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST')).resolves.toMatchObject({
        allowed: true,
      });
    }

    // 61st write request exceeds the write budget
    await expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
    });
    // Different canonical route has its own independent bucket
    await expect(
      checkRateLimit('203.0.113.10', '/api/visit-schedules', 'POST'),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('canonicalizes dynamic route segments while preserving static siblings', () => {
    expect(canonicalizeRateLimitPath('/api/patients/patient_1')).toBe('/api/patients/:id');
    expect(canonicalizeRateLimitPath('/api/patients/patient_2/timeline')).toBe(
      '/api/patients/:id/timeline',
    );
    expect(canonicalizeRateLimitPath('/api/patients/patient_1/insurance/insurance_1')).toBe(
      '/api/patients/:id/insurance/:id',
    );
    expect(canonicalizeRateLimitPath('/api/visit-schedules/schedule_1/reschedule')).toBe(
      '/api/visit-schedules/:id/reschedule',
    );
    expect(canonicalizeRateLimitPath('/api/care-reports/report_1/print-audit')).toBe(
      '/api/care-reports/:id/print-audit',
    );
    expect(canonicalizeRateLimitPath('/api/external-access/token_1/self-report')).toBe(
      '/api/external-access/:token/self-report',
    );
    expect(canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1')).toBe(
      '/api/patient-share-cases/:id',
    );
    expect(canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1/activate')).toBe(
      '/api/patient-share-cases/:id/activate',
    );
    expect(canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1/patient-link')).toBe(
      '/api/patient-share-cases/:id/patient-link',
    );
    expect(
      canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1/correction-requests'),
    ).toBe('/api/patient-share-cases/:id/correction-requests');
    expect(canonicalizeRateLimitPath('/api/pharmacy-cooperation-message-threads')).toBe(
      '/api/pharmacy-cooperation-message-threads',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-visit-requests/request_1/decision')).toBe(
      '/api/pharmacy-visit-requests/:id/decision',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-contracts/contract_1/versions')).toBe(
      '/api/pharmacy-contracts/:id/versions',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-partnerships/partnership_1/activate')).toBe(
      '/api/pharmacy-partnerships/:id/activate',
    );
    expect(canonicalizeRateLimitPath('/api/partner-visit-records/record_1/submit')).toBe(
      '/api/partner-visit-records/:id/submit',
    );
    expect(canonicalizeRateLimitPath('/api/partner-visit-records/record_1/review')).toBe(
      '/api/partner-visit-records/:id/review',
    );
    expect(
      canonicalizeRateLimitPath('/api/partner-visit-records/record_1/physician-report-draft'),
    ).toBe('/api/partner-visit-records/:id/physician-report-draft');
    expect(canonicalizeRateLimitPath('/api/admin/data-explorer/Patient/patient_1')).toBe(
      '/api/admin/data-explorer/:id/:id',
    );
    expect(canonicalizeRateLimitPath('/api/jobs/daily-medication-check')).toBe(
      '/api/jobs/:jobType',
    );
    expect(canonicalizeRateLimitPath('/api/patients/export')).toBe('/api/patients/export');
    expect(canonicalizeRateLimitPath('/api/patients/medications/bulk-export')).toBe(
      '/api/patients/medications/bulk-export',
    );
    expect(canonicalizeRateLimitPath('/api/drug-masters/batch')).toBe('/api/drug-masters/batch');
    expect(canonicalizeRateLimitPath('/api/pharmacy-drug-stocks/impact')).toBe(
      '/api/pharmacy-drug-stocks/impact',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-drug-stocks/safety-follow-up')).toBe(
      '/api/pharmacy-drug-stocks/safety-follow-up',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-drug-stock-templates/template_1/apply')).toBe(
      '/api/pharmacy-drug-stock-templates/:id/apply',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-operating-hours')).toBe(
      '/api/pharmacy-operating-hours',
    );
    expect(canonicalizeRateLimitPath('/api/drug-masters/drug_1/generic-recommendations')).toBe(
      '/api/drug-masters/:id/generic-recommendations',
    );
    expect(canonicalizeRateLimitPath('/api/drug-masters/drug_1/ingredient-group')).toBe(
      '/api/drug-masters/:id/ingredient-group',
    );
  });

  it('requires at least one segment for catch-all API route templates', () => {
    expect(canonicalizeRateLimitPath('/api/auth/callback/credentials')).toBe('/api/auth/:path*');
    expect(canonicalizeRateLimitPath('/api/auth')).toBe('/api/__unknown__');
  });

  it('canonicalizes path variants and unknown API paths to bounded buckets', () => {
    expect(canonicalizeRateLimitPath('/api/patients/patient_1/?tab=overview')).toBe(
      '/api/patients/:id',
    );
    expect(canonicalizeRateLimitPath('/api//patients//patient_1')).toBe('/api/patients/:id');
    expect(canonicalizeRateLimitPath('/api/not-real-a')).toBe('/api/__unknown__');
    expect(canonicalizeRateLimitPath('/settings')).toBe('/settings');
  });

  it('shares write budget across different ids for the same dynamic route', async () => {
    for (let index = 0; index < 60; index += 1) {
      await expect(
        checkRateLimit('203.0.113.10', `/api/patients/patient_${index}`, 'PATCH'),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/patient_final', 'PATCH'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
    });

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/export', 'POST'),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('shares write budget across nested dynamic route ids', async () => {
    for (let index = 0; index < 60; index += 1) {
      await expect(
        checkRateLimit(
          '203.0.113.10',
          `/api/patients/patient_1/insurance/insurance_${index}`,
          'PATCH',
        ),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/patient_1/insurance/insurance_final', 'PATCH'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
    });
  });

  it('canonicalizes patient home operations separately from unknown API paths', async () => {
    for (let index = 0; index < 300; index += 1) {
      await expect(
        checkRateLimit('203.0.113.10', `/api/not-real-${index}`, 'GET'),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/patient_1/home-operations', 'GET'),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('shares read budget across unknown API paths to prevent scan key churn', async () => {
    for (let index = 0; index < 300; index += 1) {
      await expect(
        checkRateLimit('203.0.113.10', `/api/not-real-${index}`, 'GET'),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/another-not-real-path', 'GET'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
    });
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
