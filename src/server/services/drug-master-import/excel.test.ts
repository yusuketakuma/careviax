import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbookBuffer, readWorkbookRows } from './excel';

describe('readWorkbookRows', () => {
  it('reads a named worksheet when preferredSheet is provided', async () => {
    const workbook = await buildWorkbookBuffer({
      First: [['ignored']],
      Target: [['header'], ['value']],
    });

    await expect(readWorkbookRows(workbook, 'Target')).resolves.toEqual([
      ['header'],
      ['value'],
    ]);
  });

  it('throws when the preferred worksheet is missing', async () => {
    const workbook = await buildWorkbookBuffer({
      First: [['only']],
    });

    await expect(readWorkbookRows(workbook, 'Missing')).rejects.toThrow(
      "Excel ワークシート 'Missing' を解決できませんでした"
    );
  });

  it('normalizes date cells and preserves formatted numeric text after reload', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    const row = worksheet.addRow(['header']);
    row.getCell(1).value = new Date(Date.UTC(2027, 2, 31));
    row.getCell(1).numFmt = 'yyyy/mm/dd';
    row.getCell(2).value = 6.3;
    row.getCell(2).numFmt = '0.00';

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(readWorkbookRows(buffer)).resolves.toEqual([['2027/03/31', '6.30']]);
  });
});
