import { describe, expect, it } from 'vitest';
import {
  flattenPdfJson,
  readPdfJsonArrayField,
  readPdfJsonObject,
  readPdfJsonObjectField,
  readPdfJsonObjects,
} from './pdf-document-json';

describe('pdf document JSON helpers', () => {
  it('reads only object roots for persisted PDF content', () => {
    expect(readPdfJsonObject({ summary: '継続' })).toEqual({ summary: '継続' });
    expect(readPdfJsonObject(null)).toEqual({});
    expect(readPdfJsonObject(['unexpected'])).toEqual({});
    expect(readPdfJsonObject('unexpected')).toEqual({});
  });

  it('reads nested object fields and rejects malformed roots', () => {
    expect(
      readPdfJsonObjectField(
        { billing_context: { rule: 'home_visit', points: 650 } },
        'billing_context',
      ),
    ).toEqual({ rule: 'home_visit', points: 650 });
    expect(
      readPdfJsonObjectField({ billing_context: ['unexpected'] }, 'billing_context'),
    ).toBeNull();
    expect(readPdfJsonObjectField(['unexpected'], 'billing_context')).toBeNull();
  });

  it('reads array fields and object rows without array/scalar roots', () => {
    expect(readPdfJsonArrayField({ sections: [{ key: 's1' }, ['bad']] }, 'sections')).toEqual([
      { key: 's1' },
      ['bad'],
    ]);
    expect(readPdfJsonArrayField({ sections: { key: 's1' } }, 'sections')).toEqual([]);
    expect(readPdfJsonObjects([{ name: '参加者' }, ['bad'], null, { role: '医師' }])).toEqual([
      { name: '参加者' },
      { role: '医師' },
    ]);
  });

  it('flattens nested report content without trusting object casts', () => {
    expect(
      flattenPdfJson({
        patient: { name: '山田太郎' },
        risks: ['転倒', null, true],
        empty: {},
      }),
    ).toEqual([
      { label: 'patient.name', value: '山田太郎' },
      { label: 'risks', value: '転倒 / — / true' },
      { label: 'empty', value: '—' },
    ]);
  });
});
