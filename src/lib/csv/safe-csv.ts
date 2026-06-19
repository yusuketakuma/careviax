export type CsvCellValue = string | number | null | undefined;

export function neutralizeCsvFormulaPrefix(raw: string) {
  return /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
}

export function quotedCsvCell(value: CsvCellValue) {
  if (value == null) return '';
  const safe = neutralizeCsvFormulaPrefix(String(value));
  return `"${safe.replace(/"/g, '""')}"`;
}

export function quotedCsvRow(values: CsvCellValue[]) {
  return values.map(quotedCsvCell).join(',');
}

export function minimalCsvCell(value: CsvCellValue) {
  if (value == null) return '';
  const safe = neutralizeCsvFormulaPrefix(String(value));
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function minimalCsvRow(values: CsvCellValue[]) {
  return values.map(minimalCsvCell).join(',');
}
