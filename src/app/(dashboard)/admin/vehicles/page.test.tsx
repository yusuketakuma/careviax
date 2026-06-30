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
  getAdminVehiclesShortcutLinks: () => [
    { href: '/schedules/proposals', label: 'スケジュール提案' },
  ],
}));

vi.mock('./vehicles-content', () => ({
  VehiclesContent: () => <section data-testid="vehicles-content" />,
}));

vi.mock('../master-editor-view', () => ({
  MasterEditorView: () => <div data-testid="master-editor-stub">STUB</div>,
}));

import VehiclesPage from './page';

setupDomTestEnv();

describe('VehiclesPage', () => {
  it('renders the live-data vehicle master content, not the placeholder stub', () => {
    render(<VehiclesPage />);

    expect(screen.getByRole('heading', { name: '車両マスター' })).toBeTruthy();
    expect(screen.getByTestId('vehicles-content')).toBeTruthy();
    expect(screen.queryByTestId('master-editor-stub')).toBeNull();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });
});
