// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const settingsContentMockState = vi.hoisted(() => ({
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
  getAdminSettingsShortcutLinks: () => [{ href: '/admin/users', label: 'ユーザー管理' }],
}));

vi.mock('./settings-content', () => ({
  SettingsContent: () => {
    if (settingsContentMockState.suspend) {
      throw settingsContentMockState.promise;
    }
    return <section data-testid="settings-content" />;
  },
}));

import SettingsPage from './page';

setupDomTestEnv();

describe('SettingsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    settingsContentMockState.suspend = false;
  });

  it('renders the settings workspace shell', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: '管理設定' })).toBeTruthy();
    expect(screen.getByTestId('settings-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [{ href: '/admin/users', label: 'ユーザー管理' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    settingsContentMockState.suspend = true;

    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: '管理設定' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '管理設定を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('settings-content')).toBeNull();
  });
});
