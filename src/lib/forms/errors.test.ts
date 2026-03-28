import { describe, expect, it } from 'vitest';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';

describe('collectFormErrorSummaryItems', () => {
  it('maps top-level field errors to labels', () => {
    const items = collectFormErrorSummaryItems(
      {
        name: { message: '氏名は必須です' },
        birth_date: { message: '日付形式が不正です' },
      },
      {
        name: '氏名',
        birth_date: '生年月日',
      },
    );

    expect(items).toEqual([
      { path: 'name', label: '氏名', message: '氏名は必須です' },
      { path: 'birth_date', label: '生年月日', message: '日付形式が不正です' },
    ]);
  });

  it('supports array wildcard labels with row numbering', () => {
    const items = collectFormErrorSummaryItems(
      {
        lines: [
          {
            actual_drug_name: { message: '実薬剤名は必須です' },
            actual_quantity: { message: '正の数を入力してください' },
          },
        ],
      },
      {
        'lines.*.actual_drug_name': '実薬剤名',
        'lines.*.actual_quantity': '実数量',
      },
    );

    expect(items).toEqual([
      {
        path: 'lines.0.actual_drug_name',
        label: '1行目: 実薬剤名',
        message: '実薬剤名は必須です',
      },
      {
        path: 'lines.0.actual_quantity',
        label: '1行目: 実数量',
        message: '正の数を入力してください',
      },
    ]);
  });
});
