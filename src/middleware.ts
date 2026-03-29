import { type NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware: generates a per-request CSP nonce and applies
 * strict Content-Security-Policy headers.
 *
 * The nonce is forwarded to the root layout via the `x-nonce` response header
 * so that <Script> components and inline styles can reference it.
 *
 * In development, `unsafe-eval` is added to script-src only — Next.js HMR
 * requires it. It is never present in production builds.
 */
export function middleware(request: NextRequest) {
  // Generate a cryptographically random nonce (base64, URL-safe)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Buffer.from(nonceBytes).toString('base64');

  const isDev = process.env.NODE_ENV === 'development';

  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}'`;

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Cognito hosted UI + AWS SDK endpoints
    "connect-src 'self' https://*.amazonaws.com https://*.cognito.ap-northeast-1.amazonaws.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  // Pass nonce to server components (read via next/headers in the root layout)
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Set strict security headers on every response
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  /**
   * Match all routes except:
   * - Next.js internals (_next/static, _next/image)
   * - Static file extensions (fonts, images, etc.)
   * - Service worker
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|workbox-).*)',
  ],
};
