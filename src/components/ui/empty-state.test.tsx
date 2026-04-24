// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { EmptyState } from './empty-state';

setupDomTestEnv();

describe('EmptyState', () => {
  it('shows its description from the shared help popover', () => {
    render(<EmptyState title="データなし" description="条件を変更してください。" />);

    expect(screen.queryByText('条件を変更してください。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'データなしの説明' }));
    expect(screen.getByText('条件を変更してください。')).toBeTruthy();
  });
});
