// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const jobsDashboardContentMockState = vi.hoisted(() => ({
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
  getAdminJobsShortcutLinks: () => [{ href: '/admin/realtime', label: 'リアルタイム監視' }],
}));

vi.mock('./jobs-dashboard-content', () => ({
  JobsDashboardContent: () => {
    if (jobsDashboardContentMockState.suspend) {
      throw jobsDashboardContentMockState.promise;
    }
    return <section data-testid="jobs-dashboard-content" />;
  },
}));

import JobsDashboardPage from './page';

setupDomTestEnv();

describe('JobsDashboardPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    jobsDashboardContentMockState.suspend = false;
  });

  it('keeps job operations ahead of the generic admin intro', () => {
    render(<JobsDashboardPage />);

    expect(screen.getByRole('heading', { name: 'ジョブ監視' })).toBeTruthy();
    expect(screen.getByTestId('jobs-dashboard-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    jobsDashboardContentMockState.suspend = true;

    render(<JobsDashboardPage />);

    expect(screen.getByRole('heading', { name: 'ジョブ監視' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'ジョブ監視を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('jobs-dashboard-content')).toBeNull();
  });
});
