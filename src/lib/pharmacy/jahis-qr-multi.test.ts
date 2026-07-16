import { describe, expect, it } from 'vitest';
import {
  assessJahisQrPageAddition,
  buildJahisQrExport,
  detectMultiQR,
  hasJahisQrSplitRecord,
  mergeJahisQRPages,
  mergeJahisQrPageTexts,
  parseJahisQR,
  splitJahisQrExport,
  type JahisQrExportInput,
} from './jahis-qr';

const EXPORT_INPUT = {
  patient: {
    name: '山田 太郎',
    nameKana: 'ヤマダ タロウ',
    gender: 'male',
    birthDate: '1945-02-03',
  },
  dispensingInstitution: {
    name: 'PH-OS薬局',
    prefCode: '13',
    scoreTableCode: '4',
    institutionCode: '7654321',
  },
  prescribingInstitution: {
    name: 'PH-OS Clinic',
    prefCode: '13',
    scoreTableCode: '1',
    institutionCode: '1234567',
  },
  dispensingDate: '2026-03-29',
  medications: Array.from({ length: 6 }, (_, index) => ({
    drugCodeType: 2 as const,
    drugCode: `61217070${index}`,
    drugName: `試験薬${index + 1}錠5mg`,
    dose: '1',
    unit: '錠',
    usageName: '1日1回朝食後',
    dispensingQuantity: '14',
    dispensingUnit: '日分',
    formCode: 1 as const,
    usageCodeType: 1 as const,
  })),
} satisfies JahisQrExportInput;

describe('JAHIS multi-QR export boundaries', () => {
  it('keeps an exactly fitting payload as one QR without Record 911', () => {
    const payload = buildJahisQrExport(EXPORT_INPUT);
    const pages = splitJahisQrExport(payload, {
      maxBytes: payload.bytes.length,
      dataId: '12345678901234',
    });

    expect(pages).toEqual([payload]);
    expect(detectMultiQR(pages[0].text)).toBeNull();
  });

  it('splits only at record boundaries and reconstructs the exact canonical payload', () => {
    const payload = buildJahisQrExport(EXPORT_INPUT);
    const maxBytes = 220;
    const pages = splitJahisQrExport(payload, { maxBytes, dataId: '12345678901234' });

    expect(pages.length).toBeGreaterThan(1);
    for (const [index, page] of pages.entries()) {
      expect(page.bytes.length).toBeLessThanOrEqual(maxBytes);
      expect(page.text.startsWith('JAHISTC08,1\r\n')).toBe(true);
      expect(page.text.endsWith(`911,12345678901234,${pages.length},${index + 1}\r\n`)).toBe(true);
      expect(page.splitInfo).toEqual({
        dataId: '12345678901234',
        splitCount: pages.length,
        sequenceNumber: index + 1,
      });
    }

    expect(mergeJahisQrPageTexts(pages.map((page) => page.text).reverse())).toBe(payload.text);
  });

  it('fails closed when one complete record cannot fit or inputs are not canonical', () => {
    const payload = buildJahisQrExport(EXPORT_INPUT);

    expect(() => splitJahisQrExport(payload, { maxBytes: 60, dataId: '12345678901234' })).toThrow(
      'JAHIS_QR_RECORD_CAPACITY_EXCEEDED',
    );
    expect(() => splitJahisQrExport(payload, { maxBytes: 220, dataId: 'not-fourteen' })).toThrow(
      'JAHIS_SPLIT_DATA_ID_INVALID',
    );
    expect(() =>
      splitJahisQrExport(
        { ...payload, bytes: payload.bytes.slice(1) },
        {
          maxBytes: 220,
          dataId: '12345678901234',
        },
      ),
    ).toThrow('JAHIS_PAYLOAD_BYTES_MISMATCH');
    expect(() =>
      splitJahisQrExport(payload, {
        maxBytes: 220,
        dataId: '12345678901234',
        maxPages: 2,
      }),
    ).toThrow('JAHIS_QR_SPLIT_COUNT_EXCEEDED');
  });
});

describe('JAHIS multi-QR reassembly', () => {
  const page1 = `JAHISTC08,1\r\n1,山田太郎,1,19450203,,,,,,,ヤマダタロウ\r\n201,1,試験薬錠5mg,1,錠,1,,1,,,\r\n911,12345678901234,2,1\r\n`;
  const page2 = `JAHISTC08,1\r\n301,1,1日1回朝食後,14,日分,1,1,,1\r\n911,12345678901234,2,2\r\n`;

  it('parses after raw-record reassembly when Record 201 and 301 span pages', () => {
    const merged = mergeJahisQRPages([parseJahisQR(page2), parseJahisQR(page1)]);

    expect(merged.patient.name).toBe('山田太郎');
    expect(merged.medications).toEqual([
      expect.objectContaining({
        drugName: '試験薬錠5mg',
        dose: '1',
        unit: '錠',
        usage: '1日1回朝食後',
        usageQuantity: '14',
        usageUnit: '日分',
      }),
    ]);
    expect(merged.rawText).not.toContain('911,');
  });

  it('rejects duplicate, incomplete, mixed, or malformed page sets', () => {
    expect(() => mergeJahisQrPageTexts([page1, page1])).toThrow('JAHIS_QR_PAGE_SEQUENCE_DUPLICATE');
    expect(() => mergeJahisQrPageTexts([page1])).toThrow('JAHIS_QR_PAGE_COUNT_MISMATCH');
    expect(() => mergeJahisQrPageTexts([page1, 'JAHISTC08,1\r\n1,別患者,1,19450203\r\n'])).toThrow(
      'JAHIS_QR_PAGE_SPLIT_MIXED',
    );
    expect(() =>
      mergeJahisQrPageTexts([
        page1,
        'JAHISTC08,1\r\n911,12345678901234,2,2\r\n301,1,朝食後,14,日分,1,1,,1\r\n',
      ]),
    ).toThrow('JAHIS_SPLIT_RECORD_ORDER_INVALID');
  });

  it('rejects malformed Record 911 values instead of partially parsing them', () => {
    const malformed = 'JAHISTC08,1\r\n911,short,2,1\r\n';
    expect(hasJahisQrSplitRecord(malformed)).toBe(true);
    expect(detectMultiQR(malformed)).toBeNull();
    expect(detectMultiQR('JAHISTC08,1\r\n911,12345678901234,1000,1\r\n')).toBeNull();
    expect(detectMultiQR('JAHISTC08,1\r\n911,12345678901234,2,3\r\n')).toBeNull();
  });

  it('rejects duplicate sequences and mixed page sets before scanner state changes', () => {
    expect(assessJahisQrPageAddition([page1], page1)).toEqual({
      success: false,
      reason: 'duplicate_sequence',
      sequenceNumber: 1,
    });
    expect(assessJahisQrPageAddition([page1], 'JAHISTC08,1\r\n911,99999999999999,2,2\r\n')).toEqual(
      { success: false, reason: 'mixed_page_set' },
    );
    expect(assessJahisQrPageAddition([page1], 'JAHISTC08,1\r\n1,通常QR,1,19450203\r\n')).toEqual({
      success: false,
      reason: 'mixed_page_set',
    });
    expect(assessJahisQrPageAddition([page1], page2)).toEqual({
      success: true,
      splitInfo: { dataId: '12345678901234', splitCount: 2, sequenceNumber: 2 },
    });
  });
});
