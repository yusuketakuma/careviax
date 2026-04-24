export type JahisSupplementalRecordDetailView = {
  label: string;
  value: string;
};

export type JahisSupplementalRecordView = {
  id?: string;
  recordType: string;
  recordLabel: string;
  lineNumber: number;
  summary?: string | null;
  details?: JahisSupplementalRecordDetailView[];
  rawLine: string;
};

export type JahisSupplementalRecordDbView = {
  id: string;
  record_type: string;
  record_label: string;
  line_number: number;
  summary: string | null;
  payload: unknown;
  raw_line: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readJahisSupplementalDetails(
  payload: unknown,
): JahisSupplementalRecordDetailView[] {
  if (!isRecord(payload) || !Array.isArray(payload.details)) return [];

  return payload.details.flatMap((detail): JahisSupplementalRecordDetailView[] => {
    if (!isRecord(detail)) return [];
    const label = typeof detail.label === 'string' ? detail.label : null;
    const value = typeof detail.value === 'string' ? detail.value : null;
    return label && value ? [{ label, value }] : [];
  });
}

export function normalizeJahisSupplementalRecords(
  parsedRecords: JahisSupplementalRecordView[] | undefined,
  dbRecords: JahisSupplementalRecordDbView[] | undefined,
): JahisSupplementalRecordView[] {
  if (parsedRecords && parsedRecords.length > 0) return parsedRecords;

  return (dbRecords ?? []).map((record) => ({
    id: record.id,
    recordType: record.record_type,
    recordLabel: record.record_label,
    lineNumber: record.line_number,
    summary: record.summary ?? record.raw_line,
    details: readJahisSupplementalDetails(record.payload),
    rawLine: record.raw_line,
  }));
}
