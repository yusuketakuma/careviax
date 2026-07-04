// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const facilityStandardsContentMockState = vi.hoisted(() => ({
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
  getAdminFacilityStandardsShortcutLinks: () => [{ href: '/admin/analytics', label: '管理分析' }],
}));

vi.mock('./facility-standards-content', () => ({
  FacilityStandardsContent: () => {
    if (facilityStandardsContentMockState.suspend) {
      throw facilityStandardsContentMockState.promise;
    }
    return <section data-testid="facility-standards-content" />;
  },
}));

import FacilityStandardsPage from './page';

setupDomTestEnv();

describe('FacilityStandardsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    facilityStandardsContentMockState.suspend = false;
  });

  it('renders the facility standards workspace shell', () => {
    render(<FacilityStandardsPage />);

    expect(screen.getByRole('heading', { name: '施設基準管理' })).toBeTruthy();
    expect(screen.getByTestId('facility-standards-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [{ href: '/admin/analytics', label: '管理分析' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    facilityStandardsContentMockState.suspend = true;

    render(<FacilityStandardsPage />);

    expect(screen.getByRole('heading', { name: '施設基準管理' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '施設基準管理を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('facility-standards-content')).toBeNull();
  });
});
