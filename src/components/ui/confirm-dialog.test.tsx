// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ConfirmDialog } from './confirm-dialog';

setupDomTestEnv();

describe('ConfirmDialog', () => {
  it('uses unique ids for required confirmation inputs', () => {
    const noop = vi.fn();
    render(
      <>
        <ConfirmDialog
          open
          onOpenChange={noop}
          title="1件目を削除"
          description="この操作は取り消せません。"
          requiredConfirmText="削除1"
          onConfirm={noop}
        />
        <ConfirmDialog
          open
          onOpenChange={noop}
          title="2件目を削除"
          description="この操作は取り消せません。"
          requiredConfirmText="削除2"
          onConfirm={noop}
        />
      </>,
    );

    const firstInput = screen.getByLabelText(/削除1/);
    const secondInput = screen.getByLabelText(/削除2/);

    expect(firstInput.id).toBeTruthy();
    expect(secondInput.id).toBeTruthy();
    expect(firstInput.id).not.toBe(secondInput.id);
  });

  it('renders custom content and honors external confirm disabled state', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="取消確認"
        description="理由を入力してから確定してください。"
        confirmDisabled
        confirmLabel="取消する"
        onConfirm={onConfirm}
      >
        <p>取消理由は監査ログに記録されます。</p>
      </ConfirmDialog>,
    );

    expect(screen.getByText('取消理由は監査ログに記録されます。')).toBeTruthy();
    const confirmButton = screen.getByRole('button', { name: '取消する' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
