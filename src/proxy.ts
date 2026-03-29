import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { logSecurityEvent } from '@/lib/auth/security-events';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isValidOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  // At least one of origin or referer must match the host
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

  // Allow requests with API key (server-to-server, e.g., EventBridge jobs)
  if (request.headers.get('x-api-key')) return true;

  return false;
}

export function proxy(request: NextRequest) {
  // Only process API routes
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Skip SSE stream endpoints (long-lived connections; connection count is
  // gated separately inside the stream route handler via acquireSseConnection).
  if (request.nextUrl.pathname.endsWith('/stream')) {
    return NextResponse.next();
  }

  // CSRF protection: validate Origin/Referer for state-changing methods
  if (!isValidOrigin(request)) {
    logSecurityEvent({
      event_type: 'csrf_rejected',
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      details: {
        origin: request.headers.get('origin') ?? undefined,
        referer: request.headers.get('referer') ?? undefined,
      },
    });
    return NextResponse.json(
      { code: 'CSRF_VALIDATION_FAILED', message: 'リクエストの送信元が不正です' },
      { status: 403 }
    );
  }

  const identifier =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  // Pass the HTTP method so GET requests get a higher budget than writes.
  const result = checkRateLimit(identifier, request.nextUrl.pathname, request.method);

  if (!result.allowed) {
    logSecurityEvent({
      event_type: 'rate_limit_exceeded',
      ip_address: identifier !== 'unknown' ? identifier : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      details: {
        reset_at: result.resetAt,
      },
    });
    return NextResponse.json(
      { code: 'RATE_LIMIT_EXCEEDED', message: 'リクエスト数が上限に達しました' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.resetAt),
        },
      }
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(result.resetAt));
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
