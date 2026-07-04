// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const staffContentMockState = vi.hoisted(() => ({
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
  getAdminStaffShortcutLinks: () => [{ href: '/admin/users', label: 'ユーザー管理' }],
}));

vi.mock('../users/users-content', () => ({
  UsersContent: () => {
    if (staffContentMockState.suspend) {
      throw staffContentMockState.promise;
    }
    return <section data-testid="staff-users-content" />;
  },
}));

vi.mock('./staff-kpi-panel', () => ({
  StaffKpiPanel: () => {
    if (staffContentMockState.suspend) {
      throw staffContentMockState.promise;
    }
    return <section data-testid="staff-kpi-panel" />;
  },
}));

import StaffPage from './page';

setupDomTestEnv();

describe('StaffPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    staffContentMockState.suspend = false;
  });

  it('renders the staff workspace shell', () => {
    render(<StaffPage />);

    expect(screen.getByRole('heading', { name: 'スタッフ管理' })).toBeTruthy();
    expect(screen.getByTestId('staff-kpi-panel')).toBeTruthy();
    expect(screen.getByTestId('staff-users-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/users', label: 'ユーザー管理' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    staffContentMockState.suspend = true;

    render(<StaffPage />);

    expect(screen.getByRole('heading', { name: 'スタッフ管理' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'スタッフ管理を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('staff-kpi-panel')).toBeNull();
    expect(screen.queryByTestId('staff-users-content')).toBeNull();
  });
});
