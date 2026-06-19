// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';

describe('ShortcutHelpDialog', () => {
  it('renders PH-OS keyboard shortcut help from copy rows', () => {
    render(<ShortcutHelpDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'ショートカット' })).toBeTruthy();
    expect(screen.getByText('Board検索へ移動')).toBeTruthy();
    expect(screen.getByText('Workspaceタブを切替')).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('delegates close through the dialog primitive', () => {
    const onOpenChange = vi.fn();
    render(<ShortcutHelpDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });
});
