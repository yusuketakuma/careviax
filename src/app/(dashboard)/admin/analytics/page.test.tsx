// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const analyticsContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: (props: {
    title: string;
    description: string;
    shortcuts: Array<{ href: string; label: string }>;
    supportingContent?: unknown;
  }) => {
    adminPageHeaderMock(props);
    return <h1>{props.title}</h1>;
  },
}));

vi.mock('@/components/features/admin/admin-page-shortcut-presets', () => ({
  getAdminAnalyticsShortcutLinks: () => [{ href: '/admin/metrics', label: '経営指標' }],
}));

vi.mock('./analytics-content', () => ({
  AnalyticsContent: () => {
    if (analyticsContentMockState.suspend) {
      throw analyticsContentMockState.promise;
    }
    return <section data-testid="analytics-content" />;
  },
}));

import AnalyticsPage from './page';

setupDomTestEnv();

describe('AnalyticsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    analyticsContentMockState.suspend = false;
  });

  it('renders the analytics workspace shell', () => {
    render(<AnalyticsPage />);

    expect(screen.getByRole('heading', { name: 'KPI分析ダッシュボード' })).toBeTruthy();
    expect(screen.getByTestId('analytics-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/metrics', label: '経営指標' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    analyticsContentMockState.suspend = true;

    render(<AnalyticsPage />);

    expect(screen.getByRole('heading', { name: 'KPI分析ダッシュボード' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'KPI分析ダッシュボードを読み込み中...' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('analytics-content')).toBeNull();
  });
});
