import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

// NOTE: Content-Security-Policy and other security headers are set dynamically
// in src/proxy.ts using a per-request nonce. Static headers here would
// conflict with the nonce-based CSP and are intentionally omitted.

const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
  },
  serverExternalPackages: ['@react-pdf/renderer'],
};

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  cacheOnNavigation: true,
  reloadOnOnline: true,
});

export default withSerwist(nextConfig);
