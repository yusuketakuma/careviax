import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
  headers?: Record<string, string>;
}) {
  const pathname = args?.pathname ?? '/api/patients';
  const method = args?.method ?? 'GET';
  const headers = new Map(
    Object.entries(args?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    method,
    headers: {
      get: (key: string) => headers.get(key.toLowerCase()) ?? null,
    },
    nextUrl: {
      pathname,
    },
  } as unknown as NextRequest;
}

describe('proxy', () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
    process.env.AUTH_SECRET = 'test-secret';
    logSecurityEventMock.mockReset();
    getTokenMock.mockImplementation(async ({ req }: { req: NextRequest }) => {
      const userId = req.headers.get('x-rate-limit-user');
      return userId ? { userId } : null;
    });
  });

  it('skips non-api routes', async () => {
    const response = await proxy(createRequest({ pathname: '/dashboard', method: 'GET' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain("style-src 'self' 'nonce-");
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'nonce-");
    expect(response.headers.get('Content-Security-Policy')).toContain("'strict-dynamic'");
    expect(response.headers.get('Content-Security-Policy')).not.toContain("'unsafe-inline'");
  });

  it('allows safe API methods without origin validation and returns rate-limit headers', async () => {
    const response = await proxy(
      createRequest({
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
      })
    );

    expect(response.status).toBe(200);
    // GET uses RATE_LIMIT_READ_MAX; first request consumes one slot
    expect(response.headers.get('X-RateLimit-Remaining')).toBe(
      String(RATE_LIMIT_READ_MAX - 1)
    );
    expect(response.headers.get('X-RateLimit-Reset')).not.toBeNull();
  });

  it('rejects state-changing requests from a different origin', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          host: 'careviax.example',
          origin: 'https://attacker.example',
          'x-forwarded-for': '203.0.113.10',
        },
      })
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
      })
    );
  });

  it('allows state-changing requests with an API key even when origin is absent', async () => {
    const response = await proxy(
      createRequest({
        method: 'POST',
        headers: {
          host: 'careviax.example',
          'x-api-key': 'test-key',
          'x-forwarded-for': '203.0.113.10',
        },
      })
    );

    expect(response.status).toBe(200);
    // POST uses RATE_LIMIT_WRITE_MAX; first request consumes one slot
    expect(response.headers.get('X-RateLimit-Remaining')).toBe(
      String(RATE_LIMIT_WRITE_MAX - 1)
    );
  });

  it('skips long-lived stream endpoints', async () => {
    const response = await proxy(
      createRequest({
        pathname: '/api/notifications/stream',
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
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
      })
    );
  });

  it('returns 429 after the POST write budget is exhausted', async () => {
    const request = createRequest({
      method: 'POST',
      headers: {
        host: 'careviax.example',
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

  it('GET and POST share separate budgets for the same IP and route', async () => {
    const ip = '203.0.113.20';
    const pathname = '/api/patients';

    // Exhaust the write budget
    const postReq = createRequest({
      method: 'POST',
      pathname,
      headers: {
        host: 'careviax.example',
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
      host: 'careviax.example',
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
      host: 'careviax.example',
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
