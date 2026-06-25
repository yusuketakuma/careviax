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
    }

    const saveButton = screen.getByRole('button', { name: '保存する' });
    expect(saveButton).toHaveProperty('disabled', true);
    expect(screen.getByText('サンプル表示のため保存できません。')).toBeTruthy();
  });
});
