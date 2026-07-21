export function stringifyDataTableExportValue(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export function normalizeDataTableServerExportEndpoint(endpoint: string | undefined) {
  const trimmed = endpoint?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (!trimmed.startsWith('/api/')) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeNonPhiDataTableExportFileName(fileName: string | undefined) {
  const fallback = 'table-export.csv';
  const trimmed = fileName?.trim();
  if (!trimmed) return fallback;
  if (!/^[a-z0-9][a-z0-9._-]{0,78}\.csv$/i.test(trimmed)) return fallback;
  return trimmed;
}
