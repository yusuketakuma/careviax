// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const packagingMethodsContentMockState = vi.hoisted(() => ({
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
  getAdminPackagingMethodsShortcutLinks: () => [
    { href: '/admin/pharmacy-sites', label: '薬局情報管理' },
  ],
}));

vi.mock('./packaging-methods-content', () => ({
  PackagingMethodsContent: () => {
    if (packagingMethodsContentMockState.suspend) {
      throw packagingMethodsContentMockState.promise;
    }
    return <section data-testid="packaging-methods-content" />;
  },
}));

import PackagingMethodsPage from './page';

setupDomTestEnv();

describe('PackagingMethodsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    packagingMethodsContentMockState.suspend = false;
  });

  it('renders the live-data packaging methods content', () => {
    render(<PackagingMethodsPage />);

    expect(screen.getByRole('heading', { name: '配薬方法マスター' })).toBeTruthy();
    expect(screen.getByTestId('packaging-methods-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [{ href: '/admin/pharmacy-sites', label: '薬局情報管理' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    packagingMethodsContentMockState.suspend = true;

    render(<PackagingMethodsPage />);

    expect(screen.getByRole('heading', { name: '配薬方法マスター' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '配薬方法マスターを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('packaging-methods-content')).toBeNull();
  });
});
