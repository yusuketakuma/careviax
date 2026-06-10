import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  canonicalizeRateLimitPath,
  checkAuthRateLimit,
  checkRateLimit,
} from '@/lib/api/rate-limit';
import { logSecurityEvent } from '@/lib/auth/security-events';
import { getClientIp, isProductionLikeRuntime } from '@/lib/api/request-ip';
import { getAuthSecret } from '@/lib/auth/secret';

/**
 * Next.js 16 proxy.ts — the single Edge middleware entry point.
 *
 * Responsibilities (in order):
 *  1. CSRF protection for API routes
 *  2. Rate limiting for API routes
 *  3. Per-request CSP nonce generation + security headers for all routes
 *
 * Fix 1: btoa + Array.from instead of Buffer.from — Edge Runtime compatible.
 * Fix 2: proxy logic and CSP nonce logic merged here (middleware.ts removed).
 * Fix 6: Static CSP directives hoisted to module level.
 */

// ---------------------------------------------------------------------------
// Fix 6: Static CSP directives — only nonce-bearing parts change per request
// ---------------------------------------------------------------------------
const CSP_STATIC_TAIL = [
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Cognito hosted UI + AWS SDK endpoints
  "connect-src 'self' https://*.amazonaws.com https://*.cognito.ap-northeast-1.amazonaws.com",
  "frame-src 'self' https://www.google.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

const IS_DEV = process.env.NODE_ENV === 'development';
const IS_E2E = process.env.PLAYWRIGHT === '1';
const PROTECTED_ROUTE_PREFIXES = [
  '/admin',
  '/auditing',
  '/billing',
  '/communications',
  '/conferences',
  '/dashboard',
  '/dispensing',
  '/external',
  '/handoff',
  '/medication-sets',
  '/my-day',
  '/notifications',
  '/patients',
  '/prescriptions',
  '/qr-scan',
  '/referrals',
  '/reports',
  '/schedules',
  '/settings',
  '/tasks',
  '/visits',
  '/workflow',
] as const;

// ---------------------------------------------------------------------------
// CSRF helpers
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hasValidServerToServerApiKey(request: NextRequest) {
  return (
    request.nextUrl.pathname.startsWith('/api/jobs/') &&
    Boolean(process.env.JOB_API_KEY) &&
    request.headers.get('x-api-key') === process.env.JOB_API_KEY
  );
}

function isValidOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
      if (appUrl && originHost === new URL(appUrl).host) return true;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost === host) return true;
      if (appUrl && refererHost === new URL(appUrl).host) return true;
    } catch {
      return false;
    }
  }

  // Allow only verified server-to-server job requests (e.g., EventBridge).
  if (hasValidServerToServerApiKey(request)) return true;

  return false;
}

