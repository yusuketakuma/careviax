const MAX_FORWARDED_FOR_LENGTH = 512;

function isProxyHeaderTrusted() {
  const trustProxyHeaders =
    process.env.TRUST_PROXY_HEADERS === '1' ||
    process.env.TRUST_PROXY_HEADERS === 'true';

  if (!trustProxyHeaders) {
    return false;
  }

  return true;
}

function isValidIpLiteral(value: string) {
  if (!value || value.length > 45 || /\s/.test(value)) {
    return false;
  }

  if (value.includes(':')) {
    return /^[0-9A-Fa-f:.]+$/.test(value) && value.includes(':');
  }

  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const numeric = Number(part);
      return numeric >= 0 && numeric <= 255 && String(numeric) === part;
    })
  );
}

function readTrustedProxyHops() {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Extract the client IP address from trusted proxy headers.
 *
 * Next.js 15+ no longer exposes request.ip, so deployments that need client-IP
 * based controls must explicitly opt into trusting proxy headers. Leaving this
 * disabled avoids treating client-supplied headers as authoritative in
 * environments where a trusted reverse proxy is not guaranteed.
 */
export function getClientIp(request: { headers: Headers }): string | undefined {
  if (!isProxyHeaderTrusted()) {
    return undefined;
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor && forwardedFor.length <= MAX_FORWARDED_FOR_LENGTH) {
    const candidates = forwardedFor
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const trustedProxyHops = readTrustedProxyHops();
    const index =
      trustedProxyHops > 0 ? Math.max(0, candidates.length - trustedProxyHops - 1) : 0;
    const candidate = candidates[index];
    if (candidate && isValidIpLiteral(candidate)) {
      return candidate;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp && isValidIpLiteral(realIp) ? realIp : undefined;
}

export function isProductionLikeRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
}
