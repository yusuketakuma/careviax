import { afterEach, describe, expect, it } from 'vitest';
import { getClientIp } from './request-ip';

describe('getClientIp', () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
  const originalTrustedProxyHops = process.env.TRUSTED_PROXY_HOPS;

  afterEach(() => {
    process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    process.env.TRUSTED_PROXY_HOPS = originalTrustedProxyHops;
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
    delete process.env.TRUSTED_PROXY_HOPS;

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      }),
    });

    expect(ip).toBe('203.0.113.10');
  });

  it('uses the client address before the configured trusted proxy hops', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    process.env.TRUSTED_PROXY_HOPS = '1';

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': '198.51.100.200, 203.0.113.10, 10.0.0.1',
      }),
    });

    expect(ip).toBe('203.0.113.10');
  });

  it('ignores malformed forwarded values', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': 'not an ip',
        'x-real-ip': '203.0.113.11',
      }),
    });

    expect(ip).toBe('203.0.113.11');
  });

  it('rejects invalid IPv6-looking forwarded values', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    for (const forwardedFor of ['::::', '::ffff:999.999.999.999', '[2001:db8::1]']) {
      const ip = getClientIp({
        headers: new Headers({
          'x-forwarded-for': forwardedFor,
          'x-real-ip': '2001:db8::11',
        }),
      });

      expect(ip).toBe('2001:db8::11');
    }
  });

  it('accepts valid IPv6 forwarded values', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': '2001:db8::10',
      }),
    });

    expect(ip).toBe('2001:db8::10');
  });

  it('rejects non-canonical IPv4 forwarded values', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    for (const forwardedFor of ['0177.0.0.1', '127.1', '192.168.001.010']) {
      const ip = getClientIp({
        headers: new Headers({
          'x-forwarded-for': forwardedFor,
          'x-real-ip': '203.0.113.11',
        }),
      });

      expect(ip).toBe('203.0.113.11');
    }
  });

  it('ignores oversized forwarded-for headers', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    const ip = getClientIp({
      headers: new Headers({
        'x-forwarded-for': `${'1'.repeat(600)}, 203.0.113.10`,
        'x-real-ip': '203.0.113.11',
      }),
    });

    expect(ip).toBe('203.0.113.11');
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
