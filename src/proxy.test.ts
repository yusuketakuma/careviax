import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock security-events to avoid pulling in the Prisma client (DATABASE_URL not
// available in unit test environment).
vi.mock('@/lib/auth/security-events', () => ({
  logSecurityEvent: vi.fn(),
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
  });

  it('skips non-api routes', () => {
    const response = proxy(createRequest({ pathname: '/dashboard', method: 'GET' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
  });

  it('allows safe API methods without origin validation and returns rate-limit headers', () => {
    const response = proxy(
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
    const response = proxy(
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
  });

  it('allows state-changing requests with an API key even when origin is absent', () => {
    const response = proxy(
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

  it('skips long-lived stream endpoints', () => {
    const response = proxy(
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
      expect(proxy(request).status).toBe(200);
    }

    const response = proxy(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
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
      expect(proxy(request).status).toBe(200);
    }

    const response = proxy(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('GET and POST share separate budgets for the same IP and route', () => {
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
      proxy(postReq);
    }
    expect(proxy(postReq).status).toBe(429);

    // GET budget is independent — should still be allowed
    const getReq = createRequest({
      method: 'GET',
      pathname,
      headers: { 'x-forwarded-for': ip },
    });
    expect(proxy(getReq).status).toBe(200);
  });
});
