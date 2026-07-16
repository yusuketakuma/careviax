import { describe, expect, it } from 'vitest';
import {
  assertJahisExportRecordOrder,
  JAHIS_EXPORT_CONTRACT_V2_6,
  serializeJahisExportRecord,
} from './jahis-export-contract';

describe('JAHIS_EXPORT_CONTRACT_V2_6', () => {
  it('pins the official version and current export record order', () => {
    expect(JAHIS_EXPORT_CONTRACT_V2_6).toMatchObject({
      documentId: 'JAHIS-24-104',
      version: '2.6',
      header: 'JAHISTC08',
      outputType: '1',
      recordOrder: ['1', '5', '11', '51', '55', '201', '301'],
    });
  });

  it('serializes an exact medication record including trailing generic fields', () => {
    expect(
      serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['201'], [
        '1',
        'アムロジピン錠5mg',
        '1',
        '錠',
        '1',
        '',
        '1',
        '',
        '',
        '',
      ]),
    ).toBe('201,1,アムロジピン錠5mg,1,錠,1,,1,,,');
  });

  it('serializes the official 14-digit and 1-999 split control fields', () => {
    expect(
      serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['911'], [
        '12345678901234',
        '2',
        '1',
      ]),
    ).toBe('911,12345678901234,2,1');
    expect(() =>
      serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['911'], [
        '1234567890123',
        '2',
        '1',
      ]),
    ).toThrow('JAHIS_FIELD_VALUE_INVALID:911:data_id');
  });

  it.each([
    ['JAHIS_FIELD_REQUIRED:201:dose', ['1', 'アムロジピン', '', '錠', '1', '', '1', '', '', '']],
    [
      'JAHIS_FIELD_TYPE_INVALID:201:dose',
      ['1', 'アムロジピン', '1錠', '錠', '1', '', '1', '', '', ''],
    ],
    [
      'JAHIS_FIELD_VALUE_INVALID:201:drug_code_type',
      ['1', 'アムロジピン', '1', '錠', '5', '', '1', '', '', ''],
    ],
  ])('rejects invalid fields with a non-PHI reason: %s', (message, values) => {
    expect(() =>
      serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['201'], values),
    ).toThrow(message);
  });

  it('rejects missing, reordered, or unpaired mandatory records', () => {
    expect(() => assertJahisExportRecordOrder(['1', '5', '11', '51', '201', '301'])).not.toThrow();
    expect(() => assertJahisExportRecordOrder(['1', '5', '51', '11', '201', '301'])).toThrow(
      'JAHIS_RECORD_ORDER_INVALID',
    );
    expect(() => assertJahisExportRecordOrder(['1', '5', '11', '51'])).toThrow(
      'JAHIS_REQUIRED_RECORD_MISSING:201',
    );
    expect(() => assertJahisExportRecordOrder(['1', '5', '11', '51', '201'])).toThrow(
      'JAHIS_RECORD_ORDER_INVALID',
    );
  });
});
