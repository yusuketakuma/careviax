// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MasterEditorView } from './master-editor-view';

setupDomTestEnv();

describe('MasterEditorView', () => {
  it('marks fabricated master rows as read-only samples instead of active real data', () => {
    render(
      <MasterEditorView
        activeCategory="スタッフ"
        listTitle="スタッフ一覧"
        itemPrefix="スタッフ"
        testId="staff-master-editor"
      />,
    );

    const editor = screen.getByTestId('staff-master-editor');
    const sampleRows = within(editor).getAllByRole('button', { name: /スタッフ \d+サンプル/ });

    expect(sampleRows).toHaveLength(8);
    expect(sampleRows[0]).toHaveProperty('disabled', true);
    expect(within(editor).queryByText('有効')).toBeNull();
    expect(screen.getByText('実データ接続待ちのマスターです。', { exact: false })).toBeTruthy();
    expect(within(editor).getByLabelText('スタッフ一覧のサンプル一覧').className).toContain(
      'max-h-[240px]',
    );

    for (const badge of within(editor).getAllByText('サンプル')) {
      expect(badge.closest('[data-role]')?.getAttribute('data-role')).toBe('readonly');
    }
  });

  it('keeps sample detail fields and save action visibly non-editable', () => {
    render(
      <MasterEditorView
        activeCategory="施設"
        listTitle="施設一覧"
        itemPrefix="施設"
        testId="facility-master-editor"
      />,
    );

    for (const label of ['名称', 'コード', '分類', '注意ポイント', '表示するタグ', 'メモ']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveProperty('disabled', true);
      expect(input.getAttribute('aria-readonly')).toBe('true');
      expect(input.className).toContain('!h-11');
      expect(input.className).toContain('!min-h-11');
    }

    const saveButton = screen.getByRole('button', { name: '保存する' });
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.className).toContain('!h-11');
    expect(saveButton.className).toContain('!min-h-11');
    expect(screen.getByText('サンプル表示のため保存できません。')).toBeTruthy();
  });

  it('prioritizes the sample list and detail editor before category chrome on mobile', () => {
    render(
      <MasterEditorView
        activeCategory="医療機関"
        listTitle="医療機関一覧"
        itemPrefix="医療機関"
        testId="external-professionals-master-editor"
      />,
    );

    const editor = screen.getByTestId('external-professionals-master-editor');
    const listCard = within(editor)
      .getByRole('heading', { name: '医療機関一覧' })
      .closest('.order-1');
    const detailCard = within(editor)
      .getByRole('heading', { name: '詳細を編集' })
      .closest('.order-2');
    const categoryCard = within(editor)
      .getByRole('heading', { name: 'カテゴリ' })
      .closest('.order-3');

    expect(listCard).toBeTruthy();
    expect(detailCard).toBeTruthy();
    expect(categoryCard).toBeTruthy();
  });
});
