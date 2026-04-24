// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

describe('DialogDescription', () => {
  it('renders description through the shared help popover', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>タイトル</DialogTitle>
          <DialogDescription helpTitle="ダイアログ説明">説明本文です。</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText('説明本文です。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ダイアログ説明を表示' }));
    expect(screen.getByText('説明本文です。')).toBeTruthy();
  });
});
