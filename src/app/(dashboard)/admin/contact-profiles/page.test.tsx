// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const contactProfilesContentMockState = vi.hoisted(() => ({
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
  getAdminContactProfilesShortcutLinks: () => [
    { href: '/admin/external-professionals', label: '外部専門職' },
  ],
}));

vi.mock('./contact-profiles-content', () => ({
  ContactProfilesContent: () => {
    if (contactProfilesContentMockState.suspend) {
      throw contactProfilesContentMockState.promise;
    }
    return <section data-testid="contact-profiles-content" />;
  },
}));

import ContactProfilesPage from './page';

setupDomTestEnv();

describe('ContactProfilesPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    contactProfilesContentMockState.suspend = false;
  });

  it('renders the contact profiles workspace shell', () => {
    render(<ContactProfilesPage />);

    expect(screen.getByRole('heading', { name: '連携先プロファイル' })).toBeTruthy();
    expect(screen.getByTestId('contact-profiles-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [{ href: '/admin/external-professionals', label: '外部専門職' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    contactProfilesContentMockState.suspend = true;

    render(<ContactProfilesPage />);

    expect(screen.getByRole('heading', { name: '連携先プロファイル' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '連携先プロファイルを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('contact-profiles-content')).toBeNull();
  });
});
