// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const conferencesContentMock = vi.hoisted(() => vi.fn());
const conferencesContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./conferences-content', () => ({
  ConferencesContent: (props: {
    initialFocus?: string;
    initialContext?: string | null;
    initialViewMode?: string;
    initialNoteType?: string;
  }) => {
    conferencesContentMock(props);
    if (conferencesContentMockState.suspend) {
      throw conferencesContentMockState.promise;
    }
    return <section data-testid="conferences-content" />;
  },
}));

import ConferencesPage from './page';

setupDomTestEnv();

describe('ConferencesPage', () => {
  beforeEach(() => {
    conferencesContentMock.mockClear();
    conferencesContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await ConferencesPage({
      searchParams: Promise.resolve({
        focus: 'notes',
        context: 'dashboard_home',
        view: 'calendar',
        note_type: 'care_team',
      }),
    });
    return render(page);
  }

  it('renders the conferences shell with search params', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: 'カンファレンスノート' })).toBeTruthy();
    expect(screen.getByTestId('conferences-content')).toBeTruthy();
    expect(conferencesContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFocus: 'notes',
        initialContext: 'dashboard_home',
        initialViewMode: 'calendar',
        initialNoteType: 'care_team',
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    conferencesContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('heading', { name: 'カンファレンスノート' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'カンファレンスノートを読み込み中...' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('conferences-content')).toBeNull();
  });
});
