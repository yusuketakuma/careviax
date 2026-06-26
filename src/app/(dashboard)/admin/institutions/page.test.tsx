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
  getAdminInstitutionsShortcutLinks: () => [{ href: '/admin/pca-pumps', label: 'PCAポンプ' }],
}));

vi.mock('./institutions-content', () => ({
  InstitutionsContent: () => <section data-testid="institutions-content" />,
}));

import InstitutionsPage from './page';

setupDomTestEnv();

describe('InstitutionsPage', () => {
  it('keeps the institution master list ahead of the generic admin intro', () => {
    render(<InstitutionsPage />);

    expect(screen.getByRole('heading', { name: '医療機関マスター' })).toBeTruthy();
    expect(screen.getByTestId('institutions-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });
});
