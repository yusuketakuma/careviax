import { describe, expect, it } from 'vitest';
import {
  normalizeJahisSupplementalRecords,
  readJahisSupplementalDetails,
} from './jahis-supplemental-records-view';

describe('jahis-supplemental-records-view', () => {
  it('reads only object-shaped supplemental detail rows', () => {
    expect(
      readJahisSupplementalDetails({
        details: [{ label: '残薬内容', value: '残薬あり' }, { label: '空値', value: '' }, [], null],
      }),
    ).toEqual([{ label: '残薬内容', value: '残薬あり' }]);

    expect(readJahisSupplementalDetails([])).toEqual([]);
  });

  it('normalizes stored supplemental records for display when parsed records are absent', () => {
    expect(
      normalizeJahisSupplementalRecords(undefined, [
        {
          id: 'supplemental_1',
          record_type: '421',
          record_label: '残薬確認',
          line_number: 12,
          summary: null,
          payload: {
            details: [{ label: '残薬内容', value: '残薬あり' }],
          },
          raw_line: '421,残薬あり',
        },
      ]),
    ).toEqual([
      {
        id: 'supplemental_1',
        recordType: '421',
        recordLabel: '残薬確認',
        lineNumber: 12,
        summary: '421,残薬あり',
        details: [{ label: '残薬内容', value: '残薬あり' }],
        rawLine: '421,残薬あり',
      },
    ]);
  });
});
