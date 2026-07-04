// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const businessHolidaysContentMockState = vi.hoisted(() => ({
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
  getAdminBusinessHolidaysShortcutLinks: () => [
    { href: '/admin/pharmacy-sites', label: '薬局情報管理' },
  ],
}));

vi.mock('./business-holidays-content', () => ({
  BusinessHolidaysContent: () => {
    if (businessHolidaysContentMockState.suspend) {
      throw businessHolidaysContentMockState.promise;
    }
    return <section data-testid="business-holidays-content" />;
  },
}));

import BusinessHolidaysPage from './page';

setupDomTestEnv();

describe('BusinessHolidaysPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    businessHolidaysContentMockState.suspend = false;
  });

  it('keeps the business holiday workspace ahead of the generic admin intro', () => {
    render(<BusinessHolidaysPage />);

    expect(screen.getByRole('heading', { name: '休日カレンダー' })).toBeTruthy();
    expect(screen.getByTestId('business-holidays-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/pharmacy-sites', label: '薬局情報管理' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    businessHolidaysContentMockState.suspend = true;

    render(<BusinessHolidaysPage />);

    expect(screen.getByRole('heading', { name: '休日カレンダー' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '休日カレンダーを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('business-holidays-content')).toBeNull();
  });
});
