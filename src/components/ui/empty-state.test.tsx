// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { EmptyState } from './empty-state';

setupDomTestEnv();

describe('EmptyState', () => {
  it('shows its description without hiding the next action guidance', () => {
    render(<EmptyState title="データなし" description="条件を変更してください。" />);

    expect(screen.getByText('条件を変更してください。')).toBeTruthy();
  });

  it('uses the shared button styling for link actions', () => {
    render(<EmptyState title="データなし" action={{ label: '患者一覧へ', href: '/patients' }} />);

    const link = screen.getByRole('link', { name: '患者一覧へ' });
    expect(link.getAttribute('href')).toBe('/patients');
    expect(link.className).toContain('min-h-[44px]');
  });
});
