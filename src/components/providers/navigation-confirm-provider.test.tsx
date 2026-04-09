// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  NavigationConfirmProvider,
  requestNavigationConfirmation,
} from './navigation-confirm-provider';

setupDomTestEnv();

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <p>{description}</p>
        <button onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={() => onOpenChange(false)}>{cancelLabel}</button>
      </div>
    ) : null,
}));

describe('navigation-confirm-provider', () => {
  it('falls back to window.confirm when provider is not mounted', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await expect(requestNavigationConfirmation('leave?')).resolves.toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith('leave?');
  });

  it('resolves confirmations through the provider dialog', async () => {
    render(<NavigationConfirmProvider />);

    let confirmation!: Promise<boolean>;
    await act(async () => {
      confirmation = requestNavigationConfirmation('未保存の変更があります');
    });

    expect(await screen.findByText('未保存の変更があります')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移動する' }));

    await expect(confirmation).resolves.toBe(true);
  });
});
