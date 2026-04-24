// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { CardDescription } from './card';

setupDomTestEnv();

describe('CardDescription', () => {
  it('renders description content through the shared help popover', () => {
    render(<CardDescription helpTitle="カード説明">説明本文です。</CardDescription>);

    expect(screen.queryByText('説明本文です。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'カード説明を表示' }));

    expect(screen.getByText('説明本文です。')).toBeTruthy();
  });
});
