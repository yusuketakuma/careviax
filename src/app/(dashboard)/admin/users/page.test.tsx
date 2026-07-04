// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const usersContentMockState = vi.hoisted(() => ({
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
  getAdminUsersShortcutLinks: () => [{ href: '/admin/staff', label: 'スタッフ管理' }],
}));

vi.mock('./users-content', () => ({
  UsersContent: () => {
    if (usersContentMockState.suspend) {
      throw usersContentMockState.promise;
    }
    return <section data-testid="users-content" />;
  },
}));

import UsersPage from './page';

setupDomTestEnv();

describe('UsersPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    usersContentMockState.suspend = false;
  });

  it('renders the user management workspace shell', () => {
    render(<UsersPage />);

    expect(screen.getByRole('heading', { name: 'ユーザー管理' })).toBeTruthy();
    expect(screen.getByTestId('users-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/staff', label: 'スタッフ管理' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    usersContentMockState.suspend = true;

    render(<UsersPage />);

    expect(screen.getByRole('heading', { name: 'ユーザー管理' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'ユーザー管理を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('users-content')).toBeNull();
  });
});
