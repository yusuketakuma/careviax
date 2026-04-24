// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

describe('SheetDescription', () => {
  it('renders description through the shared help popover', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>タイトル</SheetTitle>
          <SheetDescription helpTitle="シート説明">シート本文です。</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByText('シート本文です。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'シート説明を表示' }));
    expect(screen.getByText('シート本文です。')).toBeTruthy();
  });
});
