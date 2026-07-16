import { isIP } from 'node:net';
import { isAddressInCidr } from './proxy-trust-cidr';
import { resolveTrustedProxyConfig } from './proxy-trust';

const MAX_FORWARDED_FOR_LENGTH = 512;

function isValidIpLiteral(value: string) {
  if (!value || value.length > 45 || /\s/.test(value)) {
    return false;
  }

  const family = isIP(value);
  if (family === 6) return true;
  if (family !== 4) return false;

  const parts = value.split('.');
  return parts.every((part) => String(Number(part)) === part);
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
  const proxyConfig = resolveTrustedProxyConfig();
  if (!proxyConfig.ok) return undefined;

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (!forwardedFor || forwardedFor.length > MAX_FORWARDED_FOR_LENGTH) return undefined;

  const candidates = forwardedFor.split(',').map((value) => value.trim());
  if (candidates.length === 0 || candidates.some((candidate) => candidate.length === 0)) {
    return undefined;
  }

  if (proxyConfig.config.topology === 'single-overwrite' && candidates.length !== 1) {
    return undefined;
  }

  const index = candidates.length - proxyConfig.config.trustedProxyHops - 1;
  if (index < 0) return undefined;

  const trustedSuffix = candidates.slice(index);
  if (!trustedSuffix.every(isValidIpLiteral)) return undefined;

  const trustedProxyAddresses = candidates.slice(index + 1);
  if (
    !trustedProxyAddresses.every((address, offset) =>
      isAddressInCidr(address, proxyConfig.config.trustedProxyCidrs[offset] ?? ''),
    )
  ) {
    return undefined;
  }

  return candidates[index];
}

export function isProductionLikeRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
}
