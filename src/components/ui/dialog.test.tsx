// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

describe('DialogDescription', () => {
  it('exposes the dialog description and keeps the shared help popover', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>タイトル</DialogTitle>
          <DialogDescription helpTitle="ダイアログ説明">説明本文です。</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(
      screen.getByRole('dialog', { name: 'タイトル', description: '説明本文です。' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ダイアログ説明を表示' }));
    expect(screen.getByRole('tooltip').textContent).toContain('説明本文です。');
  });

  it('supports wider clinical workflow dialogs without overriding existing callers', () => {
    render(
      <Dialog open>
        <DialogContent size="2xl">
          <DialogTitle>送付前確認</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: '送付前確認' }).className).toContain('sm:max-w-2xl');
  });
});
