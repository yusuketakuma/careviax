import { describe, expect, it } from 'vitest';
import { resolveTrustedProxyConfig } from './proxy-trust';

describe('resolveTrustedProxyConfig', () => {
  it('accepts the single overwrite topology only with zero trailing hops', () => {
    expect(
      resolveTrustedProxyConfig({
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'single-overwrite',
        TRUSTED_PROXY_HOPS: '0',
      }),
    ).toEqual({
      ok: true,
      config: { topology: 'single-overwrite', trustedProxyHops: 0, trustedProxyCidrs: [] },
    });

    expect(
      resolveTrustedProxyConfig({
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'single-overwrite',
        TRUSTED_PROXY_HOPS: '1',
      }),
    ).toMatchObject({ ok: false });
  });

  it('accepts an explicit bounded append chain', () => {
    expect(
      resolveTrustedProxyConfig({
        TRUST_PROXY_HEADERS: '1',
        TRUSTED_PROXY_TOPOLOGY: 'append-chain',
        TRUSTED_PROXY_HOPS: '2',
        TRUSTED_PROXY_CIDRS: '10.0.0.0/8,2001:db8::/32',
      }),
    ).toEqual({
      ok: true,
      config: {
        topology: 'append-chain',
        trustedProxyHops: 2,
        trustedProxyCidrs: ['10.0.0.0/8', '2001:db8::/32'],
      },
    });
  });

  it.each([
    [{}, 'TRUST_PROXY_HEADERS'],
    [{ TRUST_PROXY_HEADERS: 'false' }, 'TRUST_PROXY_HEADERS'],
    [{ TRUST_PROXY_HEADERS: 'true', TRUSTED_PROXY_HOPS: '0' }, 'TRUSTED_PROXY_TOPOLOGY'],
    [
      {
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'direct',
        TRUSTED_PROXY_HOPS: '0',
      },
      'TRUSTED_PROXY_TOPOLOGY',
    ],
    [
      {
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'append-chain',
        TRUSTED_PROXY_HOPS: '',
      },
      'TRUSTED_PROXY_HOPS',
    ],
    [
      {
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'append-chain',
        TRUSTED_PROXY_HOPS: '01',
      },
      'TRUSTED_PROXY_HOPS',
    ],
    [
      {
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'append-chain',
        TRUSTED_PROXY_HOPS: '9',
      },
      'TRUSTED_PROXY_HOPS',
    ],
    [
      {
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'append-chain',
        TRUSTED_PROXY_HOPS: '1',
        TRUSTED_PROXY_CIDRS: '',
      },
      'TRUSTED_PROXY_CIDRS',
    ],
    [
      {
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_TOPOLOGY: 'append-chain',
        TRUSTED_PROXY_HOPS: '1',
        TRUSTED_PROXY_CIDRS: '10.0.0.0/99',
      },
      'TRUSTED_PROXY_CIDRS',
    ],
  ])('rejects incomplete or unsafe topology %#', (env, expectedReason) => {
    const result = resolveTrustedProxyConfig(env);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid proxy topology');
    expect(result.reason).toContain(expectedReason);
  });
});
