/**
 * Extract the client IP address from request headers.
 * Prefers X-Forwarded-For (set by AWS ALB/CloudFront) over X-Real-IP.
 */
export function getClientIp(request: { headers: Headers }): string | undefined {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    undefined
  );
}
