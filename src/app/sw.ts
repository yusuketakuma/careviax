/// <reference lib="webworker" />

import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
} from 'serwist';

declare global {
  interface ServiceWorkerGlobalScope {
    __SW_MANIFEST: Array<PrecacheEntry | string>;
  }
}

declare const self: ServiceWorkerGlobalScope;

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ request }) => request.mode === 'navigate',
    handler: new NetworkFirst({
      cacheName: 'pages',
      networkTimeoutSeconds: 3,
    }),
  },
  {
    matcher: ({ request }) =>
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'worker',
    handler: new StaleWhileRevalidate({
      cacheName: 'assets',
    }),
  },
  {
    matcher: ({ request, url }) =>
      request.destination === 'image' || url.pathname.startsWith('/icons/'),
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
