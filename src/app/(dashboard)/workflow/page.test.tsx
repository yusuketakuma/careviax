// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const workflowDashboardContentMock = vi.hoisted(() => vi.fn());
const workflowDashboardContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./workflow-dashboard-content', () => ({
  WorkflowDashboardContent: (props: {
    initialFocus?: string;
    initialContext?: Record<string, unknown> | null;
  }) => {
    workflowDashboardContentMock(props);
    if (workflowDashboardContentMockState.suspend) {
      throw workflowDashboardContentMockState.promise;
    }
    return <section data-testid="workflow-dashboard-content" />;
  },
}));

import WorkflowDashboardPage from './page';

setupDomTestEnv();

describe('WorkflowDashboardPage', () => {
  beforeEach(() => {
    workflowDashboardContentMock.mockClear();
    workflowDashboardContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await WorkflowDashboardPage({
      searchParams: Promise.resolve({
        focus: 'control_center',
        context: 'dashboard_home',
      }),
    });
    return render(page);
  }

  it('renders the workflow dashboard shell with search params', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: 'ワークフローダッシュボード' })).toBeTruthy();
    expect(screen.getByTestId('workflow-dashboard-content')).toBeTruthy();
    expect(workflowDashboardContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFocus: 'control_center',
        initialContext: 'dashboard_home',
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    workflowDashboardContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('heading', { name: 'ワークフローダッシュボード' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'ワークフローダッシュボードを読み込み中...' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('workflow-dashboard-content')).toBeNull();
  });
});
