// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const externalViewerContentMock = vi.hoisted(() => vi.fn());
const externalViewerContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./external-viewer-content', () => ({
  ExternalViewerContent: (props: { initialFocus?: string; initialContext?: string | null }) => {
    externalViewerContentMock(props);
    if (externalViewerContentMockState.suspend) {
      throw externalViewerContentMockState.promise;
    }
    return <section data-testid="external-viewer-content" />;
  },
}));

import ExternalViewerPage from './page';

setupDomTestEnv();

describe('ExternalViewerPage', () => {
  beforeEach(() => {
    externalViewerContentMock.mockClear();
    externalViewerContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await ExternalViewerPage({
      searchParams: Promise.resolve({ focus: 'shares', context: 'dashboard_home' }),
    });
    return render(page);
  }

  it('renders the external viewer shell with search params', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: '外部連携ビュー' })).toBeTruthy();
    expect(screen.getByTestId('external-viewer-content')).toBeTruthy();
    expect(externalViewerContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialFocus: 'shares', initialContext: 'dashboard_home' }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    externalViewerContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('heading', { name: '外部連携ビュー' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '外部連携ビューを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('external-viewer-content')).toBeNull();
  });
});
