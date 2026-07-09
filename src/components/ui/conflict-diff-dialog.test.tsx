// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ConflictDiffDialog, type ConflictDiffField } from '@/components/ui/conflict-diff-dialog';

setupDomTestEnv();

// 非空 tuple 型(readonly [ConflictDiffField, ...])に合わせて明示 tuple で宣言する。
const BASE_FIELDS = [
  { label: '訪問メモ', keepValue: 'サーバー側メモ', discardValue: 'ローカル側メモ' },
  { label: '結果', keepValue: '実施', discardValue: '—（未入力）' },
] as const satisfies readonly [ConflictDiffField, ...ConflictDiffField[]];

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  title: '最新の内容を残しますか',
  irreversibleNote: '自分の入力は破棄され、元に戻せません。',
  keepLabel: '最新の内容',
  discardLabel: 'あなたの入力',
  fields: BASE_FIELDS,
  confirmLabel: '最新の内容を残す',
  onConfirm: vi.fn(),
};

describe('ConflictDiffDialog', () => {
  // SSOT 5.7: 二択の不可逆操作は「差分提示つき共通確認部品」。確定直前に
  // 何が残り何が失われるかを構造化再掲することを DOM で固定する。
  it('restates the keep/discard diff right before the irreversible confirm', () => {
    render(<ConflictDiffDialog {...BASE_PROPS} />);

    expect(screen.getByText('最新の内容を残しますか')).toBeTruthy();
    expect(screen.getByText('自分の入力は破棄され、元に戻せません。')).toBeTruthy();
    expect(screen.getAllByText('最新の内容（残す）')).toHaveLength(2);
    expect(screen.getAllByText('あなたの入力（破棄）')).toHaveLength(2);

    // モバイルでは縦積みになる項目ブロック単位で、keep/discard の取り違えを遮断する。
    const memoDiff = screen.getByRole('region', { name: '訪問メモの差分' });
    const memoDefinitions = within(memoDiff).getAllByRole('definition');
    expect(memoDefinitions[0]?.textContent).toBe('サーバー側メモ');
    expect(memoDefinitions[1]?.textContent).toBe('ローカル側メモ');
    const outcomeDiff = screen.getByRole('region', { name: '結果の差分' });
    const outcomeDefinitions = within(outcomeDiff).getAllByRole('definition');
    expect(outcomeDefinitions[0]?.textContent).toBe('実施');
    expect(outcomeDefinitions[1]?.textContent).toBe('—（未入力）');
  });

  it('uses a verb-phrase confirm label and keeps Cancel available (SSOT 5.2/5.3)', () => {
    render(<ConflictDiffDialog {...BASE_PROPS} />);

    expect(screen.getByRole('button', { name: '最新の内容を残す' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
  });

  it('keeps the dialog open and disables both 44px actions while resolution is pending', () => {
    const onOpenChange = vi.fn();
    render(<ConflictDiffDialog {...BASE_PROPS} onOpenChange={onOpenChange} pending />);

    const confirm = screen.getByRole('button', { name: '処理中...' });
    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(cancel.hasAttribute('disabled')).toBe(true);
    expect(confirm.className).toContain('min-h-11');
    expect(confirm.className).toContain('sm:min-h-11');
    expect(cancel.className).toContain('min-h-11');
    expect(screen.getByRole('status').textContent).toContain('保存しています');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps a safe failure message visible beside the diff', () => {
    render(
      <ConflictDiffDialog
        {...BASE_PROPS}
        errorMessage="競合を解決できませんでした。もう一度選択してください。"
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('競合を解決できませんでした');
  });

  it('does not dismiss before the parent reports an irreversible save success', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConflictDiffDialog {...BASE_PROPS} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を残す' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
