export const SENSITIVE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
} as const;

export function withSensitiveNoStore<T extends Response>(response: T): T {
  const existingCacheDirectives = new Set(
    (response.headers.get('Cache-Control') ?? '')
      .split(',')
      .map((directive) => directive.trim().toLowerCase()),
  );
  const preservedDirectives = ['no-cache', 'no-transform'].filter((directive) =>
    existingCacheDirectives.has(directive),
  );

  response.headers.set(
    'Cache-Control',
    [SENSITIVE_NO_STORE_HEADERS['Cache-Control'], ...preservedDirectives].join(', '),
  );
  response.headers.set('Pragma', SENSITIVE_NO_STORE_HEADERS.Pragma);
  return response;
}
