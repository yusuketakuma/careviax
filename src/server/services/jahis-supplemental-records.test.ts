import { describe, expect, it } from 'vitest';
import { readJahisSupplementalRecords } from './jahis-supplemental-records';

describe('jahis-supplemental-records', () => {
  it('keeps valid supplemental records and drops malformed or unknown record types', () => {
    expect(
      readJahisSupplementalRecords([
        {
          recordType: '421',
          recordLabel: '残薬確認',
          lineNumber: 12,
          fields: ['残薬あり', 123, '次回確認'],
          details: [{ label: '残薬内容', value: '残薬あり' }, { label: '空値', value: '' }, null],
          summary: '残薬あり',
          rawLine: '421,残薬あり,次回確認',
        },
        {
          recordType: '999',
          recordLabel: '未知レコード',
          lineNumber: 13,
          fields: ['未知'],
          details: [{ label: '内容', value: '未知' }],
          summary: '未知',
          rawLine: '999,未知',
        },
        [],
        null,
      ]),
    ).toEqual([
      {
        recordType: '421',
        recordLabel: '残薬確認',
        lineNumber: 12,
        fields: ['残薬あり', '次回確認'],
        details: [{ label: '残薬内容', value: '残薬あり' }],
        summary: '残薬あり',
        rawLine: '421,残薬あり,次回確認',
      },
    ]);
  });
});
