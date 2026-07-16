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

  it.each([
    ['2', ['1', '乳製品', '1'], '2,1,乳製品,1'],
    [
      '3',
      ['バファリンＡ', '20160411', '20160411', '2', '', ''],
      '3,バファリンＡ,20160411,20160411,2,,',
    ],
    ['31', ['1', 'イブプロフェン', '2', '1149001', '2'], '31,1,イブプロフェン,2,1149001,2'],
    ['4', ['予防接種を受けた', 'H280411', '2'], '4,予防接種を受けた,H280411,2'],
    ['15', ['工業会 次郎', '03-4567-4567', '1'], '15,工業会 次郎,03-4567-4567,1'],
  ] as const)('serializes the official Record %s sample', (recordType, values, expected) => {
    expect(serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records[recordType], values)).toBe(
      expected,
    );
  });

  it('accepts official Western and Japanese-era dates', () => {
    expect(
      serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['5'], ['20160411', '1']),
    ).toBe('5,20160411,1');
    expect(
      serializeJahisExportRecord(JAHIS_EXPORT_CONTRACT_V2_6.records['5'], ['H280411', '1']),
    ).toBe('5,H280411,1');
  });

  it.each([
    [
      'JAHIS_FIELD_VALUE_INVALID:3:start_date',
      JAHIS_EXPORT_CONTRACT_V2_6.records['3'],
      ['バファリンＡ', '2016041', '', '2', '', ''],
    ],
    [
      'JAHIS_FIELD_VALUE_INVALID:3:jan_code',
      JAHIS_EXPORT_CONTRACT_V2_6.records['3'],
      ['バファリンＡ', '', '', '2', '', '123'],
    ],
    [
      'JAHIS_FIELD_VALUE_INVALID:31:ingredient_code',
      JAHIS_EXPORT_CONTRACT_V2_6.records['31'],
      ['1', 'イブプロフェン', '1', '1149001', '2'],
    ],
    [
      'JAHIS_FIELD_BYTE_LIMIT_EXCEEDED:2:patient_note',
      JAHIS_EXPORT_CONTRACT_V2_6.records['2'],
      ['1', 'あ'.repeat(61), '1'],
    ],
  ] as const)('rejects an invalid supplemental record: %s', (message, contract, values) => {
    expect(() => serializeJahisExportRecord(contract, values)).toThrow(message);
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
