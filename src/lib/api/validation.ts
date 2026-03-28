import { z } from 'zod';

export function parseSearchParams<T>(
  schema: z.ZodSchema<T>,
  params: URLSearchParams,
): { ok: true; data: T } | { ok: false; error: z.ZodError } {
  const raw = Object.fromEntries(params.entries());
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

export async function parseBody<T>(
  schema: z.ZodSchema<T>,
  request: Request,
): Promise<{ ok: true; data: T } | { ok: false; error: z.ZodError }> {
  const body = await request.json();
  const result = schema.safeParse(body);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}
