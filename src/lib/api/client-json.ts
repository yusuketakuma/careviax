function readApiErrorMessage(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }
  return null;
}

export async function readApiJson<T>(
  response: Response,
  fallbackMessage = '処理に失敗しました',
): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(json) ?? fallbackMessage);
  }
  return json as T;
}
