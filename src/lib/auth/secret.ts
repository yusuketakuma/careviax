const LOCAL_FALLBACK_AUTH_SECRET = 'careviax-local-auth-secret';

function isHostedRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_EXECUTION_ENV);
}

export function getAuthSecret() {
  if (process.env.NEXTAUTH_SECRET) return process.env.NEXTAUTH_SECRET;
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (!isHostedRuntime()) return LOCAL_FALLBACK_AUTH_SECRET;
  return undefined;
}
