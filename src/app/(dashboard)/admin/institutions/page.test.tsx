// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const institutionsContentMockState = vi.hoisted(() => ({
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
  getAdminInstitutionsShortcutLinks: () => [{ href: '/admin/pca-pumps', label: 'PCAポンプ' }],
}));

vi.mock('./institutions-content', () => ({
  InstitutionsContent: () => {
    if (institutionsContentMockState.suspend) {
      throw institutionsContentMockState.promise;
    }
    return <section data-testid="institutions-content" />;
  },
}));

import InstitutionsPage from './page';

setupDomTestEnv();

describe('InstitutionsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    institutionsContentMockState.suspend = false;
  });

  it('keeps the institution master list ahead of the generic admin intro', () => {
    render(<InstitutionsPage />);

    expect(screen.getByRole('heading', { name: '医療機関マスター' })).toBeTruthy();
    expect(screen.getByTestId('institutions-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    institutionsContentMockState.suspend = true;

    render(<InstitutionsPage />);

    expect(screen.getByRole('heading', { name: '医療機関マスター' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '医療機関マスターを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('institutions-content')).toBeNull();
  });
});
