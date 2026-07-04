// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const masterHubContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./master-hub-content', () => ({
  MasterHubContent: () => {
    if (masterHubContentMockState.suspend) {
      throw masterHubContentMockState.promise;
    }
    return <section data-testid="master-hub-content" />;
  },
}));

import AdminDashboardPage from './page';

setupDomTestEnv();

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    masterHubContentMockState.suspend = false;
  });

  it('renders the master hub content shell', () => {
    render(<AdminDashboardPage />);

    expect(screen.getByTestId('master-hub-content')).toBeTruthy();
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    masterHubContentMockState.suspend = true;

    render(<AdminDashboardPage />);

    expect(screen.getByRole('status', { name: 'マスターを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('master-hub-content')).toBeNull();
  });
});
