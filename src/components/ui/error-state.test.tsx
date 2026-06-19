// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ErrorState } from './error-state';

setupDomTestEnv();

describe('ErrorState', () => {
  it('shows its description and announces dynamic errors politely by default', () => {
    render(<ErrorState title="取得失敗" description="再試行してください。" />);

    expect(screen.getByRole('heading', { level: 2, name: '取得失敗' })).toBeTruthy();
    expect(screen.getByText('再試行してください。')).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('can disable live announcements for static page errors', () => {
    render(<ErrorState title="固定エラー" live="off" />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('uses h1 for page-sized errors and allows inline heading overrides', () => {
    const { rerender } = render(<ErrorState size="page" title="ページエラー" />);

    expect(screen.getByRole('heading', { level: 1, name: 'ページエラー' })).toBeTruthy();

    rerender(<ErrorState title="パネルエラー" headingLevel={3} />);

    expect(screen.getByRole('heading', { level: 3, name: 'パネルエラー' })).toBeTruthy();
  });

  it('uses the shared button styling for link actions', () => {
    render(
      <ErrorState
        title="取得失敗"
        action={{ label: '再読み込み', href: '/dashboard', variant: 'outline', size: 'sm' }}
      />,
    );

    const link = screen.getByRole('link', { name: '再読み込み' });
    expect(link.getAttribute('href')).toBe('/dashboard');
    expect(link.className).toContain('min-h-[44px]');
    expect(link.className).toContain('border-border');
  });
});
