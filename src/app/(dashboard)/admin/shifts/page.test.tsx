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
  getAdminShiftsShortcutLinks: () => [{ href: '/admin/staff', label: 'スタッフ' }],
}));

vi.mock('./shifts-content', () => ({
  ShiftsContent: () => <section data-testid="shifts-content" />,
}));

import ShiftsPage from './page';

setupDomTestEnv();

describe('ShiftsPage', () => {
  it('keeps the shift calendar workspace ahead of the generic admin intro', () => {
    render(<ShiftsPage />);

    expect(screen.getByRole('heading', { name: '薬剤師シフト管理' })).toBeTruthy();
    expect(screen.getByTestId('shifts-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });
});
