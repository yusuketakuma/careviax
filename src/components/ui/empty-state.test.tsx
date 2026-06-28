// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { EmptyState } from './empty-state';

setupDomTestEnv();

describe('EmptyState', () => {
  it('shows its description without hiding the next action guidance', () => {
    render(
      <EmptyState
        title="データなし"
        description="条件を変更してください。"
        guidance="再読み込み後も続く場合は権限を確認してください。"
        headingLevel={2}
      />,
    );

    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('heading', { level: 2, name: 'データなし' })).toBeTruthy();
    expect(screen.getByText('条件を変更してください。')).toBeTruthy();
    expect(screen.getByText('再読み込み後も続く場合は権限を確認してください。')).toBeTruthy();
  });

  it('uses the shared button styling for link actions', () => {
    render(<EmptyState title="データなし" action={{ label: '患者一覧へ', href: '/patients' }} />);

    const link = screen.getByRole('link', { name: '患者一覧へ' });
    expect(link.getAttribute('href')).toBe('/patients');
    expect(link.className).toContain('min-h-[44px]');
  });
});
