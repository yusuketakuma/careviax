export const SENSITIVE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
} as const;

export function withSensitiveNoStore<T extends Response>(response: T): T {
  for (const [key, value] of Object.entries(SENSITIVE_NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}
