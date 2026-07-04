// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const notificationsContentMock = vi.hoisted(() => vi.fn());
const notificationsContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./notifications-content', () => ({
  NotificationsContent: (props: { initialCategory?: string }) => {
    notificationsContentMock(props);
    if (notificationsContentMockState.suspend) {
      throw notificationsContentMockState.promise;
    }
    return <section data-testid="notifications-content" />;
  },
}));

import NotificationsPage from './page';

setupDomTestEnv();

describe('NotificationsPage', () => {
  beforeEach(() => {
    notificationsContentMock.mockClear();
    notificationsContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await NotificationsPage({
      searchParams: Promise.resolve({ category: 'urgent' }),
    });
    return render(page);
  }

  it('renders notifications content with search params', async () => {
    await renderPage();

    expect(screen.getByTestId('notifications-content')).toBeTruthy();
    expect(notificationsContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialCategory: 'urgent' }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    notificationsContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: 'お知らせを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('notifications-content')).toBeNull();
  });
});
