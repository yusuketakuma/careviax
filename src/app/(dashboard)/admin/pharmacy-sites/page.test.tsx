// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const pharmacySitesContentMockState = vi.hoisted(() => ({
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
  getAdminPharmacySitesShortcutLinks: () => [
    { href: '/admin/business-holidays', label: '休日カレンダー' },
  ],
}));

vi.mock('./pharmacy-sites-content', () => ({
  PharmacySitesContent: () => {
    if (pharmacySitesContentMockState.suspend) {
      throw pharmacySitesContentMockState.promise;
    }
    return <section data-testid="pharmacy-sites-content" />;
  },
}));

import PharmacySitesPage from './page';

setupDomTestEnv();

describe('PharmacySitesPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    pharmacySitesContentMockState.suspend = false;
  });

  it('keeps the pharmacy site workspace ahead of the generic admin intro', () => {
    render(<PharmacySitesPage />);

    expect(screen.getByRole('heading', { name: '薬局情報管理' })).toBeTruthy();
    expect(screen.getByTestId('pharmacy-sites-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    pharmacySitesContentMockState.suspend = true;

    render(<PharmacySitesPage />);

    expect(screen.getByRole('heading', { name: '薬局情報管理' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '薬局情報管理を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('pharmacy-sites-content')).toBeNull();
  });
});
