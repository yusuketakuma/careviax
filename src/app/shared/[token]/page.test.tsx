// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const sharedViewerContentMock = vi.hoisted(() => vi.fn());
const sharedViewerContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('@/components/providers/query-provider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="query-provider">{children}</div>
  ),
}));

vi.mock('./shared-viewer-content', () => ({
  SharedViewerContent: (props: { token: string }) => {
    sharedViewerContentMock(props);
    if (sharedViewerContentMockState.suspend) {
      throw sharedViewerContentMockState.promise;
    }
    return <section data-testid="shared-viewer-content" />;
  },
}));

import SharedViewerPage from './page';

setupDomTestEnv();

describe('SharedViewerPage', () => {
  beforeEach(() => {
    sharedViewerContentMock.mockClear();
    sharedViewerContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await SharedViewerPage({
      params: Promise.resolve({ token: 'share_token_1' }),
      searchParams: Promise.resolve({}),
    });
    return render(page);
  }

  it('renders the shared viewer with route token', async () => {
    await renderPage();

    expect(screen.getByTestId('query-provider')).toBeTruthy();
    expect(screen.getByTestId('shared-viewer-content')).toBeTruthy();
    expect(sharedViewerContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'share_token_1' }),
    );
  });

  it('uses a screen-specific loading status for the shared viewer fallback', async () => {
    sharedViewerContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '共有ページを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('shared-viewer-content')).toBeNull();
  });
});
