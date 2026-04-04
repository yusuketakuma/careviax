import ExcelJS from 'exceljs';

type RowValue = string | number | boolean | Date | null;
type WorkbookBinary = Parameters<ExcelJS.Workbook['xlsx']['load']>[0];

function isDateLike(value: unknown): value is Date {
  return value instanceof Date || Object.prototype.toString.call(value) === '[object Date]';
}

function formatDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function formatNumber(cell: ExcelJS.Cell, value: number) {
  const decimalMatch = cell.numFmt?.match(/0\.([0#]+)/);
  if (decimalMatch) {
    return value.toFixed(decimalMatch[1].length);
  }

  const text = cell.text.trim();
  return text || String(value);
}

function formatCellValue(cell: ExcelJS.Cell): string | null {
  const value = cell.value;
  const text = cell.text.trim();
  if (value == null) return null;

  if (isDateLike(value)) {
    return formatDate(value);
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return text || String(value);
  }

  if (typeof value === 'number') {
    return formatNumber(cell, value);
  }

  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText.map((fragment) => fragment.text).join('');
    }

    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }

    if ('formula' in value || 'sharedFormula' in value) {
      if (isDateLike(value.result)) {
        return formatDate(value.result);
      }
      if (typeof value.result === 'number') {
        return formatNumber(cell, value.result);
      }
      if (value.result != null) {
        return text || String(value.result);
      }
      return text || null;
    }

    if ('error' in value && value.error) {
      return value.error;
    }
  }

  return text.length > 0 ? text : String(value);
}

export async function loadWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as WorkbookBinary);
  return workbook;
}

export function readWorkbookRowsFromWorkbook(
  workbook: ExcelJS.Workbook,
  preferredSheet?: string
) {
  const worksheet = preferredSheet
    ? workbook.getWorksheet(preferredSheet)
    : workbook.worksheets[0];
  if (preferredSheet && !worksheet) {
    throw new Error(`Excel ワークシート '${preferredSheet}' を解決できませんでした`);
  }
  if (!worksheet) {
    throw new Error('Excel ワークシートを解決できませんでした');
  }

  const rows: Array<Array<string | null>> = [];
  const width = worksheet.columnCount;

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const values = Array.from({ length: width }, (_, columnIndex) =>
      formatCellValue(row.getCell(columnIndex + 1))
    );

    while (values.length > 0 && values[values.length - 1] == null) {
      values.pop();
    }

    rows.push(values);
  }

  while (rows.length > 0 && rows[rows.length - 1]?.length === 0) {
    rows.pop();
  }

  return rows;
}

export async function readWorkbookRows(buffer: Buffer, preferredSheet?: string) {
  const workbook = await loadWorkbook(buffer);
  return readWorkbookRowsFromWorkbook(workbook, preferredSheet);
}

export async function buildWorkbookBuffer(sheets: Record<string, RowValue[][]>) {
  const workbook = new ExcelJS.Workbook();

  for (const [sheetName, rows] of Object.entries(sheets)) {
    const worksheet = workbook.addWorksheet(sheetName);
    for (const row of rows) {
      worksheet.addRow(row);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
