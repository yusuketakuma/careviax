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

function trimStringSearchParam(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.trim();
}

function boundedIntegerStringSchema(fieldName: string, min: number, max: number) {
  return z
    .string()
    .regex(/^-?\d+$/, `${fieldName} は整数で指定してください`)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

export function boundedIntegerSearchParam(
  fieldName: string,
  min: number,
  max: number,
  defaultValue: number,
) {
  return z
    .preprocess(trimStringSearchParam, boundedIntegerStringSchema(fieldName, min, max))
    .default(defaultValue);
}

export function optionalBoundedIntegerSearchParam(fieldName: string, min: number, max: number) {
  return z
    .preprocess(trimStringSearchParam, boundedIntegerStringSchema(fieldName, min, max))
    .optional();
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
