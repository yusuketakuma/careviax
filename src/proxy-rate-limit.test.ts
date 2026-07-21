import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getTokenMock, logSecurityEventMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  logSecurityEventMock: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

vi.mock('@/lib/auth/security-events', () => ({
  logSecurityEvent: logSecurityEventMock,
}));

import {
  resetRateLimitStoreForTests,
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_READ_MAX,
  RATE_LIMIT_WRITE_MAX,
} from '@/lib/api/rate-limit';
import { proxy } from './proxy';

function createRequest(args?: {
  pathname?: string;
  method?: string;
  search?: string;
  headers?: Record<string, string>;
}) {
  const pathname = args?.pathname ?? '/api/patients';
  const method = args?.method ?? 'GET';
  const search = args?.search ?? '';
  return new NextRequest(`http://localhost${pathname}${search}`, {
    method,
    headers: args?.headers,
  });
}

describe('proxy rate limits', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_TOPOLOGY;
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUSTED_PROXY_CIDRS;
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.JOB_API_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXTAUTH_URL = 'https://ph-os.example';
    resetRateLimitStoreForTests();
    process.env.AUTH_SECRET = 'test-secret';
    logSecurityEventMock.mockReset();
    getTokenMock.mockReset();
    getTokenMock.mockImplementation(async ({ req }: { req: NextRequest }) => {
      const userId = req.headers.get('x-rate-limit-user');
      return userId ? { userId } : null;
    });
  });
  it('returns 429 after the GET request budget is exhausted for a route', async () => {
    const request = createRequest({
      headers: {
        'x-forwarded-for': '203.0.113.10',
      },
    });

    for (let index = 0; index < RATE_LIMIT_READ_MAX; index += 1) {
      expect((await proxy(request)).status).toBe(200);
    }

    const response = await proxy(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'rate_limit_exceeded',
        path: '/api/patients',
        method: 'GET',
      }),
    );
  });

  it('returns 429 after the POST write budget is exhausted', async () => {
    const request = createRequest({
      method: 'POST',
      headers: {
        host: 'ph-os.example',
        origin: 'https://ph-os.example',
        'x-api-key': 'test-key',
        'x-forwarded-for': '203.0.113.10',
      },
    });

    for (let index = 0; index < RATE_LIMIT_WRITE_MAX; index += 1) {
      expect((await proxy(request)).status).toBe(200);
    }

    const response = await proxy(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('returns 429 when POST requests churn ids under the same dynamic route', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    vi.stubEnv('TRUSTED_PROXY_TOPOLOGY', 'single-overwrite');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '0');
    const baseHeaders = {
      host: 'ph-os.example',
      origin: 'https://ph-os.example',
      'x-api-key': 'test-key',
      'x-forwarded-for': '203.0.113.60',
    };

    for (let index = 0; index < RATE_LIMIT_WRITE_MAX; index += 1) {
      const response = await proxy(
        createRequest({
          method: 'PATCH',
          pathname: `/api/patients/patient_${index}`,
          headers: baseHeaders,
        }),
      );
      expect(response.status).toBe(200);
    }

    const response = await proxy(
      createRequest({
        method: 'PATCH',
        pathname: '/api/patients/patient_final',
        headers: baseHeaders,
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'rate_limit_exceeded',
        path: '/api/patients/:id',
        method: 'PATCH',
        details: expect.objectContaining({
          rate_limited_identifier: 'ip:203.0.113.60',
        }),
      }),
    );

    expect(
      (
        await proxy(
          createRequest({
            method: 'PATCH',
            pathname: '/api/patients/patient_other_ip',
            headers: {
              ...baseHeaders,
              'x-forwarded-for': '203.0.113.63',
            },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it('keeps static API siblings separate from dynamic route buckets', async () => {
    const baseHeaders = {
      host: 'ph-os.example',
      origin: 'https://ph-os.example',
      'x-api-key': 'test-key',
      'x-forwarded-for': '203.0.113.61',
    };

    for (let index = 0; index < RATE_LIMIT_WRITE_MAX; index += 1) {
      expect(
        (
          await proxy(
            createRequest({
              method: 'PATCH',
              pathname: `/api/patients/patient_${index}`,
              headers: baseHeaders,
            }),
          )
        ).status,
      ).toBe(200);
    }

    expect(
      (
        await proxy(
          createRequest({
            method: 'POST',
            pathname: '/api/patients/medications/bulk-export',
            headers: baseHeaders,
          }),
        )
      ).status,
    ).toBe(200);
  });

  it('returns 429 when GET requests churn unknown API paths', async () => {
    const headers = {
      'x-forwarded-for': '203.0.113.62',
    };

    for (let index = 0; index < RATE_LIMIT_READ_MAX; index += 1) {
      const response = await proxy(
        createRequest({
          pathname: `/api/not-real-${index}`,
          headers,
        }),
      );
      expect(response.status).toBe(200);
    }

    const response = await proxy(
      createRequest({
        pathname: '/api/another-missing-route',
        headers,
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('returns 429 when write requests churn unknown API paths', async () => {
    const baseHeaders = {
      host: 'ph-os.example',
      origin: 'https://ph-os.example',
      'x-api-key': 'test-key',
      'x-forwarded-for': '203.0.113.64',
    };

    for (let index = 0; index < RATE_LIMIT_WRITE_MAX; index += 1) {
      const response = await proxy(
        createRequest({
          method: 'PATCH',
          pathname: `/api/not-real-write-${index}`,
          headers: baseHeaders,
        }),
      );
      expect(response.status).toBe(200);
    }

    const response = await proxy(
      createRequest({
        method: 'PATCH',
        pathname: '/api/another-missing-write-route',
        headers: baseHeaders,
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('uses the strict auth limiter for credentials login attempts', async () => {
    const request = createRequest({
      method: 'POST',
      pathname: '/api/auth/callback/credentials',
      headers: {
        host: 'ph-os.example',
        origin: 'https://ph-os.example',
        'x-api-key': 'test-key',
        'x-forwarded-for': '203.0.113.50',
      },
    });

    for (let index = 0; index < RATE_LIMIT_AUTH_MAX; index += 1) {
      expect((await proxy(request)).status).toBe(200);
    }

    const response = await proxy(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('uses the strict auth limiter for trailing-slash credentials attempts', async () => {
    const request = createRequest({
      method: 'POST',
      pathname: '/api/auth/callback/credentials/',
      headers: {
        host: 'ph-os.example',
        origin: 'https://ph-os.example',
        'x-api-key': 'test-key',
        'x-forwarded-for': '203.0.113.51',
      },
    });

    for (let index = 0; index < RATE_LIMIT_AUTH_MAX; index += 1) {
      expect((await proxy(request)).status).toBe(200);
    }

    const response = await proxy(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('shares strict auth budget across credentials path variants', async () => {
    const headers = {
      host: 'ph-os.example',
      origin: 'https://ph-os.example',
      'x-api-key': 'test-key',
      'x-forwarded-for': '203.0.113.52',
    };

    for (let index = 0; index < RATE_LIMIT_AUTH_MAX; index += 1) {
      const pathname =
        index % 2 === 0 ? '/api/auth/callback/credentials' : '/api/auth/callback/credentials/';
      expect(
        (
          await proxy(
            createRequest({
              method: 'POST',
              pathname,
              headers,
            }),
          )
        ).status,
      ).toBe(200);
    }

    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/auth/callback/credentials/',
        headers,
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('uses the strict auth limiter for duplicate-slash credentials attempts', async () => {
    const request = createRequest({
      method: 'POST',
      pathname: '/api/auth//callback/credentials',
      headers: {
        host: 'ph-os.example',
        origin: 'https://ph-os.example',
        'x-api-key': 'test-key',
        'x-forwarded-for': '203.0.113.53',
      },
    });

    for (let index = 0; index < RATE_LIMIT_AUTH_MAX; index += 1) {
      expect((await proxy(request)).status).toBe(200);
    }

    const response = await proxy(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('GET and POST share separate budgets for the same IP and route', async () => {
    const ip = '203.0.113.20';
    const pathname = '/api/patients';

    // Exhaust the write budget
    const postReq = createRequest({
      method: 'POST',
      pathname,
      headers: {
        host: 'ph-os.example',
        origin: 'https://ph-os.example',
        'x-api-key': 'test-key',
        'x-forwarded-for': ip,
      },
    });
    for (let i = 0; i < RATE_LIMIT_WRITE_MAX; i++) {
      await proxy(postReq);
    }
    expect((await proxy(postReq)).status).toBe(429);

    // GET budget is independent — should still be allowed
    const getReq = createRequest({
      method: 'GET',
      pathname,
      headers: { 'x-forwarded-for': ip },
    });
    expect((await proxy(getReq)).status).toBe(200);
  });

  it('uses user id as the rate-limit key when a session token is available', async () => {
    const pathname = '/api/patients';
    const baseHeaders = {
      host: 'ph-os.example',
      origin: 'https://ph-os.example',
      'x-api-key': 'test-key',
      'x-forwarded-for': '203.0.113.30',
    };

    const userOneRequest = createRequest({
      method: 'POST',
      pathname,
      headers: {
        ...baseHeaders,
        'x-rate-limit-user': 'user_1',
      },
    });
    const userTwoRequest = createRequest({
      method: 'POST',
      pathname,
      headers: {
        ...baseHeaders,
        'x-rate-limit-user': 'user_2',
      },
    });

    for (let index = 0; index < RATE_LIMIT_WRITE_MAX; index += 1) {
      expect((await proxy(userOneRequest)).status).toBe(200);
    }

    expect((await proxy(userOneRequest)).status).toBe(429);
    expect((await proxy(userTwoRequest)).status).toBe(200);
  });

  it('uses the local fallback auth secret to keep per-user rate limiting in local environments', async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    const pathname = '/api/patients';
    const baseHeaders = {
      host: 'ph-os.example',
      origin: 'https://ph-os.example',
      'x-api-key': 'test-key',
      'x-forwarded-for': '203.0.113.40',
    };

    const userOneRequest = createRequest({
      method: 'POST',
      pathname,
      headers: {
        ...baseHeaders,
        'x-rate-limit-user': 'user_local_1',
      },
    });
    const userTwoRequest = createRequest({
      method: 'POST',
      pathname,
      headers: {
        ...baseHeaders,
        'x-rate-limit-user': 'user_local_2',
      },
    });

    for (let index = 0; index < RATE_LIMIT_WRITE_MAX; index += 1) {
      expect((await proxy(userOneRequest)).status).toBe(200);
    }

    expect((await proxy(userOneRequest)).status).toBe(429);
    expect((await proxy(userTwoRequest)).status).toBe(200);
    expect(getTokenMock).toHaveBeenCalled();
  });
});
