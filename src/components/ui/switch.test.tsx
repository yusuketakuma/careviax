// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { Switch } from './switch';

setupDomTestEnv();

describe('Switch', () => {
  it('keeps a 44px touch hit area while preserving the compact visual switch', () => {
    render(<Switch aria-label="訪問前確認を有効にする" />);

    const switchControl = screen.getByRole('switch', { name: '訪問前確認を有効にする' });
    expect(switchControl.className).toContain('h-5');
    expect(switchControl.className).toContain('w-9');
    expect(switchControl.className).toContain('after:-inset-y-3');
  });

  it('emits checked changes from the current state', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="訪問前確認を有効にする"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: '訪問前確認を有効にする' }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
