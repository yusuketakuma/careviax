// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const metricsContentMockState = vi.hoisted(() => ({
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
  getAdminMetricsShortcutLinks: () => [{ href: '/admin/analytics', label: 'KPI分析' }],
}));

vi.mock('./metrics-dashboard-content', () => ({
  MetricsDashboardContent: () => {
    if (metricsContentMockState.suspend) {
      throw metricsContentMockState.promise;
    }
    return <section data-testid="metrics-dashboard-content" />;
  },
}));

import MetricsDashboardPage from './page';

setupDomTestEnv();

describe('MetricsDashboardPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    metricsContentMockState.suspend = false;
  });

  it('renders the metrics workspace shell', () => {
    render(<MetricsDashboardPage />);

    expect(screen.getByRole('heading', { name: '経営指標ダッシュボード' })).toBeTruthy();
    expect(screen.getByTestId('metrics-dashboard-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [{ href: '/admin/analytics', label: 'KPI分析' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    metricsContentMockState.suspend = true;

    render(<MetricsDashboardPage />);

    expect(screen.getByRole('heading', { name: '経営指標ダッシュボード' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: '経営指標ダッシュボードを読み込み中...' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('metrics-dashboard-content')).toBeNull();
  });
});
