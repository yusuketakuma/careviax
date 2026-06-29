import { describe, expect, it } from 'vitest';
import {
  collectDuplicatePrescriptionLines,
  collectStructuringBlockedLines,
} from './intake-validation';

describe('collectDuplicatePrescriptionLines', () => {
  it('groups duplicates by drug code when present and falls back to trimmed name', () => {
    expect(
      collectDuplicatePrescriptionLines([
        { line_number: 1, drug_name: 'A錠', drug_code: ' 100 ' },
        { line_number: 2, drug_name: 'A generic', drug_code: '100' },
        { line_number: 3, drug_name: ' B散 ' },
        { line_number: 4, drug_name: 'B散' },
        { line_number: 5, drug_name: 'C錠', drug_code: '200' },
      ]),
    ).toEqual([
      {
        key: '100',
        lines: [
          { line_number: 1, drug_name: 'A錠' },
          { line_number: 2, drug_name: 'A generic' },
        ],
      },
      {
        key: 'B散',
        lines: [
          { line_number: 3, drug_name: ' B散 ' },
          { line_number: 4, drug_name: 'B散' },
        ],
      },
    ]);
  });

  it('groups duplicates by drug_master_id before drug_code differences', () => {
    expect(
      collectDuplicatePrescriptionLines([
        {
          line_number: 1,
          drug_name: '旧表示名',
          drug_master_id: 'drug_master_1',
          drug_code: 'YJ_OLD',
        },
        {
          line_number: 2,
          drug_name: '新表示名',
          drug_master_id: 'drug_master_1',
          drug_code: 'YJ_NEW',
        },
      ]),
    ).toEqual([
      {
        key: 'YJ_OLD',
        lines: [
          { line_number: 1, drug_name: '旧表示名' },
          { line_number: 2, drug_name: '新表示名' },
        ],
      },
    ]);
  });

  it('does not collapse an unresolved drug name that looks like a resolved drug code', () => {
    expect(
      collectDuplicatePrescriptionLines([
        { line_number: 1, drug_name: '2149001', drug_code: undefined },
        { line_number: 2, drug_name: '別名薬', drug_code: '2149001' },
      ]),
    ).toEqual([]);
  });
});

describe('collectStructuringBlockedLines', () => {
  it('returns unknown or unconfirmed lines and lines without a drug code', () => {
    expect(
      collectStructuringBlockedLines([
        { line_number: 1, drug_name: 'A錠', drug_code: '100' },
        { line_number: 2, drug_name: '未確認薬', drug_code: '200' },
        { line_number: 3, drug_name: 'B散' },
      ]),
    ).toEqual([
      { line_number: 2, drug_name: '未確認薬', drug_code: '200' },
      { line_number: 3, drug_name: 'B散' },
    ]);
  });
});
