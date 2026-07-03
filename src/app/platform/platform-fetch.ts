/**
 * Shared fetch helper for `/platform` client panels. All `/api/platform/*`
 * routes respond with `{ code, message, details? }` on failure (see
 * `src/lib/api/response.ts`); this normalizes that into a typed error so
 * callers can branch on HTTP status (401 reauth failed, 403 forbidden/no
 * active session, 400 validation) without re-parsing the body everywhere.
 */
export class PlatformApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.code = code;
  }
}

export async function platformFetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    throw new PlatformApiError(
      payload?.message ?? 'リクエストに失敗しました',
      response.status,
      payload?.code,
    );
  }

  return response.json() as Promise<T>;
}
