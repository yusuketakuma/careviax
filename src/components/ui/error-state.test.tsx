// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('composes the cause + next-action copy contract (SSOT 6.3)', () => {
    render(
      <ErrorState
        title="取得失敗"
        cause="保険情報を取得できませんでした。"
        nextAction="通信状態を確認して再試行してください。"
      />,
    );

    // 原因と次の行動が1本の本文として結合される。
    expect(
      screen.getByText('保険情報を取得できませんでした。 通信状態を確認して再試行してください。'),
    ).toBeTruthy();
  });

  it('renders a retry action from the onRetry shorthand and defers to explicit action', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState title="取得失敗" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // action 明示時は onRetry を無視する(二重導線を作らない)。
    rerender(
      <ErrorState title="取得失敗" onRetry={onRetry} action={{ label: '一覧へ戻る', href: '/' }} />,
    );
    expect(screen.queryByRole('button', { name: '再試行' })).toBeNull();
    expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeTruthy();
  });

  it('keeps retry copy configurable while using the onRetry shorthand', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="取得失敗" onRetry={onRetry} retryLabel="再読み込み" />);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
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
