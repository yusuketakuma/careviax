import { describe, expect, it } from 'vitest';

import {
  LEGACY_RUNTIME_CACHE_NAMES,
  OFFLINE_PAGE_CACHE_NAME,
  isApiRequest,
  resolveRuntimeCachePolicy,
} from './sw-cache-policy';

function policyFor({
  destination = '',
  mode = 'same-origin',
  pathname,
}: {
  destination?: RequestDestination;
  mode?: RequestMode;
  pathname: string;
}) {
  return resolveRuntimeCachePolicy({
    request: { destination, mode },
    url: { pathname },
  });
}

describe('Service Worker CacheStorage policy', () => {
  it('routes every /api path to network-only instead of CacheStorage', () => {
    expect(LEGACY_RUNTIME_CACHE_NAMES).toEqual(['api-cache', 'pages']);
    expect(LEGACY_RUNTIME_CACHE_NAMES).not.toContain(OFFLINE_PAGE_CACHE_NAME);
    expect(isApiRequest({ pathname: '/api' })).toBe(true);
    expect(isApiRequest({ pathname: '/api/patients' })).toBe(true);
    expect(isApiRequest({ pathname: '/api/visit-preparations/schedule-1' })).toBe(true);
    expect(isApiRequest({ pathname: '/apiary' })).toBe(false);

    expect(policyFor({ pathname: '/api/patients' })).toBe('api-network-only');
    expect(
      policyFor({
        destination: 'image',
        pathname: '/api/patients/avatar',
      }),
    ).toBe('api-network-only');
  });

  it('keeps only PHI-safe navigation pages and static assets cacheable', () => {
    expect(policyFor({ mode: 'navigate', pathname: '/dashboard' })).toBe('navigation-network-only');
    expect(policyFor({ mode: 'navigate', pathname: '/patients/patient_1' })).toBe(
      'navigation-network-only',
    );
    expect(policyFor({ mode: 'navigate', pathname: '/offline' })).toBe('page-network-first');
    expect(policyFor({ destination: 'script', pathname: '/_next/static/app.js' })).toBe(
      'asset-stale-while-revalidate',
    );
    expect(policyFor({ destination: 'style', pathname: '/_next/static/app.css' })).toBe(
      'asset-stale-while-revalidate',
    );
    expect(policyFor({ destination: 'worker', pathname: '/sw.js' })).toBe(
      'asset-stale-while-revalidate',
    );
    expect(policyFor({ destination: 'image', pathname: '/logo.png' })).toBe('image-cache-first');
    expect(policyFor({ pathname: '/icons/icon-192x192.png' })).toBe('image-cache-first');
  });
});
