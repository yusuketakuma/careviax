// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());

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
  PharmacistCredentialsContent: () => <section data-testid="pharmacist-credentials-content" />,
}));

import PharmacistCredentialsPage from './page';

setupDomTestEnv();

describe('PharmacistCredentialsPage', () => {
  it('keeps credential expiry work ahead of the generic admin intro', () => {
    render(<PharmacistCredentialsPage />);

    expect(screen.getByRole('heading', { name: 'かかりつけ薬剤師管理' })).toBeTruthy();
    expect(screen.getByTestId('pharmacist-credentials-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });
});
