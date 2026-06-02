import { Prisma } from '@prisma/client';

export function normalizeJsonInput(value: unknown): Prisma.InputJsonValue | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonInput(item) ?? null);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, normalizeJsonInput(item)] as const)
        .filter(
          (entry): entry is readonly [string, Prisma.InputJsonValue | null] =>
            entry[1] !== undefined,
        ),
    );
  }
  return null;
}

export function toPrismaJsonInput(value: unknown) {
  const normalized = normalizeJsonInput(value);
  return normalized === undefined || normalized === null ? Prisma.JsonNull : normalized;
}

export function parseJsonOrNull(value: string | null | undefined): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseJsonObjectOrNull(value: string | null | undefined) {
  return readJsonObject(parseJsonOrNull(value));
}

export function readJsonObjectString(input: unknown, key: string) {
  const object = readJsonObject(input);
  if (!object) return null;
  const value = object[key];
  return typeof value === 'string' ? value : null;
}

export function readJsonObjectNumber(input: unknown, key: string) {
  const object = readJsonObject(input);
  if (!object) return null;
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
