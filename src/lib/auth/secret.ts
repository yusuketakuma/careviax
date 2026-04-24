export const LOCAL_FALLBACK_AUTH_SECRET = 'careviax-local-auth-secret';
export const LOCAL_FALLBACK_AUTH_URL = 'http://localhost:3000';

function isLocalFallbackAllowed() {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.PLAYWRIGHT === '1' ||
    process.env.ALLOW_LOCAL_AUTH_FALLBACK === '1' ||
    process.env.ALLOW_LOCAL_AUTH_FALLBACK === 'true'
  );
}

export function getAuthSecret() {
  if (process.env.NEXTAUTH_SECRET) return process.env.NEXTAUTH_SECRET;
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (isLocalFallbackAllowed()) return LOCAL_FALLBACK_AUTH_SECRET;
  return undefined;
}

export function getAuthBaseUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (isLocalFallbackAllowed()) return LOCAL_FALLBACK_AUTH_URL;
  return undefined;
}
