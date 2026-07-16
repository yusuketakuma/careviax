import { afterEach, describe, expect, it } from 'vitest';
import { getClientIp } from './request-ip';

describe('getClientIp', () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
  const originalTrustedProxyTopology = process.env.TRUSTED_PROXY_TOPOLOGY;
  const originalTrustedProxyHops = process.env.TRUSTED_PROXY_HOPS;
  const originalTrustedProxyCidrs = process.env.TRUSTED_PROXY_CIDRS;

  function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  afterEach(() => {
    restoreEnv('TRUST_PROXY_HEADERS', originalTrustProxyHeaders);
    restoreEnv('TRUSTED_PROXY_TOPOLOGY', originalTrustedProxyTopology);
    restoreEnv('TRUSTED_PROXY_HOPS', originalTrustedProxyHops);
    restoreEnv('TRUSTED_PROXY_CIDRS', originalTrustedProxyCidrs);
  });

  function useSingleOverwriteProxy() {
    process.env.TRUST_PROXY_HEADERS = 'true';
    process.env.TRUSTED_PROXY_TOPOLOGY = 'single-overwrite';
    process.env.TRUSTED_PROXY_HOPS = '0';
    process.env.TRUSTED_PROXY_CIDRS = '';
  }

  function useAppendProxy(hops: number) {
    process.env.TRUST_PROXY_HEADERS = 'true';
    process.env.TRUSTED_PROXY_TOPOLOGY = 'append-chain';
    process.env.TRUSTED_PROXY_HOPS = String(hops);
    process.env.TRUSTED_PROXY_CIDRS =
      hops === 0 ? '' : Array.from({ length: hops }, () => '10.0.0.0/8').join(',');
  }

  it('ignores proxy headers unless the complete topology is explicitly trusted', () => {
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_TOPOLOGY;
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUSTED_PROXY_CIDRS;

    expect(
      getClientIp({
        headers: new Headers({ 'x-forwarded-for': '203.0.113.10' }),
      }),
    ).toBeUndefined();

    process.env.TRUST_PROXY_HEADERS = 'true';
    expect(
      getClientIp({
        headers: new Headers({ 'x-forwarded-for': '203.0.113.10' }),
      }),
    ).toBeUndefined();
  });

  it('accepts one address from a single proxy that overwrites forwarded-for', () => {
    useSingleOverwriteProxy();

    expect(
      getClientIp({
        headers: new Headers({ 'x-forwarded-for': '203.0.113.10' }),
      }),
    ).toBe('203.0.113.10');
  });

  it('rejects a client-prepended chain in single-overwrite mode', () => {
    useSingleOverwriteProxy();

    expect(
      getClientIp({
        headers: new Headers({ 'x-forwarded-for': '198.51.100.200, 203.0.113.10' }),
      }),
    ).toBeUndefined();
  });

  it('selects the rightmost address when one append proxy receives client-supplied XFF', () => {
    useAppendProxy(0);

    expect(
      getClientIp({
        headers: new Headers({
          'x-forwarded-for': 'not-trusted-client-value, 203.0.113.10',
        }),
      }),
    ).toBe('203.0.113.10');
  });

  it('selects the client before an exact trusted multi-hop suffix', () => {
    useAppendProxy(1);

    expect(
      getClientIp({
        headers: new Headers({
          'x-forwarded-for': '198.51.100.200, 203.0.113.10, 10.0.0.1',
        }),
      }),
    ).toBe('203.0.113.10');
  });

  it('fails closed when the configured hop count exceeds the received chain', () => {
    useAppendProxy(2);

    expect(
      getClientIp({
        headers: new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }),
      }),
    ).toBeUndefined();
  });

  it('fails closed when a trusted suffix address is outside its ordered CIDR', () => {
    useAppendProxy(1);

    expect(
      getClientIp({
        headers: new Headers({ 'x-forwarded-for': '203.0.113.10, 192.0.2.10' }),
      }),
    ).toBeUndefined();
  });

  it('rejects malformed selected or trusted-suffix addresses', () => {
    useAppendProxy(1);

    for (const forwardedFor of [
      'not-an-ip, 10.0.0.1',
      '203.0.113.10, not-a-proxy-ip',
      '203.0.113.10,,10.0.0.1',
    ]) {
      expect(
        getClientIp({ headers: new Headers({ 'x-forwarded-for': forwardedFor }) }),
      ).toBeUndefined();
    }
  });

  it('accepts canonical IPv4 and IPv6 literals', () => {
    useSingleOverwriteProxy();

    for (const forwardedFor of ['203.0.113.10', '2001:db8::10']) {
      expect(getClientIp({ headers: new Headers({ 'x-forwarded-for': forwardedFor }) })).toBe(
        forwardedFor,
      );
    }
  });

  it('rejects non-canonical or decorated IP values', () => {
    useSingleOverwriteProxy();

    for (const forwardedFor of [
      '0177.0.0.1',
      '127.1',
      '192.168.001.010',
      '[2001:db8::1]',
      '203.0.113.10:443',
    ]) {
      expect(
        getClientIp({ headers: new Headers({ 'x-forwarded-for': forwardedFor }) }),
      ).toBeUndefined();
    }
  });

  it('does not fall back to a different proxy header', () => {
    useSingleOverwriteProxy();

    expect(
      getClientIp({
        headers: new Headers({ 'x-real-ip': '203.0.113.11' }),
      }),
    ).toBeUndefined();
    expect(
      getClientIp({
        headers: new Headers({
          'x-forwarded-for': 'not-an-ip',
          'x-real-ip': '203.0.113.11',
        }),
      }),
    ).toBeUndefined();
  });

  it('ignores oversized forwarded-for headers', () => {
    useAppendProxy(0);

    expect(
      getClientIp({
        headers: new Headers({
          'x-forwarded-for': `${'1'.repeat(600)}, 203.0.113.10`,
        }),
      }),
    ).toBeUndefined();
  });
});
