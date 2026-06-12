// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

setupDomTestEnv();

import { ReasonDialog, type ReasonOption } from './reason-dialog';

const OPTIONS: ReasonOption[] = [
  { code: 'quantity_mismatch', label: '数量が違う' },
  { code: 'discontinued_drug_left', label: '中止薬が残っている' },
  { code: 'missing_photo', label: '写真が足りない' },
  { code: 'patient_reason', label: '患者都合' },
  { code: 'input_error', label: '入力間違い' },
  { code: 'other', label: 'その他' },
];

describe('ReasonDialog', () => {
  it('renders the p0_36/37 structure (title, helper copy, chips, memo, footer)', () => {
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('差し戻し理由を入力')).toBeTruthy();
    expect(screen.getByText('理由を選ぶと、あとで見返しやすくなります。')).toBeTruthy();
    expect(screen.getAllByTestId('reason-option')).toHaveLength(6);
    expect(screen.getByPlaceholderText('メモ(必要な時だけ)')).toBeTruthy();
    expect(screen.getByRole('button', { name: '戻る' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存する' })).toBeTruthy();
  });

  it('disables submit until a reason chip is selected', () => {
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={vi.fn()}
      />,
    );

    const submit = screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const chip = screen.getByRole('button', { name: '数量が違う' });
    fireEvent.click(chip);

    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(submit.disabled).toBe(false);
  });

  it('submits the selected reason code, label, and trimmed note', () => {
    const onSubmit = vi.fn();
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="取消・再開の理由を入力"
        options={OPTIONS}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '患者都合' }));
    fireEvent.change(screen.getByPlaceholderText('メモ(必要な時だけ)'), {
      target: { value: '  家族から延期の連絡 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(onSubmit).toHaveBeenCalledWith({
      code: 'patient_reason',
      label: '患者都合',
      note: '家族から延期の連絡',
    });
  });

  it('closes via the back button without submitting', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <ReasonDialog
        open
        onOpenChange={onOpenChange}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '戻る' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('resets the selection and note when reopened', () => {
    const { rerender } = render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.change(screen.getByPlaceholderText('メモ(必要な時だけ)'), {
      target: { value: '一時メモ' },
    });

    rerender(
      <ReasonDialog
        open={false}
        onOpenChange={vi.fn()}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={vi.fn()}
      />,
    );
    rerender(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={vi.fn()}
      />,
    );

    const submit = screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(
      (screen.getByPlaceholderText('メモ(必要な時だけ)') as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('shows the optional warning note when provided', () => {
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="差し戻し理由を入力"
        options={OPTIONS}
        onSubmit={vi.fn()}
        warning="差戻し後は再計画が必要です。"
      />,
    );

    expect(screen.getByText('差戻し後は再計画が必要です。')).toBeTruthy();
  });
});
