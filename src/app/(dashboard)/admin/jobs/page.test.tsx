// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());

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
  JobsDashboardContent: () => <section data-testid="jobs-dashboard-content" />,
}));

import JobsDashboardPage from './page';

setupDomTestEnv();

describe('JobsDashboardPage', () => {
  it('keeps job operations ahead of the generic admin intro', () => {
    render(<JobsDashboardPage />);

    expect(screen.getByRole('heading', { name: 'ジョブ監視' })).toBeTruthy();
    expect(screen.getByTestId('jobs-dashboard-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });
});
