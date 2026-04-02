export const LOCAL_FALLBACK_AUTH_SECRET = 'careviax-local-auth-secret';
export const LOCAL_FALLBACK_AUTH_URL = 'http://localhost:3000';

function isHostedRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_EXECUTION_ENV);
}

export function getAuthSecret() {
  if (process.env.NEXTAUTH_SECRET) return process.env.NEXTAUTH_SECRET;
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (!isHostedRuntime()) return LOCAL_FALLBACK_AUTH_SECRET;
  return undefined;
}

export function getAuthBaseUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (!isHostedRuntime()) return LOCAL_FALLBACK_AUTH_URL;
  return undefined;
}
