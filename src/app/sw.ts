/// <reference lib="webworker" />

import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
} from 'serwist';
import {
  LEGACY_RUNTIME_CACHE_NAMES,
  OFFLINE_PAGE_CACHE_NAME,
  resolveRuntimeCachePolicy,
} from '../lib/offline/sw-cache-policy';

declare global {
  interface ServiceWorkerGlobalScope {
    __SW_MANIFEST: Array<PrecacheEntry | string>;
  }
}

declare const self: ServiceWorkerGlobalScope;

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ request, url }) =>
      ['api-network-only', 'navigation-network-only'].includes(
        resolveRuntimeCachePolicy({ request, url }),
      ),
    // API responses and authenticated route HTML can include PHI. Keep
    // intentional offline PHI in encrypted IndexedDB only, never in SW caches.
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request, url }) =>
      resolveRuntimeCachePolicy({ request, url }) === 'page-network-first',
    handler: new NetworkFirst({
      cacheName: OFFLINE_PAGE_CACHE_NAME,
      networkTimeoutSeconds: 3,
    }),
  },
  {
    matcher: ({ request, url }) =>
      resolveRuntimeCachePolicy({ request, url }) === 'asset-stale-while-revalidate',
    handler: new StaleWhileRevalidate({
      cacheName: 'assets',
    }),
  },
  {
    matcher: ({ request, url }) =>
      resolveRuntimeCachePolicy({ request, url }) === 'image-cache-first',
    handler: new CacheFirst({
      cacheName: 'images',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60,
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all(LEGACY_RUNTIME_CACHE_NAMES.map((cacheName) => self.caches.delete(cacheName))),
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: '新しい通知', body: '', link: '/' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: { url: data.link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(self.clients.openWindow(url));
});