function isProtectedAppRoute(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function normalizeProxyPathname(pathname: string) {
  const collapsed = (pathname || '/').replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

function isApiPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isStrictAuthRateLimitPath(pathname: string) {
  return normalizeProxyPathname(pathname) === '/api/auth/callback/credentials';
}

function isRateLimitExemptApiPath(pathname: string) {
  const normalized = normalizeProxyPathname(pathname);
  return normalized === '/api/health';
}

function isRateLimitStoreUnavailable(reason: unknown) {
  return reason === 'store_misconfigured' || reason === 'store_unavailable';
}

function buildMissingAuthSecretResponse(request: NextRequest) {
  logSecurityEvent({
    event_type: 'auth_failure',
    ip_address: getClientIp(request),
    path: normalizeProxyPathname(request.nextUrl.pathname),
    method: request.method,
    details: { reason: 'auth_secret_missing' },
  });

  return NextResponse.json(
    {
      code: 'AUTH_CONFIGURATION_ERROR',
      message: '認証設定を利用できません',
    },
    { status: 503 },
  );
}

// ---------------------------------------------------------------------------
// Main proxy export — called by Next.js on every matched request
// ---------------------------------------------------------------------------

async function resolveRateLimitIdentity(request: NextRequest) {
  const ipAddress = getClientIp(request) ?? 'unknown';
  const secret = getAuthSecret();

  if (secret) {
    try {
      const token = await getToken({ req: request, secret });
      const userId =
        typeof token?.userId === 'string'
          ? token.userId
          : typeof token?.sub === 'string'
            ? token.sub
            : undefined;

      if (userId) {
        return {
          identifier: `user:${userId}`,
          userId,
          ipAddress: ipAddress !== 'unknown' ? ipAddress : undefined,
        };
      }
    } catch {
      // Fall back to IP-based limiting when the session token is unavailable.
    }
  }

  if (ipAddress === 'unknown' && isProductionLikeRuntime()) {
    return {
      identifier: null,
      userId: undefined,
      ipAddress: undefined,
    };
  }

  return {
    identifier: `ip:${ipAddress}`,
    userId: undefined,
    ipAddress: ipAddress !== 'unknown' ? ipAddress : undefined,
  };
}

export async function proxy(request: NextRequest) {
  const normalizedPathname = normalizeProxyPathname(request.nextUrl.pathname);

  // --- Step 1: API-only checks (CSRF + rate limit) ---
  if (isApiPath(normalizedPathname) && !IS_E2E) {
    const auditPath = canonicalizeRateLimitPath(normalizedPathname);

    // CSRF protection: validate Origin/Referer for state-changing methods
    if (!isValidOrigin(request)) {
      logSecurityEvent({
        event_type: 'csrf_rejected',
        ip_address: getClientIp(request),
        path: auditPath,
        method: request.method,
        details: {
          origin: request.headers.get('origin') ?? undefined,
          referer: request.headers.get('referer') ?? undefined,
        },
      });
      return NextResponse.json(
        { code: 'CSRF_VALIDATION_FAILED', message: 'リクエストの送信元が不正です' },
        { status: 403 },
      );
    }

    if (isRateLimitExemptApiPath(normalizedPathname)) {
      return buildResponse(request, null);
    }

    const identity = await resolveRateLimitIdentity(request);
    if (!identity.identifier) {
      logSecurityEvent({
        event_type: 'rate_limit_exceeded',
        path: auditPath,
        method: request.method,
        details: {
          reason: 'client_ip_unavailable',
        },
      });
      return NextResponse.json(
        {
          code: 'RATE_LIMIT_CLIENT_IP_UNAVAILABLE',
          message: 'レート制限に必要なクライアントIPを特定できません',
        },
        { status: 503 },
      );
    }

    const result = isStrictAuthRateLimitPath(normalizedPathname)
      ? await checkAuthRateLimit(identity.identifier, normalizedPathname)
      : await checkRateLimit(identity.identifier, normalizedPathname, request.method);

    if (!result.allowed) {
      const storeUnavailable = isRateLimitStoreUnavailable(result.reason);
      logSecurityEvent({
        event_type: 'rate_limit_exceeded',
        ip_address: identity.ipAddress,
        user_id: identity.userId,
        path: auditPath,
        method: request.method,
        details: {
          reset_at: result.resetAt,
          rate_limited_identifier: identity.identifier,
          reason: result.reason,
        },
      });
      return NextResponse.json(
        storeUnavailable
          ? {
              code: 'RATE_LIMIT_UNAVAILABLE',
              message: 'レート制限システムを利用できません',
            }
          : { code: 'RATE_LIMIT_EXCEEDED', message: 'リクエスト数が上限に達しました' },
        {
          status: storeUnavailable ? 503 : 429,
          headers: {
            'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(result.resetAt),
          },
        },
      );
    }

    // Rate-limit headers will be added to the final response below
    // (after CSP nonce is generated)
    const rateLimitHeaders = {
      remaining: String(result.remaining),
      reset: String(result.resetAt),
    };

    return buildResponse(request, rateLimitHeaders);
  }

  // --- Step 2: Non-API routes — nonce + security headers only ---
  if (isProtectedAppRoute(request.nextUrl.pathname)) {
    const secret = getAuthSecret();
    if (!secret && isProductionLikeRuntime()) {
      return buildMissingAuthSecretResponse(request);
    }
    if (secret) {
      try {
        const token = await getToken({ req: request, secret });
        if (!token) {
          const loginUrl = request.nextUrl.clone();
          loginUrl.pathname = '/login';
          loginUrl.search = '';
          const callbackUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
          loginUrl.searchParams.set('callbackUrl', callbackUrl);
          return NextResponse.redirect(loginUrl);
        }
      } catch {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        loginUrl.search = '';
        const callbackUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
        loginUrl.searchParams.set('callbackUrl', callbackUrl);
        return NextResponse.redirect(loginUrl);
      }
    }
  }

  return buildResponse(request, null);
}

// ---------------------------------------------------------------------------
// Shared response builder: generates nonce, applies CSP + security headers
// ---------------------------------------------------------------------------

function buildResponse(
  request: NextRequest,
  rateLimitHeaders: { remaining: string; reset: string } | null,
): NextResponse {
  // Fix 1: btoa + Array.from — works in Edge Runtime (no Buffer)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(Array.from(nonceBytes, (b) => String.fromCharCode(b)).join(''));

  const scriptSrc = IS_DEV
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const styleSrc = IS_DEV || IS_E2E ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    ...CSP_STATIC_TAIL,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  // Pass nonce to server components (read via next/headers in the root layout)
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (rateLimitHeaders) {
    response.headers.set('X-RateLimit-Remaining', rateLimitHeaders.remaining);
    response.headers.set('X-RateLimit-Reset', rateLimitHeaders.reset);
  }

  return response;
}

export const config = {
  /**
   * Match all routes except Next.js internals and static assets.
   * API routes are included so CSRF + rate limiting applies.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|workbox-).*)'],
};
