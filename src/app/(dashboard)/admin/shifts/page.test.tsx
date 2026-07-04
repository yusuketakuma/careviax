// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const shiftsContentMockState = vi.hoisted(() => ({
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
  getAdminShiftsShortcutLinks: () => [{ href: '/admin/staff', label: 'スタッフ' }],
}));

vi.mock('./shifts-content', () => ({
  ShiftsContent: () => {
    if (shiftsContentMockState.suspend) {
      throw shiftsContentMockState.promise;
    }
    return <section data-testid="shifts-content" />;
  },
}));

import ShiftsPage from './page';

setupDomTestEnv();

describe('ShiftsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    shiftsContentMockState.suspend = false;
  });

  it('keeps the shift calendar workspace ahead of the generic admin intro', () => {
    render(<ShiftsPage />);

    expect(screen.getByRole('heading', { name: '薬剤師シフト管理' })).toBeTruthy();
    expect(screen.getByTestId('shifts-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    shiftsContentMockState.suspend = true;

    render(<ShiftsPage />);

    expect(screen.getByRole('heading', { name: '薬剤師シフト管理' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '薬剤師シフト管理を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('shifts-content')).toBeNull();
  });
});
