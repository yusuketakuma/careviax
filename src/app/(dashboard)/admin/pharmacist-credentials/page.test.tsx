// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const pharmacistCredentialsContentMockState = vi.hoisted(() => ({
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
  getAdminPharmacistCredentialsShortcutLinks: () => [{ href: '/admin/staff', label: 'スタッフ' }],
}));

vi.mock('./pharmacist-credentials-content', () => ({
  PharmacistCredentialsContent: () => {
    if (pharmacistCredentialsContentMockState.suspend) {
      throw pharmacistCredentialsContentMockState.promise;
    }
    return <section data-testid="pharmacist-credentials-content" />;
  },
}));

import PharmacistCredentialsPage from './page';

setupDomTestEnv();

describe('PharmacistCredentialsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    pharmacistCredentialsContentMockState.suspend = false;
  });

  it('keeps credential expiry work ahead of the generic admin intro', () => {
    render(<PharmacistCredentialsPage />);

    expect(screen.getByRole('heading', { name: 'かかりつけ薬剤師管理' })).toBeTruthy();
    expect(screen.getByTestId('pharmacist-credentials-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    pharmacistCredentialsContentMockState.suspend = true;

    render(<PharmacistCredentialsPage />);

    expect(screen.getByRole('heading', { name: 'かかりつけ薬剤師管理' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'かかりつけ薬剤師管理を読み込み中...' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('pharmacist-credentials-content')).toBeNull();
  });
});
