import { readJsonObject } from '@/lib/db/json';

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

export function readJahisSupplementalDetails(
  payload: unknown,
): JahisSupplementalRecordDetailView[] {
  const record = readJsonObject(payload);
  if (!record || !Array.isArray(record.details)) return [];

  return record.details.flatMap((detail): JahisSupplementalRecordDetailView[] => {
    const detailRecord = readJsonObject(detail);
    if (!detailRecord) return [];
    const label = typeof detailRecord.label === 'string' ? detailRecord.label : null;
    const value = typeof detailRecord.value === 'string' ? detailRecord.value : null;
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
