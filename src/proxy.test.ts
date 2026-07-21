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
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-src 'self' https://www.google.com",
    );
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
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

  it('fails closed for protected app routes when the auth secret is missing in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    const response = await proxy(
      createRequest({
        pathname: '/patients',
        method: 'GET',
        headers: {
          'x-forwarded-for': '203.0.113.50',
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_CONFIGURATION_ERROR',
    });
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'auth_failure',
        path: '/patients',
        details: { reason: 'auth_secret_missing' },
      }),
    );
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

  it.each([
    ['wrong scheme', 'http://ph-os.example'],
    ['wrong port', 'https://ph-os.example:444'],
    ['opaque null origin', 'null'],
    ['multiple origins', 'https://ph-os.example, https://attacker.example'],
    ['origin with a path', 'https://ph-os.example/api'],
    ['origin with credentials', 'https://user@ph-os.example'],
  ])('rejects %s instead of comparing only the host', async (_label, origin) => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          host: 'ph-os.example',
          origin,
          'x-forwarded-for': '203.0.113.11',
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CSRF_VALIDATION_FAILED',
    });
  });

  it('does not fall back to a matching Referer when Origin is present and mismatched', async () => {
    const response = await proxy(
      createRequest({
        method: 'PATCH',
        headers: {
          origin: 'https://attacker.example',
          referer: 'https://ph-os.example/patients',
          'x-forwarded-for': '203.0.113.12',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('accepts an exact canonical origin without trusting the raw Host header', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          host: 'attacker-controlled.example',
          origin: 'https://ph-os.example',
          'x-forwarded-for': '203.0.113.13',
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it('uses Referer only when Origin is absent and compares its complete origin', async () => {
    const accepted = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          referer: 'https://ph-os.example/patients?tab=active',
          'x-forwarded-for': '203.0.113.14',
        },
      }),
    );
    const rejected = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          referer: 'http://ph-os.example/patients',
          'x-forwarded-for': '203.0.113.15',
        },
      }),
    );

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(403);
  });

  it('prefers the server auth URL over a conflicting public app URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://public-alias.example';

    const canonicalResponse = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          origin: 'https://ph-os.example',
          'x-forwarded-for': '203.0.113.16',
        },
      }),
    );
    const publicAliasResponse = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          origin: 'https://public-alias.example',
          'x-forwarded-for': '203.0.113.17',
        },
      }),
    );

    expect(canonicalResponse.status).toBe(200);
    expect(publicAliasResponse.status).toBe(403);
  });

  it.each([
    ['an invalid canonical URL', 'not a url'],
    ['an insecure production canonical URL', 'http://ph-os.example'],
  ])('fails closed for %s', async (_label, nextAuthUrl) => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXTAUTH_URL = nextAuthUrl;

    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          origin: 'https://ph-os.example',
          'x-forwarded-for': '203.0.113.18',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('does not use the public app URL as the production CSRF authority', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.NEXTAUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://ph-os.example';

    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          origin: 'https://ph-os.example',
          'x-forwarded-for': '203.0.113.20',
        },
      }),
    );

    expect(response.status).toBe(403);
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
        path: '/api/external-access/:token/self-report',
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

  it('rejects a server-to-server API key request when it carries a mismatched browser Origin', async () => {
    process.env.JOB_API_KEY = 'job-secret';

    const response = await proxy(
      createRequest({
        method: 'POST',
        pathname: '/api/jobs/daily',
        headers: {
          origin: 'https://attacker.example',
          'x-api-key': 'job-secret',
          'x-forwarded-for': '203.0.113.19',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ['a non-POST method', 'DELETE', '/api/jobs/daily'],
    ['an unregistered nested path', 'POST', '/api/jobs/daily/run'],
  ])('does not apply the job S2S exception to %s', async (_label, method, pathname) => {
    process.env.JOB_API_KEY = 'job-secret';

    const response = await proxy(
      createRequest({
        method,
        pathname,
        headers: {
          'x-api-key': 'job-secret',
          'x-forwarded-for': '203.0.113.21',
        },
      }),
    );

    expect(response.status).toBe(403);
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

  it.each([
    '/api/auth/callback/credentials',
    '/api/auth/password/reset/request',
    '/api/auth/mfa/recovery',
  ])(
    'allows the unauthenticated auth entrypoint through a verified production proxy: %s',
    async (pathname) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
      vi.stubEnv('TRUSTED_PROXY_TOPOLOGY', 'single-overwrite');
      vi.stubEnv('TRUSTED_PROXY_HOPS', '0');
      vi.stubEnv('RATE_LIMIT_STORE', 'dynamodb');
      vi.stubEnv('RATE_LIMIT_DDB_TABLE_NAME', 'ph-os-rate-limit');
      vi.stubEnv('AWS_REGION', 'ap-northeast-1');
      vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-access-key');
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-key');
      resetRateLimitStoreForTests();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            Attributes: {
              hit_count: { N: '1' },
              reset_at: { N: String(Date.now() + 60_000) },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/x-amz-json-1.0' } },
        ),
      );

      const response = await proxy(
        createRequest({
          method: 'POST',
          pathname,
          headers: {
            host: 'ph-os.example',
            origin: 'https://ph-os.example',
            'x-forwarded-for': '203.0.113.73',
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Remaining')).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
      fetchMock.mockRestore();
    },
  );

  it('returns 503 when production rate-limit storage is misconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY_HEADERS', '1');
    vi.stubEnv('TRUSTED_PROXY_TOPOLOGY', 'single-overwrite');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '0');
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
});
