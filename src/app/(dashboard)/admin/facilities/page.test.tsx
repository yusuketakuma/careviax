// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const facilitiesContentMockState = vi.hoisted(() => ({
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
  getAdminFacilitiesShortcutLinks: () => [{ href: '/admin/contact-profiles', label: '連絡先' }],
}));

vi.mock('./facilities-content', () => ({
  FacilitiesContent: () => {
    if (facilitiesContentMockState.suspend) {
      throw facilitiesContentMockState.promise;
    }
    return <section data-testid="facilities-content" />;
  },
}));

import FacilitiesPage from './page';

setupDomTestEnv();

describe('FacilitiesPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    facilitiesContentMockState.suspend = false;
  });

  it('renders the facilities workspace shell', () => {
    render(<FacilitiesPage />);

    expect(screen.getByRole('heading', { name: '施設マスター' })).toBeTruthy();
    expect(screen.getByTestId('facilities-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/contact-profiles', label: '連絡先' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    facilitiesContentMockState.suspend = true;

    render(<FacilitiesPage />);

    expect(screen.getByRole('heading', { name: '施設マスター' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '施設マスターを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('facilities-content')).toBeNull();
  });
});
