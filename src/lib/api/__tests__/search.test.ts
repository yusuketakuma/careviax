import { describe, expect, it } from 'vitest';
import { buildSearchFilter, buildSort } from '../search';

describe('buildSearchFilter', () => {
  it('builds case-insensitive partial-match filters without wildcard literals', () => {
    expect(buildSearchFilter('アムロ', ['drug_name', 'drug_name_kana'])).toEqual({
      OR: [
        { drug_name: { contains: 'アムロ', mode: 'insensitive' } },
        { drug_name_kana: { contains: 'アムロ', mode: 'insensitive' } },
      ],
    });
  });

  it('returns an empty filter when the query is blank', () => {
    expect(buildSearchFilter('   ', ['name'])).toEqual({});
  });
});

describe('buildSort', () => {
  it('returns the fallback when the requested sort key is not allowed', () => {
    expect(buildSort('updated_at', 'desc', ['name', 'created_at'], 'name')).toEqual({
      name: 'desc',
    });
  });

  it('returns undefined when neither sort nor fallback is available', () => {
    expect(buildSort(undefined, 'asc', ['name'])).toBeUndefined();
  });
});
