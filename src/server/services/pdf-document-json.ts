import { readJsonObject } from '@/lib/db/json';

export type PdfJsonRow = {
  label: string;
  value: string;
};

export function readPdfJsonObject(value: unknown): Record<string, unknown> {
  return readJsonObject(value) ?? {};
}

export function readPdfJsonObjectField(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  return readJsonObject(readJsonObject(value)?.[key]);
}

export function readPdfJsonArrayField(value: unknown, key: string): unknown[] {
  const field = readJsonObject(value)?.[key];
  return Array.isArray(field) ? field : [];
}

export function readPdfJsonObjects(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = readJsonObject(item);
    return object ? [object] : [];
  });
}

export function flattenPdfJson(value: unknown, labelPrefix = ''): PdfJsonRow[] {
  if (value == null) {
    return labelPrefix ? [{ label: labelPrefix, value: '—' }] : [];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return labelPrefix ? [{ label: labelPrefix, value: '—' }] : [];
    }

    if (
      value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))
    ) {
      return labelPrefix
        ? [{ label: labelPrefix, value: value.map((item) => String(item ?? '—')).join(' / ') }]
        : [];
    }

    return value.flatMap((item, index) =>
      flattenPdfJson(item, labelPrefix ? `${labelPrefix}[${index + 1}]` : `[${index + 1}]`),
    );
  }

  const object = readJsonObject(value);
  if (object) {
    const entries = Object.entries(object);
    if (entries.length === 0) {
      return labelPrefix ? [{ label: labelPrefix, value: '—' }] : [];
    }

    return entries.flatMap(([key, nextValue]) =>
      flattenPdfJson(nextValue, labelPrefix ? `${labelPrefix}.${key}` : key),
    );
  }

  return labelPrefix ? [{ label: labelPrefix, value: String(value) }] : [];
}
