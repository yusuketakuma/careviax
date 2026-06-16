import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';
import { withSentryConfig } from '@sentry/nextjs';

// NOTE: Content-Security-Policy and other security headers are set dynamically
// in src/proxy.ts using a per-request nonce. Static headers here would
// conflict with the nonce-based CSP and are intentionally omitted.

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    authInterrupts: true,
    preloadEntriesOnStart: false,
    webpackMemoryOptimizations: true,
  },
  serverExternalPackages: ['@react-pdf/renderer'],
};

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production' || process.env.PLAYWRIGHT === '1',
  cacheOnNavigation: false,
  reloadOnOnline: false,
});

const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  sourcemaps: {
    disable: process.env.NODE_ENV !== 'production',
  },
  webpack: {
    reactComponentAnnotation: { enabled: true },
  },
};

export default withSentryConfig(withSerwist(nextConfig), sentryConfig);
