// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const searchContentMock = vi.hoisted(() => vi.fn());
const searchContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./search-content', () => ({
  SearchContent: (props: { initialQuery: string; initialCategory: string }) => {
    searchContentMock(props);
    if (searchContentMockState.suspend) {
      throw searchContentMockState.promise;
    }
    return <section data-testid="search-content" />;
  },
}));

import SearchPage from './page';

setupDomTestEnv();

describe('SearchPage', () => {
  beforeEach(() => {
    searchContentMock.mockClear();
    searchContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await SearchPage({
      searchParams: Promise.resolve({ q: '田中', category: 'report' }),
    });
    return render(page);
  }

  it('renders search content with search params', async () => {
    await renderPage();

    expect(screen.getByTestId('search-content')).toBeTruthy();
    expect(searchContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialQuery: '田中', initialCategory: 'report' }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    searchContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '全体検索を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('search-content')).toBeNull();
  });
});
