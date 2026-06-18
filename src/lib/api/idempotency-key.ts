const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function parseOptionalIdempotencyKey(value: string | null) {
  if (value === null) return { ok: true as const, key: null };
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      ok: false as const,
      message: 'Idempotency-Keyが不正です',
    };
  }
  return { ok: true as const, key };
}
