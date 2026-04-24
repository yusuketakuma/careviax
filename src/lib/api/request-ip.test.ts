import { afterEach, describe, expect, it } from 'vitest';
import { getClientIp } from './request-ip';

describe('getClientIp', () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;

  afterEach(() => {
    process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
  });

  it('ignores proxy headers unless explicitly trusted', () => {
    delete process.env.TRUST_PROXY_HEADERS;

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        'x-real-ip': '203.0.113.11',
      }),
    });

    expect(ip).toBeUndefined();
  });

  it('uses the first forwarded address when proxy headers are trusted', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      }),
    });

    expect(ip).toBe('203.0.113.10');
  });

  it('falls back to x-real-ip when forwarded-for is absent', () => {
    process.env.TRUST_PROXY_HEADERS = '1';

    const ip = getClientIp({
      headers: new Headers({
        'x-real-ip': '203.0.113.11',
      }),
    });

    expect(ip).toBe('203.0.113.11');
  });
});
