// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const vehiclesContentMockState = vi.hoisted(() => ({
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
  getAdminVehiclesShortcutLinks: () => [
    { href: '/schedules/proposals', label: 'スケジュール提案' },
  ],
}));

vi.mock('./vehicles-content', () => ({
  VehiclesContent: () => {
    if (vehiclesContentMockState.suspend) {
      throw vehiclesContentMockState.promise;
    }
    return <section data-testid="vehicles-content" />;
  },
}));

import VehiclesPage from './page';

setupDomTestEnv();

describe('VehiclesPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    vehiclesContentMockState.suspend = false;
  });

  it('renders the live-data vehicle master content, not the placeholder stub', () => {
    render(<VehiclesPage />);

    expect(screen.getByRole('heading', { name: '車両マスター' })).toBeTruthy();
    expect(screen.getByTestId('vehicles-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    vehiclesContentMockState.suspend = true;

    render(<VehiclesPage />);

    expect(screen.getByRole('heading', { name: '車両マスター' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '車両マスターを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('vehicles-content')).toBeNull();
  });
});
