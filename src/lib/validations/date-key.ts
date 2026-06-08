import { z } from 'zod';

export const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value: string) {
  if (!dateKeyPattern.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function dateKeySchema(message: string) {
  return z.string().trim().refine(isValidDateKey, message);
}
