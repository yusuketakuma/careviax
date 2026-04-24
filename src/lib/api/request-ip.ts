/**
 * Extract the client IP address from trusted proxy headers.
 *
 * Next.js 15+ no longer exposes request.ip, so deployments that need client-IP
 * based controls must explicitly opt into trusting proxy headers. Leaving this
 * disabled avoids treating client-supplied headers as authoritative in
 * environments where a trusted reverse proxy is not guaranteed.
 */
export function getClientIp(request: { headers: Headers }): string | undefined {
  const trustProxyHeaders =
    process.env.TRUST_PROXY_HEADERS === '1' ||
    process.env.TRUST_PROXY_HEADERS === 'true';

  if (!trustProxyHeaders) {
    return undefined;
  }

  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    undefined
  );
}
