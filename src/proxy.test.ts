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

describe('proxy', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.JOB_API_KEY;
    resetRateLimitStoreForTests();
    process.env.AUTH_SECRET = 'test-secret';
    logSecurityEventMock.mockReset();
    getTokenMock.mockImplementation(async ({ req }: { req: NextRequest }) => {
      const userId = req.headers.get('x-rate-limit-user');
      return userId ? { userId } : null;
    });
  });

  it('skips non-api routes', async () => {
    const response = await proxy(
      createRequest({
        pathname: '/public-preview',
        method: 'GET',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain("style-src 'self' 'nonce-");
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'nonce-");
    expect(response.headers.get('Content-Security-Policy')).toContain("'strict-dynamic'");
    expect(response.headers.get('Content-Security-Policy')).not.toContain("'unsafe-inline'");
  });

  it('redirects unauthenticated protected routes to login with callbackUrl', async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await proxy(
      createRequest({
        pathname: '/patients',
        search: '?tab=active',
        method: 'GET',
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?callbackUrl=%2Fpatients%3Ftab%3Dactive',
    );
  });

  it('allows authenticated protected routes to continue', async () => {
    getTokenMock.mockResolvedValueOnce({ userId: 'user_1' });

    const response = await proxy(
      createRequest({
        pathname: '/dashboard',
        method: 'GET',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'nonce-");
  });

  it('allows safe API methods without origin validation and returns rate-limit headers', async () => {
    const response = await proxy(
      createRequest({
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(200);
    // GET uses RATE_LIMIT_READ_MAX; first request consumes one slot
    expect(response.headers.get('X-RateLimit-Remaining')).toBe(String(RATE_LIMIT_READ_MAX - 1));
    expect(response.headers.get('X-RateLimit-Reset')).not.toBeNull();
  });

  it('rejects state-changing requests from a different origin', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          host: 'ph-os.example',
          origin: 'https://attacker.example',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CSRF_VALIDATION_FAILED',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'csrf_rejected',
        path: '/api/patients',
        method: 'POST',
      }),
    );
  });

  it('redacts dynamic API path segments in CSRF security events', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/external-access/secret-token/self-report',
        headers: {
          host: 'ph-os.example',
          origin: 'https://attacker.example',
          'x-forwarded-for': '203.0.113.74',
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'csrf_rejected',
        path: '/api/external-access/:id/self-report',
        method: 'POST',
      }),
    );
    expect(logSecurityEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('secret-token'),
      }),
    );
  });

  it('allows verified server-to-server job requests with an API key even when origin is absent', async () => {
    process.env.JOB_API_KEY = 'job-secret';

    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/jobs/daily',
        headers: {
          host: 'ph-os.example',
          'x-api-key': 'job-secret',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(200);
    // POST uses RATE_LIMIT_WRITE_MAX; first request consumes one slot
    expect(response.headers.get('X-RateLimit-Remaining')).toBe(String(RATE_LIMIT_WRITE_MAX - 1));
  });

  it('does not let arbitrary API key headers bypass CSRF on normal API routes', async () => {
    process.env.JOB_API_KEY = 'job-secret';

    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/patients',
        headers: {
          host: 'ph-os.example',
          'x-api-key': 'job-secret',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CSRF_VALIDATION_FAILED',
    });
  });

  it('rate limits notification stream opens through the read budget', async () => {
    const response = await proxy(
      createRequest({
        pathname: '/api/notifications/stream',
        headers: {
          'x-forwarded-for': '203.0.113.80',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe(String(RATE_LIMIT_READ_MAX - 1));
  });

  it('returns 429 after the notification stream open budget is exhausted', async () => {
    const request = createRequest({
      pathname: '/api/notifications/stream',
      headers: {
        'x-forwarded-for': '203.0.113.81',
      },
    });

    for (let index = 0; index < RATE_LIMIT_READ_MAX; index += 1) {
      expect((await proxy(request)).status).toBe(200);
    }

    const response = await proxy(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'rate_limit_exceeded',
        path: '/api/notifications/stream',
        method: 'GET',
      }),
    );
  });

  it('does not exempt unknown stream-suffixed API paths from CSRF checks', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/not-real/stream',
        headers: {
          host: 'ph-os.example',
          'x-forwarded-for': '203.0.113.70',
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CSRF_VALIDATION_FAILED',
    });
  });

  it('does not exempt state-changing notification stream requests from CSRF checks', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/notifications/stream',
        headers: {
          host: 'ph-os.example',
          'x-forwarded-for': '203.0.113.75',
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CSRF_VALIDATION_FAILED',
    });
  });

  it('rate limits unknown stream-suffixed API paths through the unknown bucket', async () => {
    const headers = {
      'x-forwarded-for': '203.0.113.71',
    };

    for (let index = 0; index < RATE_LIMIT_READ_MAX; index += 1) {
      expect(
        (
          await proxy(
            createRequest({
              pathname: `/api/not-real-${index}/stream`,
              headers,
            }),
          )
        ).status,
      ).toBe(200);
    }

    const response = await proxy(
      createRequest({
        pathname: '/api/another-missing/stream',
        headers,
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'rate_limit_exceeded',
        path: '/api/__unknown__',
        method: 'GET',
      }),
    );
  });

  it('does not apply API checks to /api-prefixed non-API routes', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api-docs',
        headers: {
          host: 'ph-os.example',
          'x-forwarded-for': '203.0.113.72',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
  });

  it('skips rate limiting for health checks so liveness remains observable', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await proxy(
      createRequest({
        pathname: '/api/health',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(logSecurityEventMock).not.toHaveBeenCalled();
  });

  it('fails closed when production cannot resolve an unauthenticated client IP', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/auth/callback/credentials',
        headers: {
          host: 'ph-os.example',
          origin: 'https://ph-os.example',
          'x-api-key': 'test-key',
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_CLIENT_IP_UNAVAILABLE',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'rate_limit_exceeded',
        path: '/api/auth/:path*',
        details: expect.objectContaining({ reason: 'client_ip_unavailable' }),
      }),
    );
  });

  it('returns 503 when production rate-limit storage is misconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    delete process.env.RATE_LIMIT_STORE;
    resetRateLimitStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await proxy(
      createRequest({
        pathname: '/api/patients',
        headers: {
          'x-forwarded-for': '203.0.113.73',
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_UNAVAILABLE',
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
