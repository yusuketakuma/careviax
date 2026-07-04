// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const operatingHoursContentMockState = vi.hoisted(() => ({
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
  getAdminOperatingHoursShortcutLinks: () => [
    { href: '/admin/business-holidays', label: '休日カレンダー' },
  ],
}));

vi.mock('./operating-hours-content', () => ({
  OperatingHoursContent: () => {
    if (operatingHoursContentMockState.suspend) {
      throw operatingHoursContentMockState.promise;
    }
    return <section data-testid="operating-hours-content" />;
  },
}));

import OperatingHoursPage from './page';

setupDomTestEnv();

describe('OperatingHoursPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    operatingHoursContentMockState.suspend = false;
  });

  it('renders the operating-hours workspace shell', () => {
    render(<OperatingHoursPage />);

    expect(screen.getByRole('heading', { name: '稼働日設定' })).toBeTruthy();
    expect(screen.getByTestId('operating-hours-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/business-holidays', label: '休日カレンダー' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    operatingHoursContentMockState.suspend = true;

    render(<OperatingHoursPage />);

    expect(screen.getByRole('heading', { name: '稼働日設定' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '稼働日設定を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('operating-hours-content')).toBeNull();
  });
});
