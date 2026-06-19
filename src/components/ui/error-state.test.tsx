// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ErrorState } from './error-state';

setupDomTestEnv();

describe('ErrorState', () => {
  it('shows its description from the shared help popover', () => {
    render(<ErrorState title="取得失敗" description="再試行してください。" />);

    expect(screen.getByRole('heading', { level: 2, name: '取得失敗' })).toBeTruthy();
    expect(screen.queryByText('再試行してください。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取得失敗の説明' }));
    expect(screen.getByText('再試行してください。')).toBeTruthy();
  });

  it('uses h1 for page-sized errors and allows inline heading overrides', () => {
    const { rerender } = render(<ErrorState size="page" title="ページエラー" />);

    expect(screen.getByRole('heading', { level: 1, name: 'ページエラー' })).toBeTruthy();

    rerender(<ErrorState title="パネルエラー" headingLevel={3} />);

    expect(screen.getByRole('heading', { level: 3, name: 'パネルエラー' })).toBeTruthy();
  });
});
