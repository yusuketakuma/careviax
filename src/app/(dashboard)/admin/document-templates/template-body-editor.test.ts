import { describe, expect, it } from 'vitest';
import {
  insertMergeField,
  MERGE_FIELDS,
  readTemplateBodyText,
  summarizeMergeFieldUsage,
} from './template-body-editor';

describe('insertMergeField', () => {
  it('inserts the token at the cursor and moves the cursor after it', () => {
    expect(insertMergeField('本日は を確認。', 4, '服薬状況')).toEqual({
      nextText: '本日は {服薬状況}を確認。',
      nextCursor: 10,
    });
  });

  it('appends to the end when the cursor is missing or out of range', () => {
    expect(insertMergeField('文面', null, '残薬')).toEqual({
      nextText: '文面{残薬}',
      nextCursor: 6,
    });
    expect(insertMergeField('文面', 99, '残薬').nextText).toBe('文面{残薬}');
  });
});

describe('readTemplateBodyText', () => {
  it('reads body_text only when it is a string', () => {
    expect(readTemplateBodyText({ body_text: '本文', sections: [] })).toBe('本文');
    expect(readTemplateBodyText({ sections: ['summary'] })).toBe('');
    expect(readTemplateBodyText(null)).toBe('');
  });
});

describe('summarizeMergeFieldUsage', () => {
  it('counts used merge fields and lists missing fields', () => {
    expect(summarizeMergeFieldUsage('本文 {服薬状況} と {残薬}')).toEqual({
      usedCount: 2,
      totalCount: MERGE_FIELDS.length,
      missingFields: ['副作用', '薬剤師評価', 'お願いしたいこと', '次回確認'],
    });
  });

  it('reports no missing fields when every merge token is present', () => {
    const text = MERGE_FIELDS.map((field) => `{${field}}`).join(' ');
    expect(summarizeMergeFieldUsage(text).missingFields).toEqual([]);
  });
});

describe('MERGE_FIELDS', () => {
  it('keeps the six p1_10 merge chips', () => {
    expect(MERGE_FIELDS).toHaveLength(6);
    expect(MERGE_FIELDS).toContain('服薬状況');
    expect(MERGE_FIELDS).toContain('次回確認');
  });
});
