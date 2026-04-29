export const LEGACY_RUNTIME_CACHE_NAMES = ['api-cache', 'pages'] as const;
export const OFFLINE_PAGE_CACHE_NAME = 'offline-pages-v2';

export type RuntimeCachePolicy =
  | 'api-network-only'
  | 'navigation-network-only'
  | 'page-network-first'
  | 'asset-stale-while-revalidate'
  | 'image-cache-first'
  | 'unhandled';

type RuntimeCachePolicyInput = {
  request: Pick<Request, 'destination' | 'mode'>;
  url: Pick<URL, 'pathname'>;
};

export function isApiRequest(url: Pick<URL, 'pathname'>) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

export function isCacheableNavigation(url: Pick<URL, 'pathname'>) {
  return url.pathname === '/offline';
}

export function resolveRuntimeCachePolicy({
  request,
  url,
}: RuntimeCachePolicyInput): RuntimeCachePolicy {
  if (isApiRequest(url)) return 'api-network-only';
  if (request.mode === 'navigate') {
    return isCacheableNavigation(url) ? 'page-network-first' : 'navigation-network-only';
  }
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker'
  ) {
    return 'asset-stale-while-revalidate';
  }
  if (request.destination === 'image' || url.pathname.startsWith('/icons/')) {
    return 'image-cache-first';
  }
  return 'unhandled';
}
